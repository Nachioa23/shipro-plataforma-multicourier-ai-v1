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
    const { trackingNumber, calle, altura, cp, localidad, provincia, piso, dpto, token } = body;

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
      // se re-chequea acá (el helper no filtra por estado). Mismo 404 que
      // el buyer path — nunca revelamos si el envío existe pero salió de
      // RETENIDO vs no existe vs es de otra empresa.
      const esRetenido =
        envio?.estadoActual === "RETENIDO" || envio?.estadoActual === "Retenido";
      if (!envio || !esRetenido) {
        return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
      }
    }

    // A este punto envío existe, está RETENIDO, y el caller es autorizado.
    if (!envio.destino || !envio.courier) {
      return NextResponse.json({ error: "Envío no encontrado o inválido para corrección" }, { status: 404 });
    }

    // Defense in depth: este endpoint solo soporta envíos sin tramos previos.
    // El filtro de estado RETENIDO garantiza esto hoy (los envíos RETENIDO
    // nunca tuvieron despacho exitoso → no tienen tramos), pero defendemos
    // contra futuros cambios del filtro.
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
              observacion: `Dirección corregida. Tracking oficial asignado: ${dispatchResult.tracking}.`,
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

    // ---------- RAMA 3: partial failure SIN tramos → mantener RETENIDO ----------
    // Caso A/B falló o caso C tramo 1 falló desde el inicio. No hay tramos
    // despachados → no hay tramos huérfanos en couriers. Dejamos el envío en
    // RETENIDO para que el cliente pueda reintentar la corrección con datos
    // diferentes desde el link público.
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
