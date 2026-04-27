import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// =================================================================
// GET: TRAER TODOS LOS COURIERS MAESTROS
// =================================================================
export async function GET() {
  try {
    const couriers = await prisma.courier.findMany({
      orderBy: { nombre: 'asc' }
    });
    
    return NextResponse.json(couriers);
  } catch (error: any) {
    console.error("❌ Error al obtener couriers:", error.message);
    return NextResponse.json({ error: "Error al obtener couriers" }, { status: 500 });
  }
}

// =================================================================
// PUT: ACTUALIZAR DATOS DE SOPORTE O PRENDER/APAGAR
// =================================================================
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, activo, emailSoporte, telefonoSoporte, contactoComercial, logoUrl } = body;

    if (!id) {
      return NextResponse.json({ error: "Falta el ID del courier" }, { status: 400 });
    }

    const courierActualizado = await prisma.courier.update({
      where: { id: Number(id) },
      data: {
        activo: activo,
        emailSoporte: emailSoporte || null,
        telefonoSoporte: telefonoSoporte || null,
        contactoComercial: contactoComercial || null,
        logoUrl: logoUrl || null
      }
    });

    return NextResponse.json(courierActualizado);
  } catch (error: any) {
    console.error("❌ Error al actualizar courier:", error.message);
    return NextResponse.json({ error: "No se pudo actualizar el courier" }, { status: 500 });
  }
}

// =================================================================
// POST: CREAR UN COURIER NUEVO DESDE CERO
// =================================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nombre } = body;

    if (!nombre) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const nuevoCourier = await prisma.courier.create({
      data: {
        nombre: nombre,
        activo: true
      }
    });

    return NextResponse.json(nuevoCourier);
  } catch (error: any) {
    console.error("❌ Error al crear courier:", error.message);
    return NextResponse.json({ error: "No se pudo crear el courier" }, { status: 500 });
  }
}