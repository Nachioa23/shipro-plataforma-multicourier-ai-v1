// ============================================================================
// MEF — Volcado de eventos ML al timeline unificado EventoTracking (Chat D,
// 2026-10-28; patrón ajustado 2026-10-29). Espejo del patrón adapter courier:
// TRADUCIR AL ESCRIBIR vía Nomenclador. Fuente única "MEF" (los mapeos
// ML→canónico Shipro son UNO solo, no por courier físico; viven bajo el
// Courier VIRTUAL nombre="MEF" seedeado en 20261028130000_mef_nomenclador_seed).
//
// Decisión de diseño (Chat D + Nacho + Chat A 2026-10-29): guardar CRUDO y
// traducir al leer rompería los 7 consumers de buyer-facing/dashboard/push TN/
// métricas que leen `evento.estado` asumiendo canónico Shipro. Alineamos al
// patrón vigente del repo (el cron de couriers pre-traduce al escribir):
//   - estado              = CANÓNICO Shipro (lookup Nomenclador MEF).
//   - estadoCrudoOriginal = crudo "status[/substatus]" (respaldo auditable).
//
// Fallback (crudo sin mapeo en Nomenclador MEF): estado = crudo tal cual +
// auto-create de la row Nomenclador con estadoShipro=null (mismo patrón que
// el cron de couriers en app/api/cron/rastreo/route.ts:82-86) → aparece en
// la Torre métrica 1.1 para que el admin resuelva vía UI. Nunca descartamos
// el evento.
//
// Dos puntos de entrada:
//   - emitirEventoActualMlBestEffort — 1 evento del status actual del body.
//     Lo llama el RECEIVER al clasificar "valido" (hot path).
//   - emitirEventosCatchupMlBestEffort — N eventos del status_history del body.
//     Lo llama el WORKER justo después de crear el Envio (catchup de webhooks
//     que llegaron antes de que el Envio interno existiera).
//
// Anti-duplicado: findFirst por (envioId, estadoCrudoOriginal, fechaOrigen,
// fuente=ML) — por CRUDO, no por canónico. Dos crudos distintos pueden mapear
// al mismo canónico (p.ej. buyer_absent + reprogrammed → VISITA_FALLIDA) y
// son eventos distintos; dedupear por canónico los colapsaría erróneamente.
// NO usar body.attempts: eso es reintentos HTTP de ML, no visitas del courier.
//
// Best-effort: never throw. Si no existe el Envio todavía (webhook antes del
// create del interno), skip + log — el worker catchup lo cubre.
// ============================================================================

import prisma from "@/lib/prisma";
import { FUENTE_EVENTO } from "@/lib/constants/fuente-evento";

// Nombre canónico del Courier virtual (seeded en
// 20261028130000_mef_nomenclador_seed). Lookup único por nombre, cacheado
// module-level para evitar un findUnique por cada evento emitido en instancias
// calientes. Serverless cold-start resuelve una vez por invocación.
const MEF_COURIER_NOMBRE = "MEF";
let _mefCourierIdCache: number | null = null;

async function getMefCourierId(): Promise<number | null> {
  if (_mefCourierIdCache !== null) return _mefCourierIdCache;
  const row = await prisma.courier.findUnique({
    where: { nombre: MEF_COURIER_NOMBRE },
    select: { id: true },
  });
  if (row) _mefCourierIdCache = row.id;
  return row ? row.id : null;
}

// Traduce el crudo "status[/substatus]" al canónico Shipro via Nomenclador MEF.
// Fallback (sin Courier MEF, sin mapeo, o estadoShipro=null): devuelve el crudo
// tal cual + auto-registra la row Nomenclador para que aparezca en Torre 1.1.
async function traducirCrudoViaNomencladorMef(estadoCrudo: string): Promise<string> {
  const mefCourierId = await getMefCourierId();
  if (mefCourierId === null) {
    console.warn(
      `[mef-estado-crudo] Courier virtual "${MEF_COURIER_NOMBRE}" no existe — ` +
        `seed 20261028130000_mef_nomenclador_seed no corrió. Fallback: estado=crudo.`,
    );
    return estadoCrudo;
  }
  const mapeo = await prisma.nomenclador.findUnique({
    where: { courierId_estadoCrudo: { courierId: mefCourierId, estadoCrudo } },
    select: { estadoShipro: true },
  });
  if (mapeo) {
    return mapeo.estadoShipro || estadoCrudo;
  }
  // Auto-create con estadoShipro=null (mirror cron rastreo:82-86). Idempotente
  // via unique @@unique([courierId, estadoCrudo]); P2002 bajo race → ignoramos.
  try {
    await prisma.nomenclador.create({
      data: { courierId: mefCourierId, estadoCrudo, estadoShipro: null },
    });
  } catch (e: any) {
    if (e?.code !== "P2002") {
      console.warn(
        "[mef-estado-crudo] auto-create Nomenclador MEF falló (best-effort):",
        e instanceof Error ? e.message : String(e).slice(0, 200),
      );
    }
  }
  return estadoCrudo;
}

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
  const { envioId, estadoCrudo, fechaOrigen } = params;
  // Dedupe por CRUDO (no por canónico): dos crudos distintos pueden mapear al
  // mismo canónico y son eventos distintos.
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
  const estadoCanonico = await traducirCrudoViaNomencladorMef(estadoCrudo);
  await prisma.eventoTracking.create({
    data: {
      estado: estadoCanonico,
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
