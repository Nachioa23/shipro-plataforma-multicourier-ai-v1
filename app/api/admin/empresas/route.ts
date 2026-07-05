import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3: alta admin+operador; edicion/baja solo admin.
  // NOTA: este archivo solo expone GET (lista de empresas para Modo Dios).
  // No hay PUT/PATCH/DELETE que gatear al tier admin-only. La edicion/baja
  // vive en /api/clientes (que tiene su propio gate FAMILIA 3).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const empresas = await prisma.empresa.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    });
    return NextResponse.json(empresas);
  } catch (error) {
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}