// ============================================================================
// DEUDA 104 — LGPD customers/data_request para Tiendanube.
//
// Compila TODA la data que Shipro tiene sobre un comprador (identificado por
// email/documento + su lista de order_ids) en un workbook Excel con 3 hojas:
//
//   1. "Datos del comprador"  — filas de destinos únicos (nombre/email/tel/
//      documento/dirección completa/CP/localidad/provincia). Normalmente 1
//      fila si el buyer usó siempre la misma dirección; N si varias.
//   2. "Envíos"                — 1 fila por envío: tracking + fecha + courier
//      + estado + numeroOrden + tiendanubeOrderId + modalidad.
//   3. "Historial de seguimiento" — 1 fila por (envío, evento): trackingNumber
//      + fecha + estado + observacion, ordenado asc por fecha.
//
// READ-ONLY: cero mutaciones. Match reusa el mismo union pattern de
// `lgpd-redact.ts` (primary por order_id, fallback por email/documento).
//
// EDGE CASES:
//   - Sin matches → workbook igual se produce (una fila explícita "no data
//     found" en cada hoja) para que el merchant reciba una respuesta clara.
//     empresaId se deriva de TiendaTiendanube; si tampoco existe, null.
//   - Un envío puede tener destino null (envíos BLOQUEADO_DEPOSITO/etc. que
//     no llegaron a asignarse un destino) — se omiten en la hoja de datos
//     pero sí aparecen en Envíos + Historial (para completitud).
// ============================================================================

import * as XLSX from "xlsx";
import prisma from "@/lib/prisma";

export interface DataReportInput {
  storeId: number;
  orderIds: string[];
  email: string | null;
  documento: string | null;
}

export interface DataReportOutput {
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
  tiendanubeOrderId: string | null;
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

export async function generarReporteDatosComprador(
  input: DataReportInput,
): Promise<DataReportOutput> {
  const { storeId, orderIds, email, documento } = input;

  // ---- MATCH (union primary + fallback, READ-ONLY, WIDE select) ----
  const enviosPorId = new Map<number, EnvioReporte>();
  const wideSelect = {
    id: true,
    trackingNumber: true,
    estadoActual: true,
    modalidad: true,
    numeroOrden: true,
    tiendanubeOrderId: true,
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

  if (orderIds.length > 0) {
    const primary = await prisma.envio.findMany({
      where: { tiendanubeStoreId: storeId, tiendanubeOrderId: { in: orderIds } },
      select: wideSelect,
    });
    for (const e of primary) enviosPorId.set(e.id, e as EnvioReporte);
  }

  const orConditions: Array<{ email?: string; documento?: string }> = [];
  if (email) orConditions.push({ email });
  if (documento) orConditions.push({ documento });

  if (orConditions.length > 0) {
    const fallback = await prisma.envio.findMany({
      where: { tiendanubeStoreId: storeId, destino: { OR: orConditions } },
      select: wideSelect,
    });
    for (const e of fallback) enviosPorId.set(e.id, e as EnvioReporte);
  }

  const envios = Array.from(enviosPorId.values());

  // empresaId: si hay envíos, del primero (todos comparten la empresa del
  // store); si no, se resuelve vía TiendaTiendanube; si tampoco, null.
  let empresaId: number | null = null;
  if (envios.length > 0) {
    empresaId = envios[0].empresaId;
  } else {
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
      select: { empresaId: true },
    });
    empresaId = tienda?.empresaId ?? null;
  }

  // ---- Build workbook ----
  const wb = XLSX.utils.book_new();

  // Sheet 1: "Datos del comprador"
  // Destinos únicos por (nombre|email|documento|calle|altura). Si no hay
  // envíos con destino → una fila explícita "no data found".
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
    "Tiendanube order_id",
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
          e.tiendanubeOrderId,
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
