// =============================================================================
// Disparador automático de generación de etiqueta (Tiendanube).
// =============================================================================
// Corazón del trigger "venta pagada = etiqueta creada" (pieza 2/4 del automatismo).
// Dado un pedido pagado en Tiendanube, este helper:
//   1) lista las fulfillment-orders del pedido,
//   2) identifica la que fue tomada por el carrier de Shipro de esa tienda
//      (matcheando por shippingCarrierId — NO hardcoded, cada tienda tiene el suyo),
//   3) dispara POST /fulfillment-orders/labels contra Tiendanube, que a su vez le
//      pega a nuestro callback /api/tiendanube/labels/generate y crea el envío.
//
// Idempotencia: /generate ya dedup por fulfillmentOrderId (guard en el after()
// loop). Disparar dos veces la misma ffo NO crea envíos duplicados — el segundo
// disparo hace no-op en /generate.
//
// El caller (webhook order/paid, pieza 3) decide status HTTP según ResultadoDisparo:
//   - "disparado"       → 200 OK.
//   - "no_es_shipro"    → 200 OK (el pedido eligió otra transportadora — no es
//                        error de nuestro lado; ignorar sin retry).
//   - "ffo_ausente"     → 500 (fulfillment todavía no existe — caso borde
//                        documentado por Tiendanube, la fulfillment se crea
//                        diferida tras un error de procesamiento; forzar 500
//                        para que Tiendanube reintente el webhook).
// Los errores HTTP transitorios de la propia API de Tiendanube se propagan como
// throw → el handler los convierte también en 500 → retry.
// =============================================================================

import { apiUrl, authHeaders } from "@/lib/tiendanube/api";
import { fetchTiendanube } from "@/lib/tiendanube/http";

const LOG_PREFIX = "[tiendanube/disparar-generacion]";

export type ResultadoDisparo =
  | { estado: "disparado"; ffoId: string }
  | { estado: "no_es_shipro" }
  | { estado: "ffo_ausente" };

export async function dispararGeneracionEtiqueta(params: {
  storeId: number;
  orderId: string;
  accessToken: string;
  shippingCarrierId: string;
}): Promise<ResultadoDisparo> {
  const { storeId, orderId, accessToken, shippingCarrierId } = params;

  const listUrl = apiUrl(storeId, `orders/${orderId}/fulfillment-orders`);
  const listRes = await fetchTiendanube(listUrl, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!listRes.ok) {
    throw new Error(`GET fulfillment-orders HTTP ${listRes.status}`);
  }

  const listBody: any = await listRes.json().catch(() => null);
  if (!Array.isArray(listBody) || listBody.length === 0) {
    console.log(
      `${LOG_PREFIX} ffo_ausente store=${storeId} order=${orderId} — el caller debe 500 para retry`,
    );
    return { estado: "ffo_ausente" };
  }

  const ffoMatch = listBody.find(
    (ffo: any) => ffo?.shipping?.carrier?.carrier_id === shippingCarrierId,
  );
  if (!ffoMatch) {
    console.log(
      `${LOG_PREFIX} no_es_shipro store=${storeId} order=${orderId} carrier=${shippingCarrierId} — otra transportadora, ignorar`,
    );
    return { estado: "no_es_shipro" };
  }

  const ffoId =
    typeof ffoMatch?.id === "string" || typeof ffoMatch?.id === "number"
      ? String(ffoMatch.id)
      : "";
  if (!ffoId) {
    throw new Error("fulfillment-order matcheada sin id — payload inesperado");
  }

  const triggerUrl = apiUrl(storeId, `fulfillment-orders/labels`);
  const triggerRes = await fetchTiendanube(triggerUrl, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify([{ id: ffoId }]),
  });
  if (!triggerRes.ok) {
    const text = await triggerRes.text().catch(() => "");
    throw new Error(
      `POST labels HTTP ${triggerRes.status}: ${text.slice(0, 200)}`,
    );
  }

  console.log(
    `${LOG_PREFIX} disparado store=${storeId} order=${orderId} ffo=${ffoId}`,
  );
  return { estado: "disparado", ffoId };
}
