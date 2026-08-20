// =============================================================================
// DEUDA 104 — Registro programático de webhooks con Tiendanube.
// =============================================================================
// Esto es lo que hace que Tiendanube efectivamente DISPARE los webhooks: sin
// esta llamada al POST /webhooks después del install, todo el plumbing del
// lado nuestro (verify HMAC, handleTiendanubeWebhook, rutas dispatcher) queda
// dormido — Tiendanube no sabe a qué URL avisar.
//
// SCOPE (6 eventos programáticos):
//   fulfillment_order/status_updated          → /api/tiendanube/webhooks/fulfillment-order
//   fulfillment_order/label_status_updated    → (misma URL)
//   fulfillment_order/tracking_event_created  → (misma URL)
//   fulfillment_order/tracking_event_updated  → (misma URL)
//   fulfillment_order/tracking_event_deleted  → (misma URL)
//   app/uninstalled                           → /api/tiendanube/webhooks/app-uninstalled
//
// Los 3 webhooks de LGPD (customers/redact, store/redact, customers/data_request)
// se configuran a mano en el Partners Portal — Tiendanube exige URLs fijas
// app-wide para esos, NO por-store. Este módulo NO los registra.
//
// IDEMPOTENCIA (GET-then-diff, mismo patrón que carrier options):
//   1. GET /webhooks lista los ya registrados en la tienda.
//   2. Se construye un Set "event|url" de los existentes.
//   3. Sólo se POSTea lo que falta (match exacto por event+url).
//   Reinstall / reintento son safe: no duplica, no rompe.
//
// AUTH: caller pasa el accessToken CIFRADO — el módulo lo descifra con
// decryptSecret (mismo contrato que registrarCarrierParaTienda).
//
// BEST-EFFORT en el caller: cualquier throw acá se traga arriba (try/catch en
// la callback OAuth). La tienda ya quedó vinculada; un fallo del registro se
// audita y se reintenta desde el panel.
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import { apiUrl, authHeaders } from "@/lib/tiendanube/api";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

interface WebhookRegistrado {
  id: number;
  event: string;
  url: string;
}

/**
 * GET /webhooks: lista los webhooks ya registrados para la tienda. Defensivo:
 * si la respuesta no es array, retorna [] (mejor procesar como "ninguno" que
 * romper por un cambio de shape del proveedor).
 */
async function listarWebhooks(
  storeId: number,
  accessToken: string,
): Promise<WebhookRegistrado[]> {
  const res = await fetchTiendanube(apiUrl(storeId, "webhooks"), {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `Tiendanube GET webhooks HTTP ${res.status}: ${detalle}`.slice(0, 300),
    );
  }
  const data: any = await res.json().catch(() => null);
  if (!Array.isArray(data)) return [];
  return data.map((w) => ({
    id: Number(w.id),
    event: String(w.event),
    url: String(w.url),
  }));
}

/**
 * POST /webhooks: registra UN webhook. Tiendanube devuelve el resource con id
 * pero acá no lo necesitamos (el estado autoritativo vive del lado Tiendanube y
 * el idempotency es via GET-then-diff, no via id local).
 */
async function registrarWebhook(
  storeId: number,
  accessToken: string,
  event: string,
  url: string,
): Promise<void> {
  const res = await fetchTiendanube(apiUrl(storeId, "webhooks"), {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ event, url }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `Tiendanube POST webhook ${event} HTTP ${res.status}: ${detalle}`.slice(0, 300),
    );
  }
}

export interface RegistrarWebhooksResult {
  /** Cuántos de los 6 deseados YA estaban registrados con la misma url (skip). */
  yaExistentes: number;
  /** Eventos recién registrados en esta corrida (los que faltaban). */
  registrados: string[];
  /** Total de eventos deseados (constante = 6). Facilita "nuevos/total" en logs. */
  total: number;
}

/**
 * Orquesta el registro de los 6 webhooks programáticos para una tienda.
 * Idempotente (GET-then-diff). El caller es responsable de:
 *   (a) envolver en try/catch best-effort (network / no-2xx bubblean como Error).
 *   (b) auditar el fallo si le importa dejar rastro (patrón carrier).
 */
export async function registrarWebhooksParaTienda(input: {
  storeId: number;
  accessTokenCifrado: string;
}): Promise<RegistrarWebhooksResult> {
  const accessToken = decryptSecret(input.accessTokenCifrado);
  const appUrl = getAppUrlOrThrow();
  const urlFulfillment = `${appUrl}/api/tiendanube/webhooks/fulfillment-order`;
  const urlUninstalled = `${appUrl}/api/tiendanube/webhooks/app-uninstalled`;

  const deseados: Array<{ event: string; url: string }> = [
    { event: "fulfillment_order/status_updated", url: urlFulfillment },
    { event: "fulfillment_order/label_status_updated", url: urlFulfillment },
    { event: "fulfillment_order/tracking_event_created", url: urlFulfillment },
    { event: "fulfillment_order/tracking_event_updated", url: urlFulfillment },
    { event: "fulfillment_order/tracking_event_deleted", url: urlFulfillment },
    { event: "app/uninstalled", url: urlUninstalled },
  ];

  const existentes = await listarWebhooks(input.storeId, accessToken);
  // Match por event+url exacto: si la misma event está registrada con OTRA url
  // (deploy viejo, etc.), la registramos también con la url correcta. Limpiar
  // los huérfanos con url stale queda fuera de scope (DEUDA 145 pattern completo).
  const keysExistentes = new Set(existentes.map((w) => `${w.event}|${w.url}`));

  let yaExistentes = 0;
  const registrados: string[] = [];
  for (const d of deseados) {
    if (keysExistentes.has(`${d.event}|${d.url}`)) {
      yaExistentes++;
      continue;
    }
    await registrarWebhook(input.storeId, accessToken, d.event, d.url);
    registrados.push(d.event);
  }

  return { yaExistentes, registrados, total: deseados.length };
}
