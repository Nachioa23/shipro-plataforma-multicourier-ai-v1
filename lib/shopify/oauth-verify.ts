// =============================================================================
// Shopify Fase 1 — Verificación HMAC del redirect OAuth + validación de domain.
// =============================================================================
// Shopify firma el redirect del authorize con un parámetro `hmac` (HMAC-SHA256
// del resto de los query params con el SHOPIFY_API_SECRET). El callback debe
// verificar esa firma antes de confiar en el `shop`/`code` que llegan — defensa
// contra links fabricados (anti CSRF-adyacente + ataques de redirección).
//
// Patrón espejo del rigor que ya aplica el verificador de webhooks de Tiendanube
// (lib/tiendanube/webhook-handler.ts): shape fijo del hmac + timingSafeEqual.
// =============================================================================

import crypto from "crypto";
import { getShopifyApiSecretOrThrow } from "@/lib/utils/shopify-config";

/**
 * Valida el formato del `shop` param: debe ser `<handle>.myshopify.com` (todo
 * lowercase, chars `[a-z0-9-]`, no empezando con `-`). Defensa anti-SSRF /
 * anti-redirección a dominios arbitrarios (el callback después hace una POST
 * a `https://{shop}/admin/oauth/access_token`).
 *
 * @param shop - valor del query param `shop` recibido en el callback.
 * @returns true si matchea el formato esperado; false para cualquier otra cosa.
 */
export function isValidShopDomain(shop: string | null | undefined): boolean {
  if (!shop) return false;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * Verifica el `hmac` del redirect OAuth de Shopify. El algoritmo (doc oficial):
 *   1. Tomar todos los params MENOS `hmac` (y `signature` si viene — deprecado,
 *      pero se excluye por compatibilidad defensiva).
 *   2. Ordenar por clave alfabéticamente.
 *   3. Armar message `k=v&k=v&...` con valores crudos (sin re-encodear).
 *   4. expected = HMAC-SHA256(message, SHOPIFY_API_SECRET) en hex lowercase.
 *   5. timingSafeEqual contra el `hmac` recibido.
 *
 * @param searchParams - URLSearchParams del request (ej. `new URL(url).searchParams`).
 * @returns true si el hmac matchea; false ante cualquier anomalía (sin hmac,
 *          mal formado, no verifica).
 * @throws Error si SHOPIFY_API_SECRET no está configurado (fail-fast).
 */
export function verifyShopifyOAuthHmac(searchParams: URLSearchParams): boolean {
  const providedHmac = searchParams.get("hmac");
  if (!providedHmac) return false;
  // Guard de shape — hex de 64 chars (SHA-256). Protege timingSafeEqual contra
  // inputs de longitud distinta (que tiran excepción) + descarta basura obvia.
  if (!/^[0-9a-f]{64}$/.test(providedHmac)) return false;

  // Params ordenados alfabéticamente, excluyendo hmac y signature.
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of searchParams.entries()) {
    if (k === "hmac" || k === "signature") continue;
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join("&");

  const expected = crypto
    .createHmac("sha256", getShopifyApiSecretOrThrow())
    .update(message)
    .digest("hex");

  // timingSafeEqual exige buffers de la misma longitud — el guard de shape de
  // arriba (ambos 64 hex) lo garantiza; try/catch defensivo igual.
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHmac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
