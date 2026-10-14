// =============================================================================
// Shopify Fase 1 — intercambio del authorization code por access_token offline.
// =============================================================================
// Cuando el merchant acepta los scopes, Shopify redirige al callback con
// ?code=xxx&shop=yyy.myshopify.com&state=<token>&hmac=... — este módulo hace
// el segundo paso: POST al endpoint de la tienda específica con el code + las
// credenciales de la app, y recibe el access_token offline permanente + los
// scopes concedidos.
//
// Diferencias con Tiendanube:
//   - El token exchange de Shopify se hace contra la tienda (`https://{shop}
//     /admin/oauth/access_token`), no un endpoint global. Shopify valida el
//     shop en server-side antes de responder.
//   - El accessToken de Shopify es offline permanente (NO hay refresh_token
//     para apps públicas). Guardarlo encriptado (encryptSecret), igual que TN.
//   - La respuesta incluye `scope` (string con los scopes efectivamente
//     concedidos, útil para auditoría si el merchant deniega alguno).
// =============================================================================

import {
  getShopifyApiKeyOrThrow,
  getShopifyApiSecretOrThrow,
} from "@/lib/utils/shopify-config";

export interface ExchangeShopifyResult {
  accessToken: string;
  scope: string; // scopes efectivamente concedidos (puede diferir de los pedidos).
}

/**
 * Intercambia el authorization code por el access_token offline permanente de
 * Shopify + los scopes concedidos.
 *
 * @param shop - shopDomain validado (ya pasó por isValidShopDomain). El caller
 *               NO debe pasar un shop sin validar — hay riesgo SSRF.
 * @param code - el `code` que Shopify envió en el redirect. Vida corta.
 * @returns { accessToken, scope } — accessToken en PLAINTEXT (el caller lo
 *               encripta con encryptSecret antes de persistir).
 * @throws Error si la request falla, la respuesta no es JSON, o falta access_token.
 */
export async function exchangeCodeForTokenShopify(
  shop: string,
  code: string
): Promise<ExchangeShopifyResult> {
  const url = `https://${shop}/admin/oauth/access_token`;
  const body = {
    client_id: getShopifyApiKeyOrThrow(),
    client_secret: getShopifyApiSecretOrThrow(),
    code,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data) {
    console.error("[shopify/oauth] exchange falló:", res.status, data);
    throw new Error(`Intercambio con Shopify falló (status ${res.status})`);
  }
  const accessToken: string | undefined = data.access_token;
  const scope: string = typeof data.scope === "string" ? data.scope : "";
  if (!accessToken) {
    throw new Error("Respuesta de Shopify sin access_token");
  }
  return { accessToken, scope };
}
