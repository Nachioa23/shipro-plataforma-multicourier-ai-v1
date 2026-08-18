import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  dibujarPaginaEtiqueta,
  PDFDocument,
  StandardFonts,
} from "@/lib/etiquetas/armar-etiqueta";
import { rgb } from "pdf-lib";

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();
    if (!ids || !ids.length) return new NextResponse("Faltan IDs", { status: 400 });

    // DEUDA 87 FAMILIA 1: filtrar a envios propios (cliente); shipro ve todo.
    // Batch scoping via el where del findMany — envios de otras empresas se
    // eliminan silenciosamente. La consolidacion (multi-tramo/multi-courier) NO
    // se ve afectada: cada envio pertenece a una empresa, aunque sus tramos
    // los operen distintos couriers.
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    const enviosWhere: any = { id: { in: ids } };
    if (ctx.empresaId !== null) enviosWhere.empresaId = ctx.empresaId;

    const envios = await prisma.envio.findMany({
      where: enviosWhere,
      include: {
        courier: true,
        empresa: true,
        origen: true,
        destino: true,
        ordenExterna: true,
        // DEUDA 29 Sub-fase 1.C.2: el zócalo Frankenstein con QR del recolector
        // ahora se construye desde TramoEnvio (tipo="recoleccion"), reemplazando
        // los campos eliminados envio.trackingFirstMile + credencial.courierRecolector.
        tramos: {
          where: { tipo: "recoleccion" },
          include: { courier: true },
          take: 1,
        },
      }
    });

    if (envios.length === 0) {
      return NextResponse.json({ error: "No hay etiquetas disponibles" }, { status: 404 });
    }

    // Refactor-B (DEUDA 144 Momento 3): la lógica de dibujado vive en
    // lib/etiquetas/armar-etiqueta.ts (compartida con el worker Tiendanube).
    // Acá quedamos con auth + load + accumulator + response — el batch route
    // sólo posee el PDFDocument acumulador y las fonts embebidas una sola vez.
    const pdfMaestro = await PDFDocument.create();
    const fontB = await pdfMaestro.embedFont(StandardFonts.HelveticaBold);
    const fontN = await pdfMaestro.embedFont(StandardFonts.Helvetica);
    const etiquetaCtx = { pdfDoc: pdfMaestro, fontB, fontN };

    for (const envio of envios) {
      try {
        await dibujarPaginaEtiqueta(etiquetaCtx, envio);
      } catch (e: any) {
        // Resiliencia batch: un envío roto no debe tumbar los demás.
        console.error(`[PDF Masivo] No se pudo procesar la etiqueta ${envio.trackingNumber}:`, e.message);
      }
    }

    // Fallback batch-level: si TODAS las páginas fallaron (o el batch quedó vacío),
    // producimos una página de error explícita en lugar de un PDF de 0 páginas.
    if (pdfMaestro.getPageCount() === 0) {
      const colorShipro = rgb(35/255, 59/255, 107/255);
      const errorPage = pdfMaestro.addPage([288, 432]);
      errorPage.drawText("No se pudo generar ninguna etiqueta.", { x: 20, y: 200, size: 12, font: fontB, color: colorShipro });
      errorPage.drawText("El correo logístico no respondió con los PDFs válidos.", { x: 20, y: 180, size: 10, font: fontN });
    }

    const finalPdfBytes = await pdfMaestro.save();
    return new NextResponse(Buffer.from(finalPdfBytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Etiquetas_Shipro.pdf"' }
    });

  } catch (error) {
    return new NextResponse("Error interno al generar lote", { status: 500 });
  }
}
