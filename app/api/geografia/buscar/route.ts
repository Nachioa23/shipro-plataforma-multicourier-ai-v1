import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cp = searchParams.get('cp');

    if (!cp) {
      return NextResponse.json({ error: "Falta el Código Postal" }, { status: 400 });
    }

    // Buscamos el CP en la base de datos, trayendo también sus localidades y la provincia
    const codigoData = await prisma.codigoPostal.findUnique({
      where: { codigo: cp },
      include: {
        localidades: {
          include: { provincia: true }
        }
      }
    });

    if (!codigoData || codigoData.localidades.length === 0) {
      return NextResponse.json({ error: "Código Postal no encontrado" }, { status: 404 });
    }

    // Formateamos la respuesta para que sea fácil de leer por el Frontend
    const provincia = codigoData.localidades[0].provincia.nombre;
    const localidades = codigoData.localidades.map(loc => loc.nombre);

    return NextResponse.json({ provincia, localidades });

  } catch (error) {
    console.error("Error buscando geografía:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}