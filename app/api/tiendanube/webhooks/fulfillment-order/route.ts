import prisma from "@/lib/prisma";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";

export const runtime = "nodejs";

// DEUDA 104 — Webhook Tiendanube: familia fulfillment_order/*.
//
// Path FIJO: /api/tiendanube/webhooks/fulfillment-order. Registrado post-install
// vía POST /v1/{store_id}/webhooks (5 subscriptions apuntando al MISMO URL, una
// por evento — Tiendanube lo permite). El prefix "/api/tiendanube/webhooks/" ya
// está en proxy.ts PUBLIC_API_PREFIXES.
//
// UN SOLO ROUTE PARA 5 EVENTOS (decisión técnica, familia coherente):
//   - fulfillment_order/status_updated
//   - fulfillment_order/label_status_updated
//   - fulfillment_order/tracking_event_created
//   - fulfillment_order/tracking_event_updated
//   - fulfillment_order/tracking_event_deleted
// Todos traen { store_id, event, order_id, fulfillment_id, ... }. Los primeros
// dos suman status; los tracking_event_* suman tracking_event_id.
//
// PRIMARY JOB (esta pieza): ORDER_ID BACKFILL.
//   El labels callback no capturaba Tiendanube.order_id — sólo fulfillment_id.
//   Sin order_id no podemos armar la URL de tracking-events (POST
//   /orders/{order_id}/fulfillment-orders/{fulfillment_id}/tracking-events) ni
//   matchear con confianza en LGPD customers/*. Cualquier evento de esta familia
//   trae ambos ids juntos, así que aprovechamos el primero que llegue para
//   backfillear Envio.tiendanubeOrderId (nueva columna, migración additive).
//   Match determinístico: 1 fulfillment_id → 1 envío (invariant del labels
//   callback). Guardado con updateMany + OR-guard para ser IDEMPOTENTE: retries
//   sobre el mismo evento no re-escriben si ya está seteado con el mismo valor.
//
// SECONDARY JOB (pieza posterior — STUBS): ingestion de tracking events entrantes
//   (los tracking_event_* pueden reflejarse en nuestro tracking timeline si el
//   flujo lo requiere). Hoy los switch cases son no-op — sólo dejamos el
//   dispatch listo para wireado futuro. La captura del order_id NO depende del
//   dispatch — corre siempre, antes.
//
// IDEMPOTENCIA:
//   Tiendanube reintenta cualquier no-2xx hasta 16× en 48h. El updateMany del
//   backfill es idempotente por diseño (OR-guard rechaza el update si el
//   order_id ya está seteado con el mismo valor → count=0, no-op silencioso).
//   Los stubs de dispatch no hacen nada — inherentemente idempotentes.
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId, event, payload }) => {
    // ---- ORDER_ID BACKFILL (común a TODOS los eventos fulfillment_order/*) ----
    const fulfillmentId =
      payload?.fulfillment_id != null ? String(payload.fulfillment_id) : "";
    const orderId = payload?.order_id != null ? String(payload.order_id) : "";

    if (fulfillmentId && orderId) {
      // Match por el fulfillment_id que persistimos en el labels callback (misma
      // ULID que envía el webhook). El WHERE gate por tiendanubeStoreId agrega
      // defense-in-depth (el mismo fulfillment_id nunca cruza tiendas, pero
      // multiplexar por store evita cross-store bugs si un día llega mala data).
      // OR-guard hace la escritura idempotente: si el valor ya está y coincide,
      // count=0 y no se toca el row.
      const res = await prisma.envio.updateMany({
        where: {
          tiendanubeFulfillmentOrderId: fulfillmentId,
          tiendanubeStoreId: storeId,
          OR: [
            { tiendanubeOrderId: null },
            { tiendanubeOrderId: { not: orderId } },
          ],
        },
        data: { tiendanubeOrderId: orderId },
      });
      if (res.count > 0) {
        console.log("[webhook fulfillment-order] order_id backfilled:", {
          storeId,
          fulfillmentId,
          orderId,
          event,
          count: res.count,
        });
      }
    } else {
      // Evento raro / payload inesperado. No throwea (evita retry loop de 48h
      // por payload de forma inesperada — el envío ya podría estar bien).
      console.warn("[webhook fulfillment-order] evento sin order_id/fulfillment_id:", {
        event,
        storeId,
      });
    }

    // ---- DISPATCH por tipo de evento (stubs para pieza posterior) ----
    switch (event) {
      case "fulfillment_order/status_updated":
      case "fulfillment_order/label_status_updated":
        // TODO(tracking push, pieza posterior): estos eventos podrían usarse
        // para reflejar estado del fulfillment o de la label emitida. Por ahora
        // sólo nos importa el order_id backfill (hecho arriba). No-op adicional.
        break;
      case "fulfillment_order/tracking_event_created":
      case "fulfillment_order/tracking_event_updated":
      case "fulfillment_order/tracking_event_deleted":
        // TODO(tracking push, pieza posterior): ingerir eventos de tracking
        // entrantes desde Tiendanube. Design-pending: cómo se integran con el
        // cron de rastreo que ya polea couriers directamente.
        break;
      default:
        // No-op — evento no reconocido no rompe el flow (el backfill ya corrió).
        console.warn("[webhook fulfillment-order] evento no reconocido:", {
          event,
          storeId,
        });
    }
  });
}
