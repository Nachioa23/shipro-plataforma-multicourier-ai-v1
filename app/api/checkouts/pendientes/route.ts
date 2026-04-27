import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // Buscamos todas las órdenes frenadas que aún no fueron resueltas por el operador
    const pendientes = await prisma.auditoriaCheckout.findMany({
      where: { resuelto: false },
      orderBy: { fechaCreacion: 'desc' } // Las más nuevas arriba
    });
    
    return NextResponse.json(pendientes);
  } catch (error) {
    console.error("Error al buscar pendientes:", error);
    return NextResponse.json({ error: "No se pudieron cargar las órdenes" }, { status: 500 });
  }
}