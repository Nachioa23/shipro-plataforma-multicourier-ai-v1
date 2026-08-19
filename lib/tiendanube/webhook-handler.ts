// ============================================================================
// HELPER — SHARED WEBHOOK HANDLER PARA TIENDANUBE (DEUDA 104)
//
// Este es el entrypoint COMÚN de TODOS los webhooks de Tiendanube. Cada route
// bajo app/api/tiendanube/webhooks/<evento>/route.ts delega en esta función y
// sólo aporta la lógica específica del evento (el callback `process`).
//
// EL FLUJO CANÓNICO (mismo en cada route):
//   1. Leer RAW body con `await request.text()` — necesario para HMAC. NUNCA
//      pasar por request.json() antes: JSON.parse + re-serialize cambia los
//      bytes exactos y la firma NUNCA valida (error silencioso).
//   2. Verificar HMAC con el helper compartido; fallo → 401.
//   3. JSON.parse del raw; fallo → 400.
//   4. Extraer store_id + event del top-level del payload; storeId inválido → 400.
//   5. Delegar el trabajo específico al callback `process(ctx)`.
//   6. Éxito → 200 "OK"; excepción del callback → 500 (Tiendanube reintenta).
//
// RETRIES + IDEMPOTENCIA:
//   Tiendanube reintenta cualquier respuesta no-2xx (hasta 16 veces en 48h).
//   Un 500 es DESEABLE cuando queremos que Tiendanube reintente (fallo transitorio
//   de BD, timeout, etc.). Un 200 significa "listo, no reintentes". Cada handler
//   DEBE ser idempotente — puede llegar el mismo evento N veces.
//
// SCOPE:
//   Este helper NO valida la semántica del payload por-evento (los campos que
//   Tiendanube manda cambian según el tipo de evento). Cada handler específico
//   valida lo que necesita.
// ============================================================================

import { verifyTiendanubeWebhookSignature } from "@/lib/tiendanube/webhook-verify";

export interface TiendanubeWebhookContext<T = any> {
  /** store_id de Tiendanube (Int). Extraído del top-level del payload. */
  storeId: number;
  /** Tipo de evento, ej. "app/uninstalled", "customers/redact". String bruto. */
  event: string;
  /** Payload completo ya parseado (JSON.parse del raw body). */
  payload: T;
}

/**
 * Entrypoint compartido para TODOS los webhooks de Tiendanube. La route de cada
 * evento lo invoca pasando su callback `process` — el handler común se encarga
 * de raw body + HMAC + parse + validación básica + retry semantics.
 *
 * IMPORTANTE — `process` debe ser IDEMPOTENTE: Tiendanube reintenta cualquier
 * no-2xx hasta 16 veces en 48h. El mismo evento puede llegar N veces (retry
 * legítimo o duplicado accidental). Si el callback throwea → 500 → Tiendanube
 * reintenta (deseable para errores transitorios; peligroso para errores
 * determinísticos — el handler debe reconocer y no re-lanzar en esos casos).
 */
export async function handleTiendanubeWebhook(
  request: Request,
  process: (ctx: TiendanubeWebhookContext) => Promise<void>,
): Promise<Response> {
  // 1. RAW body FIRST — NO usar request.json() (bytes exactos requeridos por HMAC).
  const raw = await request.text();

  // 2. HMAC gate — mismatch/header ausente/formato inválido → 401 silencioso.
  const sig = request.headers.get("x-linkedstore-hmac-sha256");
  if (!verifyTiendanubeWebhookSignature(raw, sig)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 3. Parse JSON — falla → 400 (no reintentar; el body está roto).
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // 4. Validación básica del envelope. Todo webhook Tiendanube trae al menos
  //    { store_id, event }. Sin store_id no podemos hacer nada útil.
  const storeId = Number(payload?.store_id);
  const event = String(payload?.event ?? "");
  if (!Number.isInteger(storeId)) {
    return new Response("Missing store_id", { status: 400 });
  }

  // 5. Delegar al callback específico del evento.
  try {
    await process({ storeId, event, payload });
  } catch (e) {
    // 500 → Tiendanube reintenta. Deseable para errores transitorios. El
    // handler específico es responsable de NO tirar en fallos determinísticos
    // que reintentar no arreglaría (p. ej. registrar el fallo + retornar limpio).
    console.error("[tiendanube webhook] process error:", {
      event,
      storeId,
      err: e instanceof Error ? e.message : String(e).slice(0, 300),
    });
    return new Response("Processing error", { status: 500 });
  }

  // 6. Éxito → 200. Tiendanube no reintenta.
  return new Response("OK", { status: 200 });
}
