// ============================================================================
// Shopify Fase 4 LGPD — lib data_request (reporte Excel de datos del comprador).
// Variante Shopify del molde TN (lib/tiendanube/lgpd-data-report.ts).
//
// MISMO SHAPE que TN: 3 hojas (Datos del comprador / Envíos / Historial de
// seguimiento), misma librería (xlsx), misma política READ-ONLY (cero
// mutaciones). Devuelve el buffer; el endpoint (Chat B) resuelve contactos +
// envía el mail. Separación 1:1 con TN.
//
// Diferencias puntuales vs TN:
//   1. shopDomain String (no storeId Int). Resolvemos TiendaShopify adentro.
//   2. Match por shopifyOrderId GID (no tiendanubeOrderId int-string).
//   3. Match fallback por email OR telefono (Shopify no manda documento;
//      Shipro NO guarda documento desde Shopify, así que la columna
//      "Documento" del Excel va siempre vacía — igual se incluye para que
//      el merchant vea que no se recolectó).
//   4. Columna de identificador externo renombrada a "Shopify order GID".
// ============================================================================

import * as XLSX from "xlsx";
import prisma from "@/lib/prisma";

export interface DataReportShopifyInput {
  shopDomain: string;
  orderGids: string[];
  email: string | null;
  phone: string | null;
}

export interface DataReportShopifyOutput {
  excelBuffer: Buffer;
  enviosCount: number;
  empresaId: number | null;
}

interface EnvioReporte {
  id: number;
  trackingNumber: string;
  estadoActual: string;
  modalidad: string;
  numeroOrden: string | null;
  shopifyOrderId: string | null;
  fechaImpresion: Date;
  empresaId: number;
  courier: { nombre: string };
  destino: {
    nombre: string | null;
    email: string | null;
    telefono: string | null;
    documento: string | null;
    calle: string | null;
    altura: string | null;
    piso: string | null;
    dpto: string | null;
    cp: string;
    localidad: string | null;
    provincia: string | null;
  } | null;
  eventos: Array<{
    fecha: Date;
    estado: string;
    observacion: string | null;
  }>;
}

/** Formatea una fecha como "YYYY-MM-DD HH:mm" (más legible en Excel que ISO). */
function fmtFecha(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export async function dataReportShopify(
  input: DataReportShopifyInput,
): Promise<DataReportShopifyOutput> {
  const { shopDomain, orderGids, email, phone } = input;

  // ---- Resolver TiendaShopify ----
  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain },
    select: { id: true, empresaId: true },
  });

  // ---- MATCH (union primary + fallback, READ-ONLY, WIDE select) ----
  const enviosPorId = new Map<number, EnvioReporte>();
  const wideSelect = {
    id: true,
    trackingNumber: true,
    estadoActual: true,
    modalidad: true,
    numeroOrden: true,
    shopifyOrderId: true,
    fechaImpresion: true,
    empresaId: true,
    courier: { select: { nombre: true } },
    destino: {
      select: {
        nombre: true,
        email: true,
        telefono: true,
        documento: true,
        calle: true,
        altura: true,
        piso: true,
        dpto: true,
        cp: true,
        localidad: true,
        provincia: true,
      },
    },
    eventos: {
      select: { fecha: true, estado: true, observacion: true },
      orderBy: { fecha: "asc" as const },
    },
  };

  // Si no hay tienda, igual podemos querer buscar por email/phone — pero sin
  // tiendaShopifyId no podemos scope-ear, así que corremos solo si tienda
  // existe. Caso de tienda desconocida produce reporte vacío + empresaId null,
  // mismo criterio que TN.
  if (tienda) {
    const tiendaShopifyId = tienda.id;

    if (orderGids.length > 0) {
      const primary = await prisma.envio.findMany({
        where: { tiendaShopifyId, shopifyOrderId: { in: orderGids } },
        select: wideSelect,
      });
      for (const e of primary) enviosPorId.set(e.id, e as EnvioReporte);
    }

    const orConditions: Array<{ email?: string; telefono?: string }> = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ telefono: phone });

    if (orConditions.length > 0) {
      const fallback = await prisma.envio.findMany({
        where: { tiendaShopifyId, destino: { OR: orConditions } },
        select: wideSelect,
      });
      for (const e of fallback) enviosPorId.set(e.id, e as EnvioReporte);
    }
  }

  const envios = Array.from(enviosPorId.values());

  // empresaId: si hay envíos, del primero (todos comparten la empresa de la
  // tienda); si no, se resuelve vía TiendaShopify; si tampoco, null.
  let empresaId: number | null = null;
  if (envios.length > 0) {
    empresaId = envios[0].empresaId;
  } else {
    empresaId = tienda?.empresaId ?? null;
  }

  // ---- Build workbook (mismas 3 hojas que TN, mismas columnas) ----
  const wb = XLSX.utils.book_new();

  // Sheet 1: "Datos del comprador"
  const destinosUnicos = new Map<string, EnvioReporte["destino"]>();
  for (const e of envios) {
    if (!e.destino) continue;
    const key = [
      e.destino.nombre ?? "",
      e.destino.email ?? "",
      e.destino.documento ?? "",
      e.destino.calle ?? "",
      e.destino.altura ?? "",
    ].join("|");
    if (!destinosUnicos.has(key)) destinosUnicos.set(key, e.destino);
  }
  const headersDatos = [
    "Nombre",
    "Email",
    "Teléfono",
    "Documento",
    "Calle",
    "Altura",
    "Piso",
    "Dpto",
    "CP",
    "Localidad",
    "Provincia",
  ];
  const rowsDatos: (string | null)[][] =
    destinosUnicos.size === 0
      ? [["Sin datos de comprador encontrados para este pedido LGPD.", "", "", "", "", "", "", "", "", "", ""]]
      : Array.from(destinosUnicos.values()).map((d) => [
          d!.nombre,
          d!.email,
          d!.telefono,
          d!.documento,
          d!.calle,
          d!.altura,
          d!.piso,
          d!.dpto,
          d!.cp,
          d!.localidad,
          d!.provincia,
        ]);
  const wsDatos = XLSX.utils.aoa_to_sheet([headersDatos, ...rowsDatos]);
  XLSX.utils.book_append_sheet(wb, wsDatos, "Datos del comprador");

  // Sheet 2: "Envíos"
  const headersEnvios = [
    "Tracking",
    "Fecha impresión",
    "Courier",
    "Estado",
    "N° orden (display)",
    "Shopify order GID",
    "Modalidad",
  ];
  const rowsEnvios: (string | null)[][] =
    envios.length === 0
      ? [["Sin envíos encontrados.", "", "", "", "", "", ""]]
      : envios.map((e) => [
          e.trackingNumber,
          fmtFecha(e.fechaImpresion),
          e.courier?.nombre ?? "",
          e.estadoActual,
          e.numeroOrden,
          e.shopifyOrderId,
          e.modalidad,
        ]);
  const wsEnvios = XLSX.utils.aoa_to_sheet([headersEnvios, ...rowsEnvios]);
  XLSX.utils.book_append_sheet(wb, wsEnvios, "Envíos");

  // Sheet 3: "Historial de seguimiento"
  const headersEventos = ["Tracking", "Fecha", "Estado", "Observación"];
  const rowsEventos: (string | null)[][] = [];
  for (const e of envios) {
    for (const ev of e.eventos) {
      rowsEventos.push([
        e.trackingNumber,
        fmtFecha(ev.fecha),
        ev.estado,
        ev.observacion,
      ]);
    }
  }
  const rowsEventosFinal =
    rowsEventos.length === 0
      ? [["Sin eventos de seguimiento.", "", "", ""]]
      : rowsEventos;
  const wsEventos = XLSX.utils.aoa_to_sheet([headersEventos, ...rowsEventosFinal]);
  XLSX.utils.book_append_sheet(wb, wsEventos, "Historial de seguimiento");

  // ---- Serialize to Buffer (no filesystem) ----
  const excelBuffer: Buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  return { excelBuffer, enviosCount: envios.length, empresaId };
}
