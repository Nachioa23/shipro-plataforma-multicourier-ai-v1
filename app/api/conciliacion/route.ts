import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { filasExcel, referenciaFactura } = await request.json();
    
    if (!filasExcel || !Array.isArray(filasExcel) || !referenciaFactura) {
      return NextResponse.json({ error: "Faltan datos o no se indicó el Número de Factura del Courier." }, { status: 400 });
    }

    let resultados = {
      procesados: 0,
      aprobadosParaCliente: 0,
      alertasDobleCobro: 0,
      alertasSobreprecio: 0,
      montoARecuperar: 0
    };

    for (const fila of filasExcel) {
      // 1. Buscamos el envío
      const envio = await prisma.envio.findUnique({
        where: { trackingNumber: fila.tracking },
        include: { 
          finanzas: true, 
          empresa: { include: { credenciales: true } },
          courier: true 
        }
      });

      if (!envio || !envio.finanzas) continue;
      
      // ==========================================
      // ESCUDO 1: ANTI-DOBLE COBRO (Caso UPS)
      // ==========================================
      // Si el envío ya fue facturado al cliente en el pasado, o si ya tiene un número de factura de courier asignado
      if (envio.estadoLiquidacion === "LIQUIDADO" || envio.finanzas.facturaCourierRef !== null) {
        
        await prisma.finanzasEnvio.update({
          where: { id: envio.finanzas.id },
          data: { estadoAuditoria: "DOBLE_COBRO" }
        });
        
        resultados.alertasDobleCobro++;
        resultados.montoARecuperar += fila.costo; // Exigimos la nota de crédito por el total
        resultados.procesados++;
        continue; // Cortamos acá, el cliente no se entera de nada
      }

      // ==========================================
      // ESCUDO 2: AUDITORÍA DE TARIFARIO
      // ==========================================
      const costoEsperado = envio.finanzas.precioProveedor || 0; // Lo que dijo la cotización inicial
      const difCosto = fila.costo - costoEsperado;

      let estadoAud = "OK";
      let costoBaseParaCliente = costoEsperado;

      if (difCosto > 0.1) {
        // SOBREPRECIO: El courier nos cobra $1200 pero el tarifario decía $1000
        estadoAud = "SOBREPRECIO_RECLAMAR";
        costoBaseParaCliente = costoEsperado; // Protegemos al cliente: le cobramos sobre la base de $1000
        
        resultados.alertasSobreprecio++;
        resultados.montoARecuperar += difCosto; // Exigimos nota de crédito por los $200 de diferencia
      } else {
        // MATCH PERFECTO O A FAVOR NUESTRO: El courier cobró lo mismo o menos.
        estadoAud = "OK";
        costoBaseParaCliente = fila.costo; // Cobramos sobre lo real
      }

      // ==========================================
      // GUARDADO FINAL (Preparando la Bolsa 1)
      // ==========================================
      
      // Recalculamos cuánto le cobraremos al cliente al momento de generar su Proforma
      const credencial = envio.empresa.credenciales.find(c => c.nombreCourier === envio.courier.nombre);
      const porcentajeMarkup = credencial?.ajusteTarifaPorcentaje || 0;
      const nuevoPrecioFacturaCliente = costoBaseParaCliente * (1 + (porcentajeMarkup / 100)) + (credencial?.markupFijo || 0);

      await prisma.finanzasEnvio.update({
        where: { id: envio.finanzas!.id },
        data: { 
          pesoAforado: fila.peso, 
          costoCourierEsperado: costoEsperado,
          costoCourierFacturado: fila.costo,
          estadoAuditoria: estadoAud,
          facturaCourierRef: referenciaFactura, // Dejamos la marca para evitar futuros dobles cobros
          precioFactura: nuevoPrecioFacturaCliente // Ya queda listo para el "Cierre de Mes"
        }
      });

      resultados.aprobadosParaCliente++;
      resultados.procesados++;
    }

    return NextResponse.json({ success: true, ...resultados });

  } catch (error) {
    console.error("Error en API Conciliación:", error);
    return NextResponse.json({ error: "Error interno al procesar auditoría" }, { status: 500 });
  }
}