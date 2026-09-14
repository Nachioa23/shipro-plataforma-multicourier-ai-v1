import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyMercadoLibreWebhookSignature } from "@/lib/mercadolibre/webhook-verify";

// ============================================================================
// MEF Fase 1 step 4 — Receiver de webhooks de Mercado Libre (Flex + otros topics).
// STAGING ONLY: verifica firma → persiste en NotificacionFlex → devuelve 200.
// NO crea envío, NO ejecuta downstream, NO llama a couriers. Fase 3 (worker)
// consume esta tabla y hace enrichment + acciones.
//
// PATH: POST /api/mercadolibre/webhooks (público — self-auth via HMAC firma).
//
// ACK FAST: verificar firma + upsert idempotente son operaciones rápidas
// (HMAC = microseconds; INSERT es 1 roundtrip). Toda la lógica corre
// sincrónico y respondemos 200 apenas persistimos. No hay `after()` porque
// step 4 no tiene enrichment — todo es fast-path. Fase 3 (worker separado)
// se encargará del enrichment async leyendo `NotificacionFlex` en batch.
//
// ⚠️ IDS DIFERENTES (CONFUSIÓN #1 A EVITAR):
//   - `notificacionMlId = body.id` (top-level) — nuestro dedup key
//     (NotificacionFlex.notificacionId @unique). Retries de ML reenvían el
//     mismo `body.id` → INSERT rechaza P2002 → devolvemos 200 idempotente.
//   - `resourceId = body.data.id` (nested) — el id del recurso (ej. shipmentId).
//     Usado ÚNICAMENTE en el manifest de la firma HMAC (webhook-verify.ts).
//     NUNCA usado como dedup key.
//
// UNKNOWN SELLER: si `body.user_id` no tiene match en `CuentaMercadoLibre`,
// persistimos con `empresaId=null` + `estado="huerfana"` y respondemos 200.
// NO hacemos que ML retry — no vamos a resolver el seller retriando.
// Fase 3 podrá levantar huérfanos si aparece el OAuth callback después.
// ============================================================================

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // 1. RAW body FIRST. Necesario para JSON.parse; el manifest de la firma
    // ML solo usa 3 campos concatenados (no requiere preservar bytes exactos
    // del body como Tiendanube), pero leer .text() antes de .json() es el
    // patrón consistente y no cuesta nada.
    const raw = await request.text();

    // 2. JSON.parse. Fallo → 400 (body roto; retry no ayuda).
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new NextResponse("Bad JSON", { status: 400 });
    }

    // 3. Verify firma HMAC. Manifest usa payload.data.id (NESTED), no body.id.
    // Header ausente / firma mismatch / data.id faltante → 401 silencioso.
    const okSig = verifyMercadoLibreWebhookSignature({
      payload,
      xSignature: request.headers.get("x-signature"),
      xRequestId: request.headers.get("x-request-id"),
    });
    if (!okSig) {
      return new NextResponse("Invalid signature", { status: 401 });
    }

    // 4. Extraer campos del payload. Nombramos las variables sin ambigüedad:
    //    `notificacionMlId` = top-level id (dedup); `resourceId` = data.id
    //    (ya usado en el manifest, lo re-derivamos acá solo para el log).
    const notificacionMlId =
      payload?.id != null ? String(payload.id) : null;
    const topic = typeof payload?.topic === "string" ? payload.topic : null;
    const resource =
      typeof payload?.resource === "string" ? payload.resource : null;
    const mlUserIdRaw = payload?.user_id;
    const mlUserId =
      typeof mlUserIdRaw === "number" ? mlUserIdRaw : Number(mlUserIdRaw);

    if (!notificacionMlId || !topic || !resource || !Number.isInteger(mlUserId)) {
      // Firma válida pero payload incompleto — anomaly. 400 (ML no debería
      // retriar; el body está mal formado y retriar no lo arregla).
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // 5. shipmentId: extraer del resource si topic incluye shipments. ML
    // manda resource como "/shipments/12345" para topic="shipments".
    // Para otros topics (orders, flex-handshakes, etc), shipmentId queda null.
    let shipmentId: string | null = null;
    if (topic.startsWith("shipments")) {
      const m = resource.match(/\/shipments\/(\d+)/);
      shipmentId = m ? m[1] : null;
    }

    // 6. attempts, sent, received — todos opcionales según los topics.
    const attempts =
      typeof payload?.attempts === "number" ? payload.attempts : null;
    const sent = typeof payload?.sent === "string" ? parseIsoOrNull(payload.sent) : null;
    const received =
      typeof payload?.received === "string" ? parseIsoOrNull(payload.received) : null;

    // 7. Resolver empresaId via CuentaMercadoLibre.mlUserId (unique). Si no
    // hay match: unknown seller → persistir con empresaId=null + estado
    // "huerfana", devolver 200 igual (no queremos que ML retry a un seller
    // que no gestionamos).
    const cuenta = await prisma.cuentaMercadoLibre.findUnique({
      where: { mlUserId },
      select: { empresaId: true },
    });
    const empresaId = cuenta?.empresaId ?? null;
    const estado = cuenta ? "recibida" : "huerfana";

    // 8. Persist idempotente: create + catch P2002. Retries del mismo
    // notificacionMlId (top-level id) chocan con el @unique → P2002 → return
    // 200 sin re-persistir. Semántica: "ya recibida, no hago nada, no fallo".
    try {
      await prisma.notificacionFlex.create({
        data: {
          notificacionId: notificacionMlId,
          mlUserId,
          topic,
          resource,
          shipmentId,
          empresaId,
          attempts,
          sent,
          received,
          payloadRaw: payload,
          estado,
        },
      });
    } catch (e: any) {
      // Prisma P2002 = unique constraint violation. Es EXACTAMENTE el flujo
      // idempotente esperado — NO re-throw, respondemos 200 limpio.
      if (e?.code === "P2002") {
        return NextResponse.json({ ok: true, duplicated: true }, { status: 200 });
      }
      // Cualquier otro error DB (conexión, timeout, constraint distinta) →
      // 500 para que ML retrye (fallo probablemente transitorio).
      console.error(
        "[mercadolibre/webhooks] persistencia falló (no P2002):",
        e instanceof Error ? e.message : String(e).slice(0, 300),
      );
      return new NextResponse("Persistence error", { status: 500 });
    }

    // 9. Ack fast — 200 dentro del SLA de ML (22s per Chat D).
    return NextResponse.json({ ok: true, huerfana: !cuenta }, { status: 200 });
  } catch (e) {
    // Fallback: cualquier throw no manejado. 500 para que ML retry (bug transitorio
    // o infra caída). Logueamos el detalle para diagnóstico.
    console.error(
      "[mercadolibre/webhooks] error inesperado:",
      e instanceof Error ? e.message : String(e).slice(0, 300),
    );
    return new NextResponse("Internal error", { status: 500 });
  }
}

// Helper local: ISO string → Date | null. `new Date(invalidStr)` retorna un
// Date "Invalid Date" (isNaN(getTime())) — filtramos para no persistir NaN.
function parseIsoOrNull(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}
