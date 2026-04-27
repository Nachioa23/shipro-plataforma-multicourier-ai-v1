import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";

// TRADUCTOR DE LLAVES
function obtenerCredencialesShipro(courier: string) {
  const c = courier.toLowerCase().replace(/['\s]/g, '');
  if (c === 'andreani') {
    return { 
      username: process.env.ANDREANI_USER?.trim() || '', password: process.env.ANDREANI_PASS?.trim() || '', cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
      contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || '' 
    };
  }
  if (c === 'mocis') {
    return { clientApi: process.env.MOCIS_CLIENT_API?.trim() || '', clientSecret: process.env.MOCIS_CLIENT_SECRET?.trim() || '' };
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const { tracking } = await request.json();
    if (!tracking) return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });

    const envio = await prisma.envio.findUnique({
      where: { trackingNumber: tracking },
      include: { courier: true }
    });

    if (!envio) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    if (envio.estadoActual === "CANCELADO") return NextResponse.json({ error: "El envío ya está cancelado" }, { status: 400 });

    const nombreMainCourier = envio.courier.nombre.toLowerCase();

    const credencialMain = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId: envio.empresaId, nombreCourier: nombreMainCourier } }
    });

    // REGLA ESTRICTA DE CREDENCIALES
    let llavesMain = credencialMain?.usaCredencialesPropias 
      ? JSON.parse(credencialMain.credencialesJson || '{}') 
      : obtenerCredencialesShipro(nombreMainCourier);
    
    const motorMain = CourierFactory.crear(nombreMainCourier, llavesMain);
    
    try {
      const canceladoMain = await motorMain.cancelarEnvio(envio.trackingNumber);
      if (!canceladoMain) throw new Error("El courier principal rechazó la cancelación.");
    } catch (error: any) {
      console.error(`[Cancelación] Falló en ${nombreMainCourier}:`, error.message);
      return NextResponse.json({ error: `No se pudo cancelar en ${nombreMainCourier.toUpperCase()}: ${error.message}` }, { status: 400 });
    }

    if (envio.trackingFirstMile && credencialMain?.courierRecolector && credencialMain.courierRecolector !== "mismo_courier") {
      console.log(`🔄 Iniciando cancelación en cascada para el recolector: ${credencialMain.courierRecolector}...`);
      
      const llavesRecolector = obtenerCredencialesShipro(credencialMain.courierRecolector);
      const motorRecolector = CourierFactory.crear(credencialMain.courierRecolector, llavesRecolector);

      try {
        const canceladoRecolector = await motorRecolector.cancelarEnvio(envio.trackingFirstMile);
        if (canceladoRecolector) {
          console.log(`✅ [First-Mile] Tracking ${envio.trackingFirstMile} cancelado con éxito.`);
        } else {
          console.warn(`⚠️ [First-Mile] El recolector no pudo cancelar el tracking ${envio.trackingFirstMile}.`);
        }
      } catch (error: any) {
        console.warn(`⚠️ [First-Mile] Error al cancelar en el recolector:`, error.message);
      }
    }

    await prisma.envio.update({
      where: { id: envio.id },
      data: { estadoActual: "CANCELADO" }
    });

    await prisma.eventoTracking.create({
      data: {
        estado: "CANCELADO",
        observacion: envio.trackingFirstMile ? "Envío y recolección cancelados por el usuario." : "Envío cancelado por el usuario.",
        envioId: envio.id
      }
    });

    return NextResponse.json({ success: true, message: "Cancelación exitosa" });

  } catch (error: any) {
    console.error("Error crítico en cancelación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}