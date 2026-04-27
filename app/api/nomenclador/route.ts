import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic'; // Evitamos la caché

// =======================================================================
// GET: Buscar los estados y la lista de Couriers reales
// =======================================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courierIdParam = searchParams.get("courierId");

  try {
    // 1. Buscamos TODOS los couriers que existen en tu base de datos
    const couriers = await prisma.courier.findMany({
      orderBy: { nombre: 'asc' }
    });

    // 2. Filtramos los estados según lo que pida el usuario
    let whereClause = {};
    if (courierIdParam && courierIdParam !== "TODOS") {
      whereClause = { courierId: Number(courierIdParam) };
    }

    // 3. Traemos los nomencladores e INCLUIMOS el nombre del courier
    const nomencladores = await prisma.nomenclador.findMany({
      where: whereClause,
      include: { courier: true }, 
      orderBy: { id: 'asc' }
    });

    return NextResponse.json({ couriers, nomencladores });
  } catch (error) {
    console.error("Error al buscar nomencladores:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// =======================================================================
// POST: Guardar o Actualizar la traducción
// =======================================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { courierId, estadoCrudo, codigoApi, estadoShipro } = body;

    const resultado = await prisma.nomenclador.upsert({
      where: {
        courierId_estadoCrudo: {
          courierId: Number(courierId),
          estadoCrudo: estadoCrudo,
        },
      },
      update: {
        estadoShipro: estadoShipro,
      },
      create: {
        courierId: Number(courierId),
        estadoCrudo: estadoCrudo,
        codigoApi: codigoApi || null,
        estadoShipro: estadoShipro,
      },
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Error guardando en el Nomenclador:", error);
    return NextResponse.json({ error: "Error al guardar el mapeo" }, { status: 500 });
  }
}