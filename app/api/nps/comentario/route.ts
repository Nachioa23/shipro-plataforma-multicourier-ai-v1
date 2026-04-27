import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { 
      tracking, 
      comentario, 
      experienciaEntrega, 
      satisfaccionProducto, 
      probabilidadRecompra, 
      sugerenciaMejora 
    } = await request.json();

    if (!tracking) {
      return NextResponse.json({ error: "Falta el tracking" }, { status: 400 });
    }

    // 1. Buscamos el envío para obtener su ID real
    const envio = await prisma.envio.findUnique({
      where: { trackingNumber: tracking }
    });

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    // 2. Actualizamos la encuesta con el resto de la "Matriz de Fricción"
    await prisma.encuestaNPS.update({
      where: { envioId: envio.id },
      data: { 
        comentario: comentario || null,
        experienciaEntrega: experienciaEntrega || null,
        satisfaccionProducto: satisfaccionProducto ? parseInt(satisfaccionProducto) : null,
        probabilidadRecompra: probabilidadRecompra ? parseInt(probabilidadRecompra) : null,
        sugerenciaMejora: sugerenciaMejora || null
      }
    });

    console.log(`[NPS] Encuesta completa guardada para el envío ${tracking}`);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error guardando encuesta NPS completa:", error.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}