import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getToken } from "next-auth/jwt";
import { obtenerCredencialCourier } from "@/lib/couriers/normalizar";
import { despacharCourier } from "@/lib/envios/dispatch";
import { verificarAccesoEnvio } from "@/lib/envios/ownership";
import { validarDireccionEnvio } from "@/lib/geo/validar-direccion";

// DEUDA 106 pieza 2 mov 4 (2026-08-04): dos caminos de auth para corregir.
//
// (a) BUYER PATH — anónimo con `token` en el body (mov 5 lo forward-ea desde el
//     querystring del link mágico del mail). El token identifica: (i) el envío,
//     (ii) no expiró, (iii) sigue RETENIDO. Éxito → esBuyer=true. Falla del
//     token → 404 (no se revela existencia). NO se cae a session — un token
//     malo es un token malo, no es "quizás sea el operador".
//
// (b) CLIENTE/SHIPRO PATH — sin token en el body, con sesión NextAuth. Este
//     endpoint está en PUBLIC_API_EXACT (proxy.ts:13) → proxy NO inyecta
//     x-empresa-id (proxy.ts:98). Así que aquí el handler self-authentica
//     via getToken(...) — mismo patrón que proxy.authBySession (proxy.ts:72-90),
//     replicado inline. Con el ctx armado, se usa verificarAccesoEnvio para
//     ownership + se re-verifica el scope RETENIDO manualmente (el helper
//     no filtra por estado).
//
// GOOGLE VALIDATION es obligatoria para el buyer y SALTEADA para el cliente
// (design lock Nacho: cliente tiene "última palabra"). Se ubica ANTES del
// Direccion.update para que una dirección rechazada del buyer no pise la
// dirección actual del envío. Ver validarDireccionEnvio en
// lib/geo/validar-direccion.ts (mov 3).
//
// TOKEN LIFECYCLE: NO se hace null-out en éxito. El filtro RETENIDO en la
// query del buyer path ya mata el token cuando el envío pasa a Pendiente
// (no hay re-entrada a RETENIDO por diseño). El valor histórico queda para
// auditoría / debug.

// DEUDA 106 pieza 2 mov 5 (2026-08-04): GET read-only para el prefill del form
// del comprador. Devuelve L2 (dirección actual del destino) validando el token
// con las mismas 4 condiciones que el POST buyer path (envío + token + no
// expirado + RETENIDO). NO despacha, NO muta, NO devuelve PII de más — sólo
// la dirección para prefill. El buscar de PIEZA 1 quedó session-gated para
// hardening; el buyer necesita este otro camino token-aware, y mantener la
// lógica del token en un solo endpoint (corregir) es más simple que abrir
// buscar a token.
//
// El session-path (cliente/Shipro) para prefill sigue usando /api/envios/buscar
// (que ya tiene su ownership gate + su DTO L3 para el operador). Esta GET es
// SÓLO para el buyer con token.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get("tracking");
    const token = searchParams.get("token");

    if (!tracking || !token) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // Same 4 gates as POST buyer path — envío + token válido + no expirado +
    // RETENIDO. Cualquier fallo → 404 idéntico (no revela existencia).
    const envio = await prisma.envio.findFirst({
      where: {
        trackingNumber: tracking,
        correccionToken: token,
        correccionTokenExpira: { gt: new Date() },
        estadoActual: { in: ["RETENIDO", "Retenido"] },
      },
      // Proyección Prisma-enforced — sólo lo que el prefill del form necesita.
      // Nada de destino.{nombre, documento, email, telefono}, empresa, courier,
      // finanzas ni internals — el comprador conoce sus propios datos, no
      // necesita re-verlos.
      select: {
        estadoActual: true,
        destino: {
          select: {
            calle: true,
            altura: true,
            piso: true,
            dpto: true,
            cp: true,
            localidad: true,
            provincia: true,
          },
        },
      },
    });

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    return NextResponse.json(envio);
  } catch (error) {
    console.error("Error leyendo envío para corrección (GET):", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      trackingNumber,
      calle, altura, cp, localidad, provincia, piso, dpto,
      // DEUDA 132 Paso 4a: campos opcionales de paquete. La UI de corrección los
      // manda cuando el operador destraba un BLOQUEADO_DATOS_PAQUETE. Para una
      // corrección address-only pueden venir undefined — se ignoran, no se null-outea.
      pesoReal: pesoRealBody,
      largoCm: largoCmBody,
      anchoCm: anchoCmBody,
      altoCm:  altoCmBody,
      token,
    } = body;

    if (!trackingNumber || !calle || !altura || !cp) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // 1. Resolver el caller — buyer con token o cliente/Shipro con sesión.
    // El include tree es el mismo que el handler pre-refactor: destino,
    // courier, finanzas, empresa, deposito, origen, tramos. Ver DEUDA 29
    // Sub-fase 1.C.2 para por qué extenso (origen real + defense contra
    // cambios del filtro de estados que dejaran pasar envíos con tramos).
    const includeTree = {
      destino: true,
      courier: true,
      finanzas: true,
      empresa: true,
      deposito: true,
      origen: true,
      tramos: true,
    } as const;

    let envio: any = null;
    let esBuyer = false;

    if (typeof token === "string" && token.length > 0) {
      // (a) BUYER PATH — el token ES la identidad. Query one-shot con las 4
      // condiciones. Si falta cualquiera → null → 404 idéntico (no se revela
      // si es porque el envío no existe, el token equivocado, expiró, o el
      // envío ya no está RETENIDO).
      envio = await prisma.envio.findFirst({
        where: {
          trackingNumber,
          correccionToken: token,
          correccionTokenExpira: { gt: new Date() },
          estadoActual: { in: ["RETENIDO", "Retenido"] },
        },
        include: includeTree,
      });
      if (!envio) {
        return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
      }
      esBuyer = true;
    } else {
      // (b) CLIENTE/SHIPRO PATH — self-auth via getToken (proxy no inyecta
      // headers en PUBLIC_API_EXACT). Réplica de proxy.authBySession.
      const jwt = await getToken({
        req: request as any,
        secret: process.env.NEXTAUTH_SECRET,
      });
      if (!jwt) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
      const jwtEmpresaId =
        typeof jwt.empresaId === "number" ? jwt.empresaId : null;
      // Non-null empresaId → verificamos empresa.activo (mirror proxy.ts:82-88).
      if (jwtEmpresaId !== null) {
        const empresa = await prisma.empresa.findUnique({
          where: { id: jwtEmpresaId },
          select: { activo: true },
        });
        if (!empresa?.activo) {
          return NextResponse.json({ error: "Empresa deshabilitada" }, { status: 401 });
        }
      }
      const ctx = {
        empresaId: jwtEmpresaId,
        rol: typeof jwt.rol === "string" ? jwt.rol : "",
        modoDios: jwtEmpresaId === null,
      };
      envio = await verificarAccesoEnvio(
        { trackingNumber },
        ctx,
        includeTree,
      );
      // verificarAccesoEnvio hace ownership + existencia. El scope RETENIDO
      // o BLOQUEADO_DATOS_PAQUETE se re-chequea acá (el helper no filtra por
      // estado). Mismo 404 que el buyer path — nunca revelamos si el envío
      // existe pero salió del scope válido vs no existe vs es de otra empresa.
      // DEUDA 132 Paso 4a: el path cliente/Shipro también destraba envíos que
      // nacieron BLOQUEADO_DATOS_PAQUETE (barrier de datos del paquete). El
      // buyer/token path NO acepta este estado — los compradores nunca cargan
      // dims/peso, sólo dirección.
      const esRetenido =
        envio?.estadoActual === "RETENIDO" || envio?.estadoActual === "Retenido";
      const esBloqueadoDatosPaquete =
        envio?.estadoActual === "BLOQUEADO_DATOS_PAQUETE";
      if (!envio || (!esRetenido && !esBloqueadoDatosPaquete)) {
        return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
      }
    }

    // A este punto envío existe (en RETENIDO o BLOQUEADO_DATOS_PAQUETE en el
    // path cliente/Shipro; RETENIDO-only en el path buyer), y el caller es
    // autorizado.
    if (!envio.destino || !envio.courier) {
      return NextResponse.json({ error: "Envío no encontrado o inválido para corrección" }, { status: 404 });
    }

    // DEUDA 132 Paso 4a: bandera consolidada. Sólo puede ser true en el path
    // cliente/Shipro (el buyer path filtra RETENIDO-only). Sirve para ramificar
    // observaciones + comportamiento del fallo total sin cambiar el resto.
    const esCorreccionDatosPaquete =
      envio.estadoActual === "BLOQUEADO_DATOS_PAQUETE";

    // Defense in depth: este endpoint solo soporta envíos sin tramos previos.
    // Los filtros de estado (RETENIDO y BLOQUEADO_DATOS_PAQUETE) garantizan esto
    // hoy (ambos son pre-dispatch — nunca tuvieron despacho exitoso, así que no
    // tienen tramos), pero defendemos contra futuros cambios del filtro.
    if (envio.tramos.length > 0) {
      return NextResponse.json({
        error: "Este envío ya tiene tramos despachados. Usar otro endpoint para corrección post-despacho.",
      }, { status: 400 });
    }

    // ==============================================================
    // GOOGLE VALIDATION — obligatoria para el buyer, salteada para el cliente.
    // Se ubica ANTES del Direccion.update para que una dirección inválida
    // enviada por el buyer NO pise la dirección actual. El cliente salta este
    // check por diseño (última palabra).
    // ==============================================================
    if (esBuyer) {
      const resultadoValidacion = await validarDireccionEnvio({
        calle,
        altura,
        cp,
        localidad,
        provincia,
      });
      if (!resultadoValidacion.valida) {
        return NextResponse.json(
          { error: "Direccion no validada", motivo: resultadoValidacion.motivo },
          { status: 422 },
        );
      }
    }

    // 2. Actualizar dirección del destinatario.
    await prisma.direccion.update({
      where: { id: envio.destino.id },
      data: {
        calle,
        altura,
        cp: String(cp),
        localidad,
        provincia,
        piso: piso || "",
        dpto: dpto || "",
      },
    });

    // ==============================================================
    // 2.b — DEUDA 132 Paso 4a: persistir peso/dims si el body los trae.
    // Sólo escribimos las columnas que vinieron con valor parseable (nunca
    // null-outeamos existentes en un save address-only). Después del update
    // refrescamos `envio` en memoria para que la barrera y el dispatch de
    // abajo lean los valores nuevos, no los viejos.
    // ==============================================================
    const parseDim = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const datosPaqueteUpdate: {
      pesoReal?: number;
      largoCm?: number;
      anchoCm?: number;
      altoCm?: number;
    } = {};
    const pesoParsed = parseDim(pesoRealBody);
    if (pesoParsed !== null) datosPaqueteUpdate.pesoReal = pesoParsed;
    const largoParsed = parseDim(largoCmBody);
    if (largoParsed !== null) datosPaqueteUpdate.largoCm = largoParsed;
    const anchoParsed = parseDim(anchoCmBody);
    if (anchoParsed !== null) datosPaqueteUpdate.anchoCm = anchoParsed;
    const altoParsed = parseDim(altoCmBody);
    if (altoParsed !== null) datosPaqueteUpdate.altoCm = altoParsed;

    if (Object.keys(datosPaqueteUpdate).length > 0) {
      const envioActualizado = await prisma.envio.update({
        where: { id: envio.id },
        data: datosPaqueteUpdate,
      });
      envio.pesoReal = envioActualizado.pesoReal;
      envio.largoCm  = envioActualizado.largoCm;
      envio.anchoCm  = envioActualizado.anchoCm;
      envio.altoCm   = envioActualizado.altoCm;
    }

    // ==============================================================
    // 2.c — DEUDA 132 Paso 4a: BARRERA DE DATOS DEL PAQUETE (mirror crear.ts
    // Paso 3a). Un envío sin peso o sin las 3 dimensiones NUNCA llega al
    // courier. Si el operador guardó una corrección incompleta, la respuesta
    // es 422 y el envío queda en el mismo estado (BLOQUEADO_DATOS_PAQUETE en
    // el caso 4a; para RETENIDO con dims válidas al crear la corrida es
    // no-op). NO despachamos ni cambiamos estado.
    // ==============================================================
    const pesoNum = parseFloat(String(envio.pesoReal));
    const datosPaqueteCompletos =
      Number.isFinite(pesoNum) && pesoNum > 0 &&
      envio.largoCm != null && envio.largoCm > 0 &&
      envio.anchoCm != null && envio.anchoCm > 0 &&
      envio.altoCm  != null && envio.altoCm  > 0;
    if (!datosPaqueteCompletos) {
      return NextResponse.json(
        {
          error: "DatosPaqueteIncompletos",
          detalle: "Faltan peso y/o dimensiones (todos deben ser mayores a 0) para poder despachar.",
        },
        { status: 422 },
      );
    }

    // 3. Cargar credencial principal y validar que esté activa.
    const credencialMain = await obtenerCredencialCourier(envio.empresaId, envio.courier.nombre);
    if (!credencialMain || !credencialMain.activo) {
      return NextResponse.json({
        error: "Dirección corregida, pero no hay credencial activa para el courier. Contactar soporte.",
      }, { status: 502 });
    }

    // 4. Construir origen del despacho (DEUDA 4 follow-up).
    // Hoy el código previo no pasaba origen al adapter → bug latente para
    // clientes fuera de AMBA (etiquetas con "Av. Libertador 1234" hardcoded).
    // Preferimos el depósito vivo (envio.deposito) por consistencia con
    // crear.ts; fallback al snapshot original (envio.origen) si no hay
    // depósito asignado (envíos legacy o casos especiales).
    let origenDespacho;
    if (envio.deposito) {
      origenDespacho = {
        calle: envio.deposito.direccionCalle,
        altura: envio.deposito.direccionAltura,
        cp: envio.deposito.codigoPostal,
        localidad: envio.deposito.localidad,
        provincia: envio.deposito.provincia,
        pais: envio.deposito.pais,
        telefono: envio.deposito.contactoTelefono,
        email: envio.deposito.contactoEmail || undefined,
      };
    } else if (envio.origen) {
      origenDespacho = {
        calle: envio.origen.calle || "",
        altura: envio.origen.altura || "",
        cp: envio.origen.cp,
        localidad: envio.origen.localidad || "",
        provincia: envio.origen.provincia || "",
        pais: envio.origen.pais,
        telefono: envio.origen.telefono || undefined,
        email: envio.origen.email || undefined,
      };
    }
    // Si no hay deposito ni origen → undefined → el adapter usa fallback.

    // 5. Re-despachar con la dirección corregida vía despacharCourier
    // (DEUDA 29 Sub-fase 1.C.2: reemplaza la lógica inline duplicada).
    // dispatch.ts maneja internamente: motor, credenciales, paramsDespacho,
    // first-mile (consolidador), vinculación Mocis-Andreani.
    const dispatchResult = await despacharCourier({
      credencial: credencialMain,
      courierNombreCanonico: envio.courier.nombre,
      courierIdMain: envio.courierId,
      // DEUDA 29 Sub-fase 2.D.despachar: depositoId para resolver sucursal
      // preferida. En envíos legacy depositoId puede ser null → undefined
      // skipea el lookup (adapter cae a fallback creds.id_sucursal_origen).
      depositoId: envio.depositoId ?? undefined,
      // tipoOrigen defensivo: el campo es String en BD, normalizamos al union.
      tipoOrigen: envio.tipoOrigen === "drop_off_cliente" ? "drop_off_cliente" : "recoleccion_courier",
      // TODO DEUDA 29 Sub-fase 6: persistir sucursalOrigenId/sucursalDestinoId del
      // envío original cuando UI lo pueble. Hoy van como null.
      sucursalOrigenId: null,
      sucursalDestinoId: null,
      destinatarioNombre: envio.destino.nombre || "Consumidor Final",
      calle,
      altura,
      piso: piso || undefined,
      dpto: dpto || undefined,
      localidad,
      provincia,
      cp: String(cp),
      dni: envio.destino.documento || "",
      email: envio.destino.email || "",
      telefono: envio.destino.telefono || "",
      pesoReal: envio.pesoReal,
      // DEUDA 132 Paso 2: dims persistidas al crear (Paso 1) llegan al re-despacho.
      largoCm: envio.largoCm,
      anchoCm: envio.anchoCm,
      altoCm: envio.altoCm,
      valorDeclarado: envio.finanzas?.valorDeclarado?.toNumber() ?? 0,
      modalidad: envio.modalidad,
      numeroOrden: envio.numeroOrden,
      origen: origenDespacho,
    });

    // 6. Manejar resultado en 3 ramas según el estado del despacho.

    // ---------- RAMA 1: despacho exitoso ----------
    if (dispatchResult.tracking) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: {
              estadoActual: "Pendiente",
              trackingNumber: dispatchResult.tracking!,
              etiquetaUrl: dispatchResult.etiquetaUrl,
            },
          });

          if (dispatchResult.tramos.length > 0) {
            await tx.tramoEnvio.createMany({
              data: dispatchResult.tramos.map(t => ({
                envioId: envio.id,
                orden: t.orden,
                courierId: t.courierId,
                tipo: t.tipo,
                trackingExterno: t.trackingExterno,
                sucursalOrigenId: t.sucursalOrigenId ?? null,
                sucursalDestinoId: t.sucursalDestinoId ?? null,
              })),
            });
          }

          await tx.eventoTracking.create({
            data: {
              envioId: envio.id,
              estado: "Pendiente",
              // DEUDA 132 Paso 4a: observación distinta según el estado del que
              // veníamos, para que el evento cuente qué acción destrabó el envío.
              observacion: esCorreccionDatosPaquete
                ? `Datos del paquete completados. Tracking oficial asignado: ${dispatchResult.tracking}.`
                : `Dirección corregida. Tracking oficial asignado: ${dispatchResult.tracking}.`,
            },
          });
        });
      } catch (txErr: any) {
        console.error(`[Corregir] Falló persistencia post-despacho exitoso para envío ${envio.id}:`, txErr);
        return NextResponse.json({
          error: "Error guardando los datos post-corrección. Contactar soporte.",
        }, { status: 500 });
      }

      return NextResponse.json({ success: true, trackingOficial: dispatchResult.tracking });
    }

    // ---------- RAMA 2: partial failure CON tramos huérfanos → BLOQUEADO_PARCIAL ----------
    // Caso C tramo 1 OK + tramo 2 falla (consolidador). Si dejamos en RETENIDO
    // y el cliente reintenta, despacharCourier despacharía Mocis OTRA VEZ → tramos
    // duplicados → doble cobro del recolector. BLOQUEADO_PARCIAL es la única
    // opción correcta. Operador resuelve manualmente (Sub-fase 3 agregará
    // reintento automático).
    if (dispatchResult.tramos.length > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: { estadoActual: "BLOQUEADO_PARCIAL" },
          });

          await tx.tramoEnvio.createMany({
            data: dispatchResult.tramos.map(t => ({
              envioId: envio.id,
              orden: t.orden,
              courierId: t.courierId,
              tipo: t.tipo,
              trackingExterno: t.trackingExterno,
              sucursalOrigenId: t.sucursalOrigenId ?? null,
              sucursalDestinoId: t.sucursalDestinoId ?? null,
            })),
          });

          await tx.eventoTracking.create({
            data: {
              envioId: envio.id,
              estado: "BLOQUEADO_PARCIAL",
              observacion: `Dirección corregida pero re-despacho parcial: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos huérfanos persistidos: ${dispatchResult.tramos.length}. El operador debe resolver la falla manualmente.`,
            },
          });
        });
      } catch (txErr: any) {
        console.error(`[Corregir] Falló transición a BLOQUEADO_PARCIAL para envío ${envio.id}:`, txErr);
      }

      return NextResponse.json({
        error: `Dirección corregida, pero el re-despacho falló parcialmente. ${dispatchResult.tramos.length} tramo(s) quedaron despachados en courier(s). Operador resolverá manualmente.`,
        bloqueadoPorTramoFallido: true,
      }, { status: 502 });
    }

    // ---------- RAMA 3: partial failure SIN tramos → mantener estado origen ----------
    // Caso A/B falló o caso C tramo 1 falló desde el inicio. No hay tramos
    // despachados → no hay tramos huérfanos en couriers. Dejamos el envío en
    // su estado de origen para que se pueda reintentar la corrección con datos
    // diferentes.
    //   - RETENIDO   → sigue RETENIDO (comprador puede reintentar desde link).
    //   - BLOQUEADO_DATOS_PAQUETE → sigue en ese estado (operador puede volver
    //     a la pantalla de corrección y ajustar peso/dims/dirección).
    // No inventamos un estado nuevo — usamos el mismo del que veníamos.
    if (esCorreccionDatosPaquete) {
      await prisma.eventoTracking.create({
        data: {
          envioId: envio.id,
          estado: "BLOQUEADO_DATOS_PAQUETE",
          observacion: `Datos del paquete completados pero el courier rechazó la etiqueta: ${dispatchResult.error || "no devolvió tracking"}. El envío sigue en BLOQUEADO_DATOS_PAQUETE; reintentá con datos distintos.`,
        },
      });

      return NextResponse.json({
        error: `Datos guardados, pero el courier rechazó la etiqueta: ${dispatchResult.error || "no devolvió tracking"}. Verificá los datos e intentá nuevamente.`,
      }, { status: 502 });
    }

    await prisma.eventoTracking.create({
      data: {
        envioId: envio.id,
        estado: "RETENIDO",
        observacion: `Intento de corrección falló en el courier: ${dispatchResult.error || "courier no devolvió tracking"}. El envío sigue en RETENIDO; el cliente puede reintentar con datos distintos.`,
      },
    });

    return NextResponse.json({
      error: `Dirección corregida, pero el courier rechazó la etiqueta: ${dispatchResult.error || "no devolvió tracking"}. Verificá los datos e intentá nuevamente.`,
    }, { status: 502 });

  } catch (error) {
    console.error("Error corrigiendo dirección desde link público:", error);
    return NextResponse.json({ error: "Error interno del servidor al procesar la corrección" }, { status: 500 });
  }
}
