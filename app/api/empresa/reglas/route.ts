import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const where: any = {};
    if (ctx.empresaId !== null) where.empresaId = ctx.empresaId;

    const reglas = await prisma.reglaRuteo.findMany({ where });

    return NextResponse.json(reglas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener reglas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = resolverContext(request, body.filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    if (ctx.empresaId === null) {
      return NextResponse.json({ error: "Crear/actualizar reglas requiere especificar una empresa." }, { status: 400 });
    }
    const empresaId = ctx.empresaId;

    const { nombre, condicionVariable, condicionOperador, condicionValor1, accionTipo, accionValor, activa } = body;

    // MAGIA: Si el cliente está PRENDIENDO esta regla, apagamos todas las demás de su empresa.
    if (activa) {
      await prisma.reglaRuteo.updateMany({
        where: { empresaId },
        data: { activa: false }
      });
    }

    const reglaExistente = await prisma.reglaRuteo.findFirst({
      where: { empresaId, nombre: nombre }
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
          empresaId,
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
