// =============================================================================
// HELPER — Config de la app de Shipro en Shopify (Fase 1, 2026-10-14).
// =============================================================================
// Espejo de lib/utils/tiendanube-config.ts. Lee credenciales/identificadores de
// la app de Shipro registrada en el panel de Partners de Shopify. Vienen de
// env vars; NO se commitean. Estilo fail-fast (mirror getAppUrlOrThrow): los
// endpoints de instalación/OAuth son operativos (admin) y deben romper claro
// si falta la config, no seguir con una URL o llamada inválida.
//
// Piezas:
// - SHOPIFY_API_KEY: client_id de la app (visible, viaja en el authorize URL).
// - SHOPIFY_API_SECRET: client_secret, usado en el token exchange + verificación
//   del HMAC del redirect de Shopify. NUNCA se expone al cliente.
// - SHOPIFY_SCOPES: scopes OAuth separados por coma (ej.
//   "write_shipping,read_orders,write_fulfillments").
// - SHOPIFY_API_VERSION: versión path-based de la Admin API (default "2025-07").
//   NO se usa en Fase 1 (solo OAuth); queda listo para Fase 2+ (GET /shop,
//   POST /carrier_services, etc.).
// - SHOPIFY_REDIRECT_URI: derivado — `${APP_URL}/api/shopify/oauth/callback`.
//   Reusa getAppUrlOrThrow (fail-fast también).
// =============================================================================

import { getAppUrlOrThrow } from "@/lib/utils/app-url";

/**
 * client_id de la app de Shipro en Shopify. Fail-fast: si falta, el authorize
 * URL no se puede armar y rompe claro en lugar de generar un link inválido.
 */
export function getShopifyApiKeyOrThrow(): string {
  const v = process.env.SHOPIFY_API_KEY;
  if (!v) {
    throw new Error(
      "SHOPIFY_API_KEY no configurado en .env.local. Obtener del panel de la app en Shopify (Partners > Apps)."
    );
  }
  return v;
}

/**
 * client_secret de la app de Shipro en Shopify. Usado en el intercambio OAuth
 * code→token y en la verificación HMAC del redirect del authorize. Fail-fast.
 */
export function getShopifyApiSecretOrThrow(): string {
  const v = process.env.SHOPIFY_API_SECRET;
  if (!v) {
    throw new Error(
      "SHOPIFY_API_SECRET no configurado en .env.local. Obtener del panel de la app en Shopify (Partners > Apps)."
    );
  }
  return v;
}

/**
 * Scopes OAuth requeridos por la app (coma-separados, formato Shopify, ej.
 * "write_shipping,read_orders"). Fail-fast — sin scopes, el authorize URL no
 * tiene sentido semántico.
 */
export function getShopifyScopesOrThrow(): string {
  const v = process.env.SHOPIFY_SCOPES;
  if (!v) {
    throw new Error(
      "SHOPIFY_SCOPES no configurado en .env.local. Formato: 'scope1,scope2,...' (ver Shopify API docs)."
    );
  }
  return v;
}

/**
 * Versión de la Admin API de Shopify (path-based, formato YYYY-MM). Default
 * "2025-07"; override SHOPIFY_API_VERSION para pin explícito. NO se usa en
 * Fase 1 (OAuth puro) — queda listo para Fase 2+.
 */
export function getShopifyApiVersion(): string {
  return process.env.SHOPIFY_API_VERSION || "2025-07";
}

/**
 * redirect_uri del OAuth, derivado de APP_URL. Se usa tanto al generar el
 * authorize URL (install/link) como al intercambiar el code (debe matchear
 * literalmente con el registrado en el panel de la app). Fail-fast via
 * getAppUrlOrThrow.
 */
export function getShopifyRedirectUri(): string {
  return `${getAppUrlOrThrow()}/api/shopify/oauth/callback`;
}
