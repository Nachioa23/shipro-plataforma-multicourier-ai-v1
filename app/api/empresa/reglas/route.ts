import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresaId");
    
    if (!empresaId) return NextResponse.json({ error: "Falta empresaId" }, { status: 400 });

    const reglas = await prisma.reglaRuteo.findMany({
      where: { empresaId: parseInt(empresaId) }
    });
    
    return NextResponse.json(reglas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener reglas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { empresaId, nombre, condicionVariable, condicionOperador, condicionValor1, accionTipo, accionValor, activa } = body;

    // MAGIA: Si el cliente está PRENDIENDO esta regla, apagamos todas las demás de su empresa.
    if (activa) {
      await prisma.reglaRuteo.updateMany({
        where: { empresaId: parseInt(empresaId) },
        data: { activa: false }
      });
    }

    const reglaExistente = await prisma.reglaRuteo.findFirst({
      where: { empresaId: parseInt(empresaId), nombre: nombre }
    });

    if (reglaExistente) {
      const actualizada = await prisma.reglaRuteo.update({
        where: { id: reglaExistente.id },
        data: { condicionValor1: parseFloat(condicionValor1) || 0, accionValor, activa }
      });
      return NextResponse.json(actualizada);
    } else {
      const nueva = await prisma.reglaRuteo.create({
        data: {
          empresaId: parseInt(empresaId),
          nombre, condicionVariable, condicionOperador,
          condicionValor1: parseFloat(condicionValor1) || 0,
          accionTipo, accionValor, activa,
          prioridad: 1 
        }
      });
      return NextResponse.json(nueva);
    }
  } catch (error) {
    return NextResponse.json({ error: "Error al guardar la regla" }, { status: 500 });
  }
}