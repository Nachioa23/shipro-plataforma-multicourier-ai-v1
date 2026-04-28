import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "25");
    const search = searchParams.get("search") || "";

    const skip = (page - 1) * limit;

    let where: any = {
      email: { not: "" }, // Solo contactos con mail
    };
    if (ctx.empresaId !== null) {
      where.enviosDestino = { some: { empresaId: ctx.empresaId } };
    }

    if (search) {
      where.OR = [
        { nombre: { contains: search } },
        { email: { contains: search } },
        { documento: { contains: search } }
      ];
    }

    // 1. Contamos el total para la paginación
    const totalContacts = await prisma.direccion.count({ where });

    // 2. Traemos los datos paginados
    const direcciones = await prisma.direccion.findMany({
      where,
      orderBy: { id: 'desc' }, // El ID más alto es el más reciente (actualización)
      skip,
      take: limit,
    });

    return NextResponse.json({
      data: direcciones,
      meta: {
        total: totalContacts,
        page,
        limit,
        totalPages: Math.ceil(totalContacts / limit)
      }
    });
  } catch (error) {
    console.error("Error en Directorio API:", error);
    return NextResponse.json({ error: "Error al cargar contactos" }, { status: 500 });
  }
}