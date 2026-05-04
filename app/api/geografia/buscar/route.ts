import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizarProvincia } from "@/lib/constants/normalizar-provincia";

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

    // Normalizamos la provincia a la lista canónica PROVINCIAS_AR (DEUDA 4).
    // La BD tiene 24 provincias reales en MAYÚSCULAS sin acentos + 20 entradas
    // basura del parseo CSV. Si la primera localidad apunta a basura, devolvemos
    // provincia: null (limpieza estructural pendiente — DEUDA 26).
    const provinciaRaw = codigoData.localidades[0].provincia.nombre;
    const provincia = normalizarProvincia(provinciaRaw);

    if (!provincia) {
      return NextResponse.json({ provincia: null, localidades: [] });
    }

    const localidades = codigoData.localidades.map(loc => loc.nombre);

    return NextResponse.json({ provincia, localidades });

  } catch (error) {
    console.error("Error buscando geografía:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}