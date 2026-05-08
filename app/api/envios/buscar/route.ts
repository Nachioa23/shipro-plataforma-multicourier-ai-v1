import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Le ordenamos a Next.js que NUNCA guarde en caché esta búsqueda
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Agarramos lo que el operador o destinatario escribió
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });
    }

    const trackingLimpio = tracking.trim();

    // TODO DEUDA 29 Sub-fase 3: extender búsqueda a TramoEnvio.trackingExterno para
    // recuperar el comportamiento de "buscar también por tracking de colecta" que daba
    // el campo legacy trackingFirstMile.
    const envio = await prisma.envio.findFirst({
      where: {
        trackingNumber: trackingLimpio
      },
      include: { 
        courier: true, 
        destino: true, 
        empresa: true,
        // MAGIA: Traemos el historial real de trazabilidad, del más nuevo al más viejo
        eventos: {
          orderBy: { fecha: 'desc' }
        }
      } 
    });

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    return NextResponse.json(envio);
  } catch (error) {
    console.error("Error buscando envío público:", error);
    return NextResponse.json({ error: "Error al buscar el envío" }, { status: 500 });
  }
}