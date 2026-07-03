import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { obtenerCredencialCourier, normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { resolverContext } from "@/lib/auth-context";
import { verificarAccesoEnvio } from "@/lib/envios/ownership";

export async function POST(request: Request) {
  try {
    const { tracking } = await request.json();
    if (!tracking) return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });

    // DEUDA 87 FAMILIA 2: gate de ownership (shipro=global, cliente=solo su empresa).
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    // DEUDA 29 Sub-fase 1.C.2: include de tramos para iterar la cancelación
    // sobre la cadena completa (recolector + Last-Mile, o solo Last-Mile, etc.).
    const envio = await verificarAccesoEnvio(
      { trackingNumber: tracking },
      ctx,
      {
        courier: true,
        tramos: {
          include: { courier: true },
          orderBy: { orden: "asc" },
        },
      }
    );

    if (!envio) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    if (envio.estadoActual === "CANCELADO") return NextResponse.json({ error: "El envío ya está cancelado" }, { status: 400 });

    // ============================================================
    // DEUDA 29 Sub-fase 1.C.2: cancelar todos los tramos despachados.
    // ============================================================
    // Iteramos envio.tramos (orden asc). Para cada tramo con trackingExterno
    // no nulo, instanciamos el motor del courier de ese tramo y llamamos
    // cancelarEnvio.
    //
    // Tolerancia a fallas: si la cancelación en algún courier falla, se loggea
    // pero NO se aborta. El envío SÍ se marca CANCELADO en Shipro (Shipro es
    // la fuente de verdad del estado). Operador resuelve el courier huérfano
    // manualmente vía EventoTracking + logs.
    //
    // Si envio.tramos.length === 0 (envío bloqueado pre-despacho, ej. estados
    // BLOQUEADO_SALDO/BLOQUEADO_DEPOSITO/BLOQUEADO_PARCIAL sin tramos), no hay
    // nada que cancelar en couriers — solo se marca CANCELADO en BD. Esto
    // resuelve el bug latente donde estos envíos no se podían cancelar (el
    // código intentaba cancelar SHP-XXXXXX en el courier real y fallaba).
    const tramosConTracking = envio.tramos.filter(t => t.trackingExterno);
    let tramosCancelados = 0;
    let tramosFallidos = 0;

    for (const tramo of tramosConTracking) {
      const nombreCourierTramo = normalizarParaComparacion(tramo.courier.nombre);

      // Resolución de credenciales:
      // - Si tramo.courierId === envio.courierId → es el courier "visible al
      //   comprador" (Last-Mile). Usar credencial del cliente (propias o Shipro
      //   según config).
      // - Si es courier de tramo previo (recolector consolidador, ej. Mocis para
      //   Andreani) → siempre creds Shipro.
      let llaves;
      if (tramo.courierId === envio.courierId) {
        const credencial = await obtenerCredencialCourier(envio.empresaId, tramo.courier.nombre);
        llaves = credencial?.usaCredencialesPropias
          ? parsearCredencialesPropias(nombreCourierTramo, credencial.credencialesJson)
          : obtenerCredencialesShipro(nombreCourierTramo);
      } else {
        llaves = obtenerCredencialesShipro(nombreCourierTramo);
      }

      try {
        const motor = CourierFactory.crear(nombreCourierTramo, llaves);
        const cancelado = await motor.cancelarEnvio(tramo.trackingExterno!);
        if (cancelado) {
          tramosCancelados++;
          console.log(`✅ Tramo ${tramo.orden} (${tramo.courier.nombre}) tracking ${tramo.trackingExterno} cancelado.`);
        } else {
          tramosFallidos++;
          console.warn(`⚠️ Tramo ${tramo.orden} (${tramo.courier.nombre}) rechazó cancelación de ${tramo.trackingExterno}.`);
        }
      } catch (error: any) {
        tramosFallidos++;
        console.warn(`⚠️ Tramo ${tramo.orden} (${tramo.courier.nombre}) error cancelando ${tramo.trackingExterno}:`, error.message);
      }
    }

    // ============================================================
    // Marcar CANCELADO en Shipro (siempre, independiente de fallas en couriers).
    // ============================================================
    await prisma.envio.update({
      where: { id: envio.id },
      data: { estadoActual: "CANCELADO" },
    });

    const observacionEvento = tramosConTracking.length === 0
      ? "Envío cancelado por el usuario. No había tramos despachados (cancelación solo en Shipro)."
      : tramosFallidos === 0
        ? `Envío cancelado por el usuario. ${tramosCancelados} tramo(s) cancelado(s) en courier(s).`
        : `Envío cancelado por el usuario. ${tramosCancelados} tramo(s) cancelado(s) OK, ${tramosFallidos} con falla (revisar manualmente).`;

    await prisma.eventoTracking.create({
      data: {
        estado: "CANCELADO",
        observacion: observacionEvento,
        envioId: envio.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: tramosFallidos > 0
        ? `Envío cancelado en Shipro. ${tramosFallidos} courier(s) reportaron falla, revisar manualmente.`
        : "Cancelación exitosa",
      tramosCancelados,
      tramosFallidos,
    });

  } catch (error: any) {
    console.error("Error crítico en cancelación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
