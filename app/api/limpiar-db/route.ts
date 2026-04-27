import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // 1. Borramos toda la data transaccional (hijos) para destrabar las Claves Foráneas
    await prisma.movimientoFinanciero.deleteMany({});
    await prisma.auditoriaSoporte.deleteMany({});
    await prisma.ticketSoporte.deleteMany({});
    await prisma.eventoTracking.deleteMany({});
    await prisma.encuestaNPS.deleteMany({});
    await prisma.auditoriaCheckout.deleteMany({});
    
    // 2. Borramos los Envíos y sus Finanzas
    await prisma.envio.deleteMany({});
    await prisma.finanzasEnvio.deleteMany({});
    await prisma.manifiesto.deleteMany({});
    await prisma.liquidacionMensual.deleteMany({});

    // 3. Borramos los nomencladores
    await prisma.nomenclador.deleteMany({});

    // 4. AHORA SÍ: Borramos TODOS los couriers EXCEPTO el 1 (Andreani) y el 2 (Mocis)
    const couriersBorrados = await prisma.courier.deleteMany({
      where: {
        id: { notIn: [1, 2] }
      }
    });

    // 5. Nos aseguramos de que el 1 y 2 tengan el nombre oficial perfecto
    await prisma.courier.updateMany({ where: { id: 1 }, data: { nombre: "Andreani" } });
    await prisma.courier.updateMany({ where: { id: 2 }, data: { nombre: "Mocis" } });

    return NextResponse.json({ 
      success: true, 
      message: "¡BÓVEDA LIMPIA! Se borró todo el historial sucio. Quedaron solo Andreani (1) y Mocis (2).",
      couriersEliminados: couriersBorrados.count
    });

  } catch (error: any) {
    console.error("Error en limpieza masiva:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}