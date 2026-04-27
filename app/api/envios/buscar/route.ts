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

    // Buscamos el envío asegurándonos de que encuentre el principal o el de colecta
    const envio = await prisma.envio.findFirst({
      where: {
        OR: [
          { trackingNumber: trackingLimpio },
          { trackingFirstMile: trackingLimpio }
        ]
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