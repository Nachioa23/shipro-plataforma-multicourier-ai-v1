import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { obtenerCredencialCourier } from "@/lib/couriers/normalizar";
import { despacharCourier } from "@/lib/envios/dispatch";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { trackingNumber, calle, altura, cp, localidad, provincia, piso, dpto } = body;

    if (!trackingNumber || !calle || !altura || !cp) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // 1. Buscar envío en RETENIDO con info necesaria.
    // DEUDA 29 Sub-fase 1.C.2: include extendido para construir origen real
    // del despacho (deposito vivo + origen snapshot fallback) y para defense
    // contra futuros cambios del filtro de estados (tramos previos).
    const envio = await prisma.envio.findFirst({
      where: {
        trackingNumber,
        estadoActual: { in: ["RETENIDO", "Retenido"] },
      },
      include: {
        destino: true,
        courier: true,
        finanzas: true,
        empresa: true,
        deposito: true,
        origen: true,
        tramos: true,
      },
    });

    if (!envio || !envio.destino || !envio.courier) {
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
      valorDeclarado: envio.finanzas?.valorDeclarado || 0,
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
