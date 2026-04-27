import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const reglas = await prisma.reglaRuteo.findMany({
      orderBy: { prioridad: 'asc' }
    });
    return NextResponse.json(reglas);
  } catch (error: any) {
    return NextResponse.json({ error: "Error al obtener las reglas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Calculamos la prioridad: la nueva regla va al final de la cola
    const cantidadActual = await prisma.reglaRuteo.count();
    
    const nuevaRegla = await prisma.reglaRuteo.create({
      data: {
        nombre: body.nombre,
        condicionVariable: body.condicionVariable,
        condicionOperador: body.condicionOperador,
        condicionValor1: body.condicionValor1 ? parseFloat(body.condicionValor1) : null,
        condicionValor2: body.condicionValor2 ? parseFloat(body.condicionValor2) : null,
        accionTipo: body.accionTipo,
        accionValor: body.accionValor || null,
        activa: true,
        prioridad: cantidadActual + 1
      }
    });
    return NextResponse.json(nuevaRegla);
  } catch (error: any) {
    console.error("Error al crear regla:", error);
    return NextResponse.json({ error: "Error al crear la regla" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, activa, prioridad } = body;

    // Si pasamos 'activa', actualizamos el estado
    if (activa !== undefined) {
      const actualizada = await prisma.reglaRuteo.update({
        where: { id: Number(id) },
        data: { activa }
      });
      return NextResponse.json(actualizada);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    
    if (!id) return NextResponse.json({ error: "Falta el ID" }, { status: 400 });

    await prisma.reglaRuteo.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}