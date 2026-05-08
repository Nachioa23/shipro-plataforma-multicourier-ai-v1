import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { AndreaniAdapter } from "@/lib/couriers/AndreaniAdapter";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import fs from 'fs';
import path from 'path';
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { obtenerCredencialCourier, normalizarParaComparacion } from "@/lib/couriers/normalizar";

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();
    if (!ids || !ids.length) return new NextResponse("Faltan IDs", { status: 400 });

    const envios = await prisma.envio.findMany({
      where: { id: { in: ids } },
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

    const pdfMaestro = await PDFDocument.create();
    const fontB = await pdfMaestro.embedFont(StandardFonts.HelveticaBold);
    const fontN = await pdfMaestro.embedFont(StandardFonts.Helvetica);

    const colorShipro = rgb(35/255, 59/255, 107/255); 
    const colorFlow = rgb(77/255, 133/255, 204/255);  
    const colorGris = rgb(0.4, 0.4, 0.4);

    const truncar = (str: string | null | undefined, max: number) => {
      if (!str) return "-";
      return str.length > max ? str.substring(0, max - 2) + ".." : str;
    };

    for (const envio of envios) {
      if (!envio.trackingNumber) continue; // Si no hay tracking, ignoramos

      const nombreNormalizado = normalizarParaComparacion(envio.courier.nombre);
      const fecha = envio.fechaImpresion ? new Date(envio.fechaImpresion).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');

      // CASO BLOQUEADO_SALDO (DEUDA 16): el envío no tiene etiqueta real porque
      // nunca se llamó al courier. Generamos página placeholder con instrucciones.
      if (envio.estadoActual === "BLOQUEADO_SALDO") {
        const colorRojo = rgb(0.85, 0.15, 0.15);
        const pageBloq = pdfMaestro.addPage([288, 432]);
        pageBloq.drawText("ETIQUETA BLOQUEADA", { x: 35, y: 260, size: 16, font: fontB, color: colorRojo });
        pageBloq.drawText("PENDIENTE DE SALDO", { x: 35, y: 240, size: 14, font: fontB, color: colorShipro });
        pageBloq.drawText(`Trk: ${envio.trackingNumber}`, { x: 35, y: 200, size: 10, font: fontN, color: colorGris });
        pageBloq.drawText(`Destinatario: ${truncar(envio.destino?.nombre, 30)}`, { x: 35, y: 180, size: 9, font: fontN, color: colorGris });
        pageBloq.drawText("Cargá saldo en Shipro para destrabar este envío.", { x: 35, y: 140, size: 9, font: fontN });
        pageBloq.drawText("Una vez con saldo, la etiqueta se genera automáticamente.", { x: 35, y: 125, size: 9, font: fontN });
        continue;
      }

      // CASO BLOQUEADO_DEPOSITO (DEUDA 27): el envío no tiene etiqueta real porque
      // la empresa todavía no configuró un depósito predeterminado. Placeholder análogo.
      if (envio.estadoActual === "BLOQUEADO_DEPOSITO") {
        const colorRojo = rgb(0.85, 0.15, 0.15);
        const pageBloq = pdfMaestro.addPage([288, 432]);
        pageBloq.drawText("ETIQUETA BLOQUEADA", { x: 35, y: 260, size: 16, font: fontB, color: colorRojo });
        pageBloq.drawText("PENDIENTE DE CONFIGURACIÓN", { x: 35, y: 240, size: 12, font: fontB, color: colorShipro });
        pageBloq.drawText("DE DEPÓSITO", { x: 35, y: 225, size: 12, font: fontB, color: colorShipro });
        pageBloq.drawText(`Trk: ${envio.trackingNumber}`, { x: 35, y: 195, size: 10, font: fontN, color: colorGris });
        pageBloq.drawText(`Destinatario: ${truncar(envio.destino?.nombre, 30)}`, { x: 35, y: 175, size: 9, font: fontN, color: colorGris });
        pageBloq.drawText("Configurá un depósito predeterminado en Shipro", { x: 35, y: 135, size: 9, font: fontN });
        pageBloq.drawText("para destrabar este envío.", { x: 35, y: 122, size: 9, font: fontN });
        continue;
      }

      // CASO BLOQUEADO_PARCIAL (DEUDA 29 Sub-fase 1.C.2): el courier rechazó la
      // generación de etiqueta del Last-Mile. Puede haber tramos huérfanos
      // persistidos (caso C consolidador con tramo 1 OK + tramo 2 falla). Sin
      // etiqueta del Last-Mile el cliente no puede operar el paquete; el operador
      // debe resolver manualmente antes de poder imprimir.
      if (envio.estadoActual === "BLOQUEADO_PARCIAL") {
        const colorRojo = rgb(0.85, 0.15, 0.15);
        const pageBloq = pdfMaestro.addPage([288, 432]);
        pageBloq.drawText("ETIQUETA BLOQUEADA", { x: 35, y: 280, size: 16, font: fontB, color: colorRojo });
        pageBloq.drawText("DESPACHO PARCIAL O FALLIDO", { x: 35, y: 260, size: 12, font: fontB, color: colorShipro });
        pageBloq.drawText(`Trk: ${envio.trackingNumber}`, { x: 35, y: 230, size: 10, font: fontN, color: colorGris });
        pageBloq.drawText(`Destinatario: ${truncar(envio.destino?.nombre, 30)}`, { x: 35, y: 210, size: 9, font: fontN, color: colorGris });
        pageBloq.drawText("El courier rechazó la generación de etiqueta.", { x: 35, y: 170, size: 9, font: fontN });
        if (envio.tramos.length > 0) {
          pageBloq.drawText(`Tramos despachados: ${envio.tramos.length} (revisar manualmente).`, { x: 35, y: 155, size: 9, font: fontN });
        }
        pageBloq.drawText("El operador debe resolver manualmente.", { x: 35, y: 135, size: 9, font: fontN });
        continue;
      }

      try {
        // ==============================================================
        // CASO 1: ES MOCI'S PURO (Etiqueta Nativa Shipro Flow)
        // ==============================================================
        if (nombreNormalizado === 'mocis') {
          const page = pdfMaestro.addPage([288, 432]);
          
          let servicio = envio.modalidad.toUpperCase();
          if (servicio.includes('ESTÁNDAR') || servicio.includes('ESTANDAR')) servicio = 'SAME DAY';

          try {
            const logoPath = path.join(process.cwd(), 'public', 'mocis-logo.png');
            const logoBuffer = fs.readFileSync(logoPath);
            const logoImage = await pdfMaestro.embedPng(logoBuffer);
            const logoDims = logoImage.scaleToFit(120, 40);
            page.drawImage(logoImage, { x: 10, y: 425 - logoDims.height, width: logoDims.width, height: logoDims.height });
          } catch (e) {
            page.drawText("MOCI'S", { x: 10, y: 395, size: 24, font: fontB });
          }
          
          page.drawText(servicio, { x: 200, y: 400, size: 12, font: fontB, color: colorGris });
          page.drawLine({ start: { x: 10, y: 380 }, end: { x: 278, y: 380 }, thickness: 2 });

          const qrDataUrl = await QRCode.toDataURL(envio.trackingNumber, { margin: 0, scale: 6 });
          const qrImage = await pdfMaestro.embedPng(qrDataUrl);
          page.drawImage(qrImage, { x: 10, y: 280, width: 90, height: 90 });

          page.drawText(`TRK: ${envio.trackingNumber}`, { x: 110, y: 355, size: 14, font: fontB });
          page.drawText(`Operador: MOCI'S`, { x: 110, y: 340, size: 9, font: fontN });
          page.drawText(`Orden: ${envio.ordenExterna?.ordenId || envio.id}`, { x: 110, y: 325, size: 9, font: fontN });
          page.drawText(`Fecha: ${fecha}`, { x: 110, y: 310, size: 9, font: fontN });
          page.drawText(`Bultos: 1  |  Peso: ${envio.pesoReal}kg`, { x: 110, y: 295, size: 9, font: fontN });

          page.drawLine({ start: { x: 10, y: 265 }, end: { x: 278, y: 265 }, thickness: 1, dashArray: [3, 3] });

          page.drawText(`REMITENTE (ORIGEN):`, { x: 10, y: 250, size: 7, font: fontB, color: colorGris });
          page.drawText(truncar(envio.origen?.nombre || envio.empresa.nombre, 45), { x: 10, y: 238, size: 10, font: fontB });
          page.drawText(truncar(`${envio.origen?.calle || ''} ${envio.origen?.altura || ''}, ${envio.origen?.localidad || ''}, CP: ${envio.origen?.cp || ''}`, 60), { x: 10, y: 226, size: 9, font: fontN });

          page.drawLine({ start: { x: 10, y: 210 }, end: { x: 278, y: 210 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });

          page.drawText(`DESTINATARIO (FINAL):`, { x: 10, y: 195, size: 7, font: fontB, color: colorGris });
          page.drawText(truncar(envio.destino?.nombre || '', 35), { x: 10, y: 180, size: 14, font: fontB });
          page.drawText(truncar(`${envio.destino?.calle || ''} ${envio.destino?.altura || ''} ${envio.destino?.piso || ''} ${envio.destino?.dpto || ''}`, 45), { x: 10, y: 165, size: 12, font: fontB });
          page.drawText(truncar(`${envio.destino?.localidad || ''}, ${envio.destino?.provincia || ''}`, 50), { x: 10, y: 151, size: 10, font: fontN });
          page.drawText(`CP: ${envio.destino?.cp || ''}  |  Tel: ${envio.destino?.telefono || '-'}`, { x: 10, y: 137, size: 10, font: fontB });

          page.drawLine({ start: { x: 10, y: 120 }, end: { x: 278, y: 120 }, thickness: 2 });

          page.drawText("IMPORTANTE: se aclara que Moci's solo se limita al transporte de", { x: 10, y: 105, size: 7, font: fontN, color: colorGris });
          page.drawText("envíos y no es propietario, ni responsable en forma y modo alguno por el", { x: 10, y: 95, size: 7, font: fontN, color: colorGris });
          page.drawText("contenido en este envío, siendo el remitente el responsable sobre su contenido.", { x: 10, y: 85, size: 7, font: fontN, color: colorGris });

          page.drawText("Generado por", { x: 10, y: 15, size: 6, font: fontN, color: colorGris });
          page.drawText("SHIPRO", { x: 49, y: 15, size: 7, font: fontB, color: colorShipro });
          page.drawText("FLOW", { x: 77, y: 15, size: 7, font: fontN, color: colorFlow });
          page.drawText(" | Plataforma Multicourier", { x: 100, y: 15, size: 6, font: fontN, color: colorGris });
          continue; 
        }

        // ==============================================================
        // CASO 2: ES ANDREANI / OTROS (Etiqueta Original + Frankenstein)
        // ==============================================================
        if (!envio.etiquetaUrl) {
          const pageError = pdfMaestro.addPage([288, 432]);
          pageError.drawText("ETIQUETA EN PROCESO", { x: 40, y: 220, size: 16, font: fontB, color: colorShipro });
          pageError.drawText(`Trk: ${envio.trackingNumber}`, { x: 40, y: 200, size: 10, font: fontN, color: colorGris });
          pageError.drawText("El correo aún no ha devuelto el PDF oficial.", { x: 40, y: 180, size: 10, font: fontN });
          continue;
        }

        const credencial = await obtenerCredencialCourier(envio.empresaId, envio.courier.nombre);
        
        let llaves = credencial?.usaCredencialesPropias
          ? parsearCredencialesPropias(nombreNormalizado, credencial.credencialesJson)
          : obtenerCredencialesShipro(nombreNormalizado);

        let pdfBuffer: ArrayBuffer | Uint8Array;
        const motor = CourierFactory.crear(nombreNormalizado, llaves);

        if (nombreNormalizado === 'andreani') {
           const bufferMotor = await (motor as AndreaniAdapter).obtenerEtiquetaBuffer(envio.etiquetaUrl as string);
           // @ts-ignore
           pdfBuffer = bufferMotor.buffer || bufferMotor;
        } else {
           const res = await fetch(envio.etiquetaUrl as string);
           pdfBuffer = await res.arrayBuffer();
        }

        const pdfOriginal = await PDFDocument.load(pdfBuffer);
        const paginasOriginales = pdfOriginal.getPages();
        const [paginaEmbebida] = await pdfMaestro.embedPages([paginasOriginales[0]]);

        const nuevaPagina = pdfMaestro.addPage([288, 432]);

        // DEUDA 29 Sub-fase 1.C.2: el zócalo Frankenstein con QR del recolector
        // ahora se construye desde el tramo de tipo "recoleccion" (filtrado en el
        // findMany). Reemplaza la lectura legacy de envio.trackingFirstMile +
        // credencial.courierRecolector. Si no hay tramo de recolección (envío sin
        // first-mile o legacy), tieneFirstMile=false y el zócalo no se renderiza.
        const tramoRecoleccion = envio.tramos[0] || null;
        const tieneFirstMile = !!tramoRecoleccion?.trackingExterno;
        const alturaDisponible = tieneFirstMile ? 350 : 432;

        const factorEscala = Math.min(288 / paginaEmbebida.width, alturaDisponible / paginaEmbebida.height);
        const dimensiones = paginaEmbebida.scale(factorEscala);

        nuevaPagina.drawPage(paginaEmbebida, {
          x: (288 - dimensiones.width) / 2,
          y: 432 - dimensiones.height,
          width: dimensiones.width,
          height: dimensiones.height,
        });

        // FRANKENSTEIN ZÓCALO
        if (tieneFirstMile) {
          nuevaPagina.drawLine({ start: { x: 10, y: 82 }, end: { x: 278, y: 82 }, thickness: 1, color: rgb(0.5, 0.5, 0.5), dashArray: [3, 3] });
          const qrDataUrl = await QRCode.toDataURL(tramoRecoleccion!.trackingExterno!, { margin: 0, scale: 4 });
          const qrImage = await pdfMaestro.embedPng(qrDataUrl);
          nuevaPagina.drawImage(qrImage, { x: 10, y: 20, width: 55, height: 55 });

          const remitenteNombre = truncar(envio.origen?.nombre, 28);
          const remitenteDir = truncar(`${envio.origen?.calle || ''} ${envio.origen?.altura || ''}, ${envio.origen?.localidad || ''}`, 30);
          const destNombre = truncar(envio.destino?.nombre, 28);
          const destDir = truncar(`${envio.destino?.calle || ''} ${envio.destino?.altura || ''}, CP:${envio.destino?.cp || ''}`, 30);

          // El nombre del recolector viene de la FK del tramo (siempre garantizado por schema).
          const recolectorNombre = tramoRecoleccion!.courier.nombre.toUpperCase();

          nuevaPagina.drawText("RECOLECCIÓN", { x: 72, y: 70, size: 8, font: fontB, color: rgb(0.2, 0.2, 0.2) });
          nuevaPagina.drawText(`TRK: ${tramoRecoleccion!.trackingExterno}`, { x: 72, y: 58, size: 10, font: fontB, color: rgb(0, 0, 0) });
          nuevaPagina.drawText(`Operador:`, { x: 72, y: 44, size: 6, font: fontB, color: rgb(0.4, 0.4, 0.4) });
          nuevaPagina.drawText(recolectorNombre, { x: 108, y: 44, size: 6, font: fontB, color: rgb(0, 0, 0) });
          nuevaPagina.drawText(`Traspaso a:`, { x: 72, y: 34, size: 6, font: fontB, color: rgb(0.4, 0.4, 0.4) });
          nuevaPagina.drawText(nombreNormalizado.toUpperCase(), { x: 108, y: 34, size: 6, font: fontB, color: rgb(0, 0, 0) });
          nuevaPagina.drawText(`Bultos: 1  |  Peso: ${envio.pesoReal}kg`, { x: 72, y: 24, size: 6, font: fontN, color: rgb(0, 0, 0) });

          nuevaPagina.drawText("REMITENTE (ORIGEN):", { x: 175, y: 70, size: 5, font: fontB, color: rgb(0.5, 0.5, 0.5) });
          nuevaPagina.drawText(remitenteNombre, { x: 175, y: 63, size: 6, font: fontB, color: rgb(0, 0, 0) });
          nuevaPagina.drawText(remitenteDir, { x: 175, y: 56, size: 5.5, font: fontN, color: rgb(0, 0, 0) });
          nuevaPagina.drawText("DESTINATARIO (FINAL):", { x: 175, y: 44, size: 5, font: fontB, color: rgb(0.5, 0.5, 0.5) });
          nuevaPagina.drawText(destNombre, { x: 175, y: 37, size: 6, font: fontB, color: rgb(0, 0, 0) });
          nuevaPagina.drawText(destDir, { x: 175, y: 30, size: 5.5, font: fontN, color: rgb(0, 0, 0) });

          nuevaPagina.drawText("Generado por", { x: 72, y: 10, size: 5, font: fontN, color: colorGris });
          nuevaPagina.drawText("SHIPRO", { x: 105, y: 10, size: 6, font: fontB, color: colorShipro });
          nuevaPagina.drawText("FLOW", { x: 129, y: 10, size: 6, font: fontN, color: colorFlow });
          nuevaPagina.drawText(" | Plataforma Multicourier", { x: 150, y: 10, size: 5, font: fontN, color: colorGris });
        }

      } catch(e: any) {
        console.error(`[PDF Masivo] No se pudo procesar la etiqueta ${envio.trackingNumber}:`, e.message);
      }
    }

    if (pdfMaestro.getPageCount() === 0) {
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