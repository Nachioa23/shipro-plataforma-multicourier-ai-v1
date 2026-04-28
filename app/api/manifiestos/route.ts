import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const search = searchParams.get("search") || "";
    const courier = searchParams.get("courier") || "Todos";
    const fechaDesde = searchParams.get("fechaDesde") || "";
    const fechaHasta = searchParams.get("fechaHasta") || "";

    let where: any = {};
    if (ctx.empresaId !== null) where.empresaId = ctx.empresaId;

    if (courier !== "Todos") {
      where.courier = courier;
    }

    if (fechaDesde || fechaHasta) {
      where.fechaCreacion = {}; 
      if (fechaDesde) where.fechaCreacion.gte = new Date(`${fechaDesde}T00:00:00.000Z`);
      if (fechaHasta) where.fechaCreacion.lte = new Date(`${fechaHasta}T23:59:59.999Z`);
    }

    if (search) {
      const isNumber = !isNaN(Number(search));
      
      where.OR = [
        { envios: { some: { trackingNumber: { contains: search } } } }, 
      ];

      if (isNumber) {
         where.OR.push({ numeroCorrelativo: parseInt(search) }); 
      }
    }

    const manifiestos = await prisma.manifiesto.findMany({
      where,
      // ACÁ ESTÁ EL CAMBIO MAGICO: Traemos toda la info para el PDF
      include: { 
        empresa: true,
        envios: { 
          include: { destino: true } 
        } 
      },
      orderBy: { id: 'desc' }
    });

    return NextResponse.json(manifiestos);
  } catch (error) {
    console.error("Error en GET manifiestos:", error);
    return NextResponse.json({ error: "Error al cargar" }, { status: 500 });
  }
}