import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import fs from 'fs';
import path from 'path';
import { resolverContext } from "@/lib/auth-context";
import { verificarAccesoEnvio } from "@/lib/envios/ownership";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get("tracking");

    if (!tracking) return new NextResponse("Falta el número de tracking", { status: 400 });

    // DEUDA 87 FAMILIA 1: filtrar a envio propio (cliente); shipro ve todo.
    // Ownership anchor = envio.empresaId directo (una etiqueta = un envio =
    // una empresa; la consolidacion de couriers vive en TramoEnvio y no cambia
    // esta relacion).
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    const envio = await verificarAccesoEnvio(
      { trackingNumber: tracking },
      ctx,
      { courier: true, origen: true, destino: true, empresa: true, ordenExterna: true }
    );

    if (!envio) {
      return NextResponse.json({ error: "No hay etiquetas disponibles" }, { status: 404 });
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([288, 432]); // 10x15cm
    
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontN = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Colores de Marca
    const colorShipro = rgb(35/255, 59/255, 107/255); // #233b6b
    const colorFlow = rgb(77/255, 133/255, 204/255);  // #4d85cc
    const colorGris = rgb(0.4, 0.4, 0.4);

    const truncar = (str: string | null | undefined, max: number) => {
      if (!str) return "-";
      return str.length > max ? str.substring(0, max - 2) + ".." : str;
    };
    
    const fecha = envio.fechaImpresion ? new Date(envio.fechaImpresion).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');
    
    let servicio = envio.modalidad.toUpperCase();
    if (servicio.includes('ESTÁNDAR') || servicio.includes('ESTANDAR')) servicio = 'SAME DAY';

    // ==========================================
    // DISEÑO DE LA ETIQUETA NATIVA MOCI'S
    // ==========================================

    // 1. CABECERA (Logo Oficial y Servicio)
    try {
      const logoPath = path.join(process.cwd(), 'public', 'mocis-logo.png');
      const logoBuffer = fs.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedPng(logoBuffer);
      const logoDims = logoImage.scaleToFit(120, 40);
      page.drawImage(logoImage, { x: 10, y: 425 - logoDims.height, width: logoDims.width, height: logoDims.height });
    } catch (e) {
      page.drawText("MOCI'S", { x: 10, y: 395, size: 24, font: fontB });
    }
    
    page.drawText(servicio, { x: 200, y: 400, size: 12, font: fontB, color: colorGris });
    page.drawLine({ start: { x: 10, y: 380 }, end: { x: 278, y: 380 }, thickness: 2 });

    // 2. BLOQUE OPERATIVO (QR y Datos)
    const qrDataUrl = await QRCode.toDataURL(tracking, { margin: 0, scale: 6 });
    const qrImage = await pdfDoc.embedPng(qrDataUrl);
    page.drawImage(qrImage, { x: 10, y: 280, width: 90, height: 90 });

    page.drawText(`TRK: ${tracking}`, { x: 110, y: 355, size: 14, font: fontB });
    page.drawText(`Operador: MOCI'S`, { x: 110, y: 340, size: 9, font: fontN });
    page.drawText(`Orden: ${envio.ordenExterna?.ordenId || envio.id}`, { x: 110, y: 325, size: 9, font: fontN });
    page.drawText(`Fecha: ${fecha}`, { x: 110, y: 310, size: 9, font: fontN });
    page.drawText(`Bultos: 1  |  Peso: ${envio.pesoReal}kg`, { x: 110, y: 295, size: 9, font: fontN });

    page.drawLine({ start: { x: 10, y: 265 }, end: { x: 278, y: 265 }, thickness: 1, dashArray: [3, 3] });

    // 3. REMITENTE
    page.drawText(`REMITENTE (ORIGEN):`, { x: 10, y: 250, size: 7, font: fontB, color: colorGris });
    page.drawText(truncar(envio.origen?.nombre || envio.empresa.nombre, 45), { x: 10, y: 238, size: 10, font: fontB });
    page.drawText(truncar(`${envio.origen?.calle || ''} ${envio.origen?.altura || ''}, ${envio.origen?.localidad || ''}, CP: ${envio.origen?.cp || ''}`, 60), { x: 10, y: 226, size: 9, font: fontN });

    page.drawLine({ start: { x: 10, y: 210 }, end: { x: 278, y: 210 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });

    // 4. DESTINATARIO
    page.drawText(`DESTINATARIO (FINAL):`, { x: 10, y: 195, size: 7, font: fontB, color: colorGris });
    page.drawText(truncar(envio.destino?.nombre || '', 35), { x: 10, y: 180, size: 14, font: fontB });
    page.drawText(truncar(`${envio.destino?.calle || ''} ${envio.destino?.altura || ''} ${envio.destino?.piso || ''} ${envio.destino?.dpto || ''}`, 45), { x: 10, y: 165, size: 12, font: fontB });
    page.drawText(truncar(`${envio.destino?.localidad || ''}, ${envio.destino?.provincia || ''}`, 50), { x: 10, y: 151, size: 10, font: fontN });
    page.drawText(`CP: ${envio.destino?.cp || ''}  |  Tel: ${envio.destino?.telefono || '-'}`, { x: 10, y: 137, size: 10, font: fontB });

    page.drawLine({ start: { x: 10, y: 120 }, end: { x: 278, y: 120 }, thickness: 2 });

    // 5. ACLARACIÓN LEGAL MOCI'S
    page.drawText("IMPORTANTE: se aclara que Moci's solo se limita al transporte de", { x: 10, y: 105, size: 7, font: fontN, color: colorGris });
    page.drawText("envíos y no es propietario, ni responsable en forma y modo alguno por el", { x: 10, y: 95, size: 7, font: fontN, color: colorGris });
    page.drawText("contenido en este envío, siendo el remitente el responsable sobre su contenido.", { x: 10, y: 85, size: 7, font: fontN, color: colorGris });

    // 6. PIE DE PÁGINA (Branding SHIPRO FLOW - Espaciado Preciso)
    page.drawText("Generado por", { x: 10, y: 15, size: 6, font: fontN, color: colorGris });
    page.drawText("SHIPRO", { x: 49, y: 15, size: 7, font: fontB, color: colorShipro });
    page.drawText("FLOW", { x: 77, y: 15, size: 7, font: fontN, color: colorFlow });
    page.drawText(" | Plataforma Multicourier", { x: 100, y: 15, size: 6, font: fontN, color: colorGris });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Etiqueta_Mocis_${tracking}.pdf"` }
    });

  } catch (error: any) {
    return new NextResponse(`Error interno al generar la etiqueta: ${error.message}`, { status: 500 });
  }
}