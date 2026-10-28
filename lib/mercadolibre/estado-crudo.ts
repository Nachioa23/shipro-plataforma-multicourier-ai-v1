// ============================================================================
// MEF — Volcado de eventos ML al timeline unificado EventoTracking (Chat D,
// 2026-10-28). Espejo del patrón adapter courier: guardar CRUDO ("status" o
// "status/substatus"), traducir al LEER vía Nomenclador. Fuente única "MEF"
// (los mapeos ML→canónico Shipro son UNO solo, no por courier físico).
//
// Dos puntos de entrada:
//   - emitirEventoActualMlBestEffort — 1 evento del status actual del body.
//     Lo llama el RECEIVER al clasificar "valido" (hot path).
//   - emitirEventosCatchupMlBestEffort — N eventos del status_history del body.
//     Lo llama el WORKER justo después de crear el Envio (catchup de webhooks
//     que llegaron antes de que el Envio interno existiera).
//
// Anti-duplicado: findFirst por (envioId, estadoCrudoOriginal, fechaOrigen,
// fuente=ML) antes del create. Descarta SOLO el MISMO evento repetido (mismo
// status y misma hora). Un intento NUEVO con otra hora NO es duplicado — se
// guarda (cada visita fallida es su propia fila para la métrica de primera
// visita futura). NO usar body.attempts del webhook: eso es reintentos HTTP
// de ML, no visitas del courier.
//
// Best-effort: never throw. Si no existe el Envio todavía (webhook antes del
// create del interno), skip + log — el worker catchup lo cubre.
// ============================================================================

import prisma from "@/lib/prisma";
import { FUENTE_EVENTO } from "@/lib/constants/fuente-evento";

export function armarEstadoCrudoMl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const status = typeof b.status === "string" ? b.status.trim() : "";
  if (!status) return null;
  const substatus = typeof b.substatus === "string" ? b.substatus.trim() : "";
  return substatus ? `${status}/${substatus}` : status;
}

export function extraerFechaOrigenMl(body: unknown): Date | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const candidatos = [b.last_updated, b.date_last_updated, b.date_created];
  for (const c of candidatos) {
    if (typeof c === "string" && c.length > 0) {
      const d = new Date(c);
      if (Number.isFinite(d.getTime())) return d;
    }
  }
  return null;
}

async function emitirEventoTrackingMl(params: {
  envioId: number;
  estadoCrudo: string;
  fechaOrigen: Date | null;
  shipmentId: string;
}): Promise<void> {
  const { envioId, estadoCrudo, fechaOrigen, shipmentId } = params;
  const existente = await prisma.eventoTracking.findFirst({
    where: {
      envioId,
      estadoCrudoOriginal: estadoCrudo,
      fechaOrigen,
      fuente: FUENTE_EVENTO.ML,
    },
    select: { id: true },
  });
  if (existente) return;
  await prisma.eventoTracking.create({
    data: {
      estado: estadoCrudo,
      estadoCrudoOriginal: estadoCrudo,
      observacion: `MEF: ${estadoCrudo}`,
      envioId,
      fuente: FUENTE_EVENTO.ML,
      fechaOrigen,
    },
  });
}

export async function emitirEventoActualMlBestEffort(params: {
  shipmentId: string;
  body: unknown;
}): Promise<void> {
  try {
    const { shipmentId, body } = params;
    const estadoCrudo = armarEstadoCrudoMl(body);
    if (!estadoCrudo) return;
    const envio = await prisma.envio.findFirst({
      where: { mercadolibreShipmentId: shipmentId },
      select: { id: true },
    });
    if (!envio) return;
    const fechaOrigen = extraerFechaOrigenMl(body);
    await emitirEventoTrackingMl({
      envioId: envio.id,
      estadoCrudo,
      fechaOrigen,
      shipmentId,
    });
  } catch (e) {
    console.warn(
      "[mef-estado-crudo] emitirEventoActualMl falló (best-effort):",
      e instanceof Error ? e.message : String(e).slice(0, 200),
    );
  }
}

function fechaDeEntradaHistory(entry: unknown): Date | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const candidatos = [
    e.date_shipped,
    e.date_delivered,
    e.date_cancelled,
    e.date_not_delivered,
    e.date_handling,
    e.date_ready_to_ship,
    e.date,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.length > 0) {
      const d = new Date(c);
      if (Number.isFinite(d.getTime())) return d;
    }
  }
  return null;
}

export async function emitirEventosCatchupMlBestEffort(params: {
  envioId: number;
  shipmentId: string;
  body: unknown;
}): Promise<void> {
  try {
    const { envioId, shipmentId, body } = params;
    if (!body || typeof body !== "object") return;
    const b = body as Record<string, unknown>;
    const history = Array.isArray(b.status_history) ? b.status_history : null;

    if (history && history.length > 0) {
      for (const entry of history) {
        const crudo = armarEstadoCrudoMl(entry);
        if (!crudo) continue;
        const fechaOrigen = fechaDeEntradaHistory(entry);
        await emitirEventoTrackingMl({
          envioId,
          estadoCrudo: crudo,
          fechaOrigen,
          shipmentId,
        });
      }
      return;
    }

    const crudoActual = armarEstadoCrudoMl(body);
    if (!crudoActual) return;
    await emitirEventoTrackingMl({
      envioId,
      estadoCrudo: crudoActual,
      fechaOrigen: extraerFechaOrigenMl(body),
      shipmentId,
    });
  } catch (e) {
    console.warn(
      "[mef-estado-crudo] emitirEventosCatchupMl falló (best-effort):",
      e instanceof Error ? e.message : String(e).slice(0, 200),
    );
  }
}
