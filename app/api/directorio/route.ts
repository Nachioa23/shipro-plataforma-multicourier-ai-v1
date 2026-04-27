import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresaId");
    const rol = searchParams.get("rol"); // Para saber si es Super Admin
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "25");
    const search = searchParams.get("search") || "";

    if (!empresaId) return NextResponse.json({ error: "Falta empresaId" }, { status: 400 });

    const skip = (page - 1) * limit;

    // Lógica de filtrado: 
    // Si es super_admin, podríamos quitar el filtro de empresaId, 
    // pero por ahora lo mantenemos por seguridad del cliente.
    let where: any = {
      email: { not: "" }, // Solo contactos con mail
      enviosDestino: {
        some: { empresaId: parseInt(empresaId) }
      }
    };

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