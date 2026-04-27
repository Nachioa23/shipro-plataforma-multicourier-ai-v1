import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const feriados = await prisma.feriado.findMany({
      where: { activo: true },
      orderBy: { fecha: 'asc' }
    });
    return NextResponse.json(feriados);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener feriados" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fechasRaw } = await request.json(); // Esperamos "2026-01-01, 2026-03-24..."
    
    // 1. Convertimos el string en un Array de fechas limpias
    const fechasLimpas = fechasRaw
      .split(',')
      .map((f: string) => f.trim())
      .filter((f: string) => f.length > 0);

    // 2. Proceso de guardado (Limpiamos los de este año y cargamos los nuevos)
    // Nota: Esto es más seguro que el upsert para cargas masivas de este tipo
    for (const fechaStr of fechasLimpas) {
      const fechaObjeto = new Date(fechaStr + "T00:00:00");
      
      if (!isNaN(fechaObjeto.getTime())) {
        await prisma.feriado.upsert({
          where: { fecha: fechaObjeto },
          update: { activo: true },
          create: { fecha: fechaObjeto, descripcion: "Feriado Nacional" }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error guardando feriados:", error);
    return NextResponse.json({ error: "Error al procesar las fechas" }, { status: 500 });
  }
}