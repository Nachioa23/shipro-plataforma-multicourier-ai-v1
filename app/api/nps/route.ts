import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get("tracking");
    const scoreParam = searchParams.get("score");

    if (!tracking || !scoreParam) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const score = parseInt(scoreParam);
    if (isNaN(score) || score < 0 || score > 10) {
      return NextResponse.json({ error: "Score inválido" }, { status: 400 });
    }

    // 1. Clasificamos el voto (Lógica NPS Estándar)
    let categoria = "PASIVO";
    if (score >= 9) categoria = "PROMOTOR";
    if (score <= 6) categoria = "DETRACTOR";

    // 2. Buscamos el contexto del envío en la base de datos
    const envio = await prisma.envio.findUnique({
      where: { trackingNumber: tracking },
      include: { destino: true, eventos: true }
    });

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    // 3. Calculamos si el SLA se cumplió realmente vs el checkout
    let slaCumplido = null;
    const eventoEntrega = envio.eventos.find(ev => ev.estado.toUpperCase() === "ENTREGADO");
    if (envio.fechaImpresion && eventoEntrega && envio.diasPrometidosCheckout) {
       const diasReales = (eventoEntrega.fecha.getTime() - envio.fechaImpresion.getTime()) / (1000 * 3600 * 24);
       slaCumplido = diasReales <= envio.diasPrometidosCheckout;
    }

    // 4. Verificamos si ya había votado o si es un voto nuevo
    const votoExistente = await prisma.encuestaNPS.findUnique({
      where: { envioId: envio.id }
    });

    if (!votoExistente) {
      // Guardamos la matriz principal
      await prisma.encuestaNPS.create({
        data: {
          score,
          categoria,
          envio: { connect: { id: envio.id } },
          empresa: { connect: { id: envio.empresaId } },
          courier: { connect: { id: envio.courierId } },
          cpDestino: envio.destino?.cp || "0000",
          provincia: envio.destino?.provincia || "Desconocida",
          modalidad: envio.modalidad,
          slaCumplido: slaCumplido
        }
      });
    } else {
      // Si el cliente hizo clic de nuevo en el mail para cambiar su nota inicial
      await prisma.encuestaNPS.update({
        where: { envioId: envio.id },
        data: { score, categoria, slaCumplido }
      });
    }

    // 5. Redirigimos al cliente a la página pública de seguimiento para que complete las otras 5 preguntas
    const baseUrl = process.env.APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${baseUrl}/s/${tracking}?nps=success&score=${score}`);

  } catch (error) {
    console.error("Error procesando NPS Inicial:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}