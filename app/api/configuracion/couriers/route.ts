import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = parseInt(searchParams.get("empresaId") || "1");

    // 1. Buscamos la lista maestra de Couriers que el Super Admin dio de alta
    const couriersMaestros = await prisma.courier.findMany({
      where: { activo: true }
    });

    // 2. Buscamos qué configuraciones específicas guardó esta Empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { credenciales: true }
    });

    if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    return NextResponse.json({ 
      empresa: { ordenamientoDefault: empresa.ordenamientoDefault },
      credencialesCliente: empresa.credenciales,
      couriersGlobales: couriersMaestros // <--- Enviamos la lista maestra al Frontend
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Falla al leer la base de datos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { empresaId, configsGenerales, couriers } = body;

    // 1. Guardamos reglas globales
    await prisma.empresa.update({
      where: { id: parseInt(empresaId) },
      data: { ordenamientoDefault: configsGenerales.ordenamiento }
    });

    // 2. Guardamos la config de cada courier
    for (const courier of couriers) {
      const credencialesJson = courier.usaPropias ? JSON.stringify(courier.credenciales) : null;
      const serviciosActivos = JSON.stringify(courier.servicios || []);
      const provinciasCobertura = JSON.stringify(courier.provincias || []);
      
      const alcance = ['Moova', 'Mocis'].includes(courier.id) ? 'LOCAL' : 'NACIONAL';

      await prisma.credencialCourier.upsert({
        where: {
          empresaId_nombreCourier: {
            empresaId: parseInt(empresaId),
            nombreCourier: courier.id,
          }
        },
        update: {
          activo: courier.activo,
          usaCredencialesPropias: courier.usaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          provinciasCobertura: provinciasCobertura,
          ajusteTarifaPorcentaje: parseFloat(courier.markupClientePorcentaje) || 0,
          markupFijo: parseFloat(courier.markupClienteFijo) || 0, 
          courierRecolector: courier.recolector,
          requiereSeguro: courier.seguroActivado || false,
        },
        create: {
          empresaId: parseInt(empresaId),
          nombreCourier: courier.id,
          activo: courier.activo,
          usaCredencialesPropias: courier.usaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          provinciasCobertura: provinciasCobertura,
          ajusteTarifaPorcentaje: parseFloat(courier.markupClientePorcentaje) || 0,
          markupFijo: parseFloat(courier.markupClienteFijo) || 0,
          courierRecolector: courier.recolector,
          requiereSeguro: courier.seguroActivado || false,
          tipoAlcance: alcance,
        }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error guardando:", error);
    return NextResponse.json({ error: "Falla al guardar en la base de datos" }, { status: 500 });
  }
}