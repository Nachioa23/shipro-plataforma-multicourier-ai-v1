import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, calle, altura, piso, dpto, cp, localidad, provincia, entrecalles } = body;

    if (!id) return NextResponse.json({ error: "Falta el ID de la orden" }, { status: 400 });

    // Actualizamos la orden en la base de datos y la marcamos como "resuelta"
    const ordenResuelta = await prisma.auditoriaCheckout.update({
      where: { id: Number(id) },
      data: {
        resuelto: true, // Esto la saca de la bandeja del operador
        calle,
        altura,
        piso,
        dpto,
        cp,
        localidad,
        provincia,
        entrecalles
      }
    });

    // ACÁ EN EL FUTURO: Se dispara la llamada a la API de Andreani/Moova para generar la etiqueta real.

    return NextResponse.json({ success: true, orden: ordenResuelta });
  } catch (error) {
    console.error("Error al resolver la orden:", error);
    return NextResponse.json({ error: "No se pudo guardar la corrección" }, { status: 500 });
  }
}