// =============================================================================
// DEUDA 104 (Movimiento 1/3) — Módulo push de tracking-events a Tiendanube.
// =============================================================================
// Empuja un evento de tracking al fulfillment order de una orden de Tiendanube
// para que el comprador lo vea en su timeline nativo del panel de compras.
// Complementa el flujo pull (nuestro cron rastrea al courier) con un flujo
// push hacia Tiendanube.
//
// Contrato oficial (fulfillment-order resource, FulfillmentOrderTrackingEventInput):
//   POST /orders/{order_id}/fulfillment-orders/{fulfillment_order_id}/tracking-events
//   Body:
//     { status (required),
//       description (required),
//       address (nullable, opcional),
//       geolocation (nullable, opcional),
//       happened_at (nullable ISO8601 — si null, Tiendanube usa "ahora"),
//       estimated_delivery_at (nullable, opcional) }
//
//   Native statuses aceptados: dispatched, received_by_post_office, in_transit,
//   out_for_delivery, delivery_attempt_failed, delayed, ready_for_pickup,
//   delivered, returned_to_sender, lost, failure. Custom: `custom_{status}`.
//   El mapeo Shipro → status vive en tracking-map.ts.
//
// AUTH: el caller pasa el accessToken PLAINTEXT (ya descifrado con decryptSecret).
// Este módulo NO descifra. Reusa apiUrl + authHeaders del módulo común
// (lib/tiendanube/api.ts) para no duplicar construcción de URL / headers.
//
// NOTAS OPERATIVAS (importantes):
//   (1) Enviar status "delivered" AUTO-marca el fulfillment order como DELIVERED
//       + fulfilled en Tiendanube (comportamiento esperado por diseño — cierra
//       el envío del lado de ellos y libera cualquier flujo dependiente).
//   (2) Tiendanube RECHAZA eventos idénticos duplicados (dedup nativo). Es un
//       backstop, no una estrategia — el caller SIEMPRE se apoya en su propia
//       bandera de idempotencia (Movimiento 2/3) para no re-pushear.
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import { apiUrl, authHeaders } from "@/lib/tiendanube/api";

export interface PushTrackingEventInput {
  storeId: number;
  /** Tiendanube order_id (Envio.tiendanubeOrderId). */
  orderId: string;
  /** Envio.tiendanubeFulfillmentOrderId. */
  fulfillmentOrderId: string;
  /** Access token PLAINTEXT — caller ya lo descifró con decryptSecret. */
  accessToken: string;
  /** Status Tiendanube YA MAPEADO (ej. "in_transit"). Caller usa estadoTiendanube() antes. */
  status: string;
  /** Texto humano legible para el timeline del comprador (ej. "En tránsito a destino"). */
  description: string;
  /** Timestamp real del evento (fecha del EventoTracking). Si null/undefined, Tiendanube usa "ahora". */
  happenedAt?: Date | null;
}

/**
 * POST a Tiendanube empujando un evento de tracking al fulfillment order.
 * DEUDA 104 Movimiento 1/3.
 *
 * Throws Error(HTTP status + body slice) si Tiendanube responde no-2xx. NO
 * reintenta acá — el caller (Movimiento 2/3, hook en el cron) lo envuelve
 * best-effort y decide su propia política de retry vía la bandera de
 * idempotencia sobre EventoTracking.
 */
export async function pushTrackingEvent(input: PushTrackingEventInput): Promise<void> {
  const path = `orders/${input.orderId}/fulfillment-orders/${input.fulfillmentOrderId}/tracking-events`;

  const body: Record<string, unknown> = {
    status: input.status,
    description: input.description,
  };
  if (input.happenedAt) {
    body.happened_at = input.happenedAt.toISOString();
  }
  // address / geolocation / estimated_delivery_at son nullable en el contrato
  // y no los tenemos hoy — se omiten del body.

  const res = await fetchTiendanube(apiUrl(input.storeId, path), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `Tiendanube tracking-events HTTP ${res.status}: ${detalle}`.slice(0, 300),
    );
  }
}
