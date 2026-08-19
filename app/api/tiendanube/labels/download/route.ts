import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  dibujarPaginaEtiqueta,
  dibujarEtiquetaProvisoria,
  PDFDocument,
  StandardFonts,
  type EnvioParaEtiqueta,
} from "@/lib/etiquetas/armar-etiqueta";

// pdf-lib + posible fs.readFileSync del logo (branch Mocis-puro dentro de dibujarPaginaEtiqueta)
// necesitan runtime Node — no edge.
export const runtime = "nodejs";

// DEUDA 144 (Momento 3 labels, pieza 3b Parte 2) — Descarga pública del PDF de etiqueta.
//
// Endpoint PUBLIC (registrado en proxy.ts PUBLIC_API_EXACT). Tiendanube fetchea este URL
// (`download_url_from_app` que le pasamos en el PATCH del labelId — Parte 3). Se
// auto-autentica via el `downloadToken` opaco (192 bits) generado al persistir la
// EtiquetaTiendanube en el worker /generate.
//
// GATES (mirror del patrón DEUDA 106 corregir):
//   1. Existe `?token=...` en el query.
//   2. Existe una fila EtiquetaTiendanube con downloadToken === token.
//   3. La fila NO está en estado "CANCELED" (evita servir un PDF que la NPMS ya invalidó).
// Cualquier fallo → 404 idéntico (no revela existencia).
//
// PDF ON-THE-FLY: cada request carga el envío + crea PDFDocument + embed fonts + llama al
// helper apropiado según `esProvisoria`. Stateless (sin blob storage), siempre fresco. Si
// entre el generate y el download el envío se destraba (SHP-* → tracking real), el PDF
// renderizado usa el estado actual — pero la fila EtiquetaTiendanube conserva su
// esProvisoria original hasta que el flujo de reemplazo (pieza siguiente) la cancele y
// emita una nueva. La coherencia definitiva se garantiza en la NPMS.
//
// SIN expiración por tiempo (Nacho): la URL vive hasta que la etiqueta pase a "CANCELED".
// SIN single-use (Tiendanube guarda el PDF en su S3 y reimprime desde ahí — esa regla vive
// en la NPMS, no acá).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) return new NextResponse("Falta token", { status: 400 });

    // Validar token + gate CANCELED, y cargar el envío con el include EnvioParaEtiqueta
    // en 1 sola query.
    const etiqueta = await prisma.etiquetaTiendanube.findFirst({
      where: { downloadToken: token, estado: { not: "CANCELED" } },
      include: {
        envio: {
          include: {
            courier: true,
            empresa: true,
            origen: true,
            destino: true,
            ordenExterna: true,
            tramos: {
              where: { tipo: "recoleccion" },
              include: { courier: true },
              take: 1,
            },
          },
        },
      },
    });

    // Token inválido / etiqueta CANCELED / no existe → 404 idéntico. No revelar existencia
    // ni distinguir causas: para el fetcher (Tiendanube) es siempre "no encontrado".
    if (!etiqueta || !etiqueta.envio) {
      return new NextResponse("No encontrado", { status: 404 });
    }

    const envio: EnvioParaEtiqueta = etiqueta.envio;

    const pdfDoc = await PDFDocument.create();
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontN = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const ctx = { pdfDoc, fontB, fontN };

    if (etiqueta.esProvisoria) {
      // Envío no despachado en el courier — servimos la etiqueta provisoria de Shipro
      // con banner "PROVISORIA — NO DESPACHAR" (cross-courier, cross-state).
      await dibujarEtiquetaProvisoria(ctx, envio);
    } else {
      // Envío despachado OK — servimos la etiqueta REAL (embed PDF del courier +
      // zócalo Frankenstein del recolector si aplica, o Shipro-nativa para Mocis).
      await dibujarPaginaEtiqueta(ctx, envio);
    }

    const bytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Etiqueta_${etiqueta.labelId}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[/api/tiendanube/labels/download] Error:", e);
    return new NextResponse("Error interno", { status: 500 });
  }
}
