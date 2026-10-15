// =============================================================================
// Shopify — Helper GraphQL (Fase 2, 2026-10-14).
// =============================================================================
// Wrapper mínimo para llamar al Admin GraphQL API de Shopify desde el server.
// Usa el accessToken offline permanente (plano — el caller lo desencripta antes
// de pasarlo acá) en el header `X-Shopify-Access-Token`.
//
// Scope: solo transporte. userErrors (errores "soft" de las mutations GraphQL)
// los decide el caller — cada operación tiene su propia política de qué userError
// es fatal (throw) vs recoverable (ok: false con motivo).
//
// Errors de transporte / sintaxis GraphQL → throw: significa que la request no
// se completó o el schema de la query está roto.
// =============================================================================

import { getShopifyApiVersion } from "@/lib/utils/shopify-config";

export interface ShopifyGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: string[]; extensions?: unknown }>;
}

/**
 * Ejecuta una query/mutation GraphQL contra el Admin API de Shopify.
 *
 * @param shop - shopDomain validado (`*.myshopify.com`). El caller debe
 *   garantizar que ya pasó por `isValidShopDomain` — defensa anti-SSRF.
 * @param accessTokenPlano - accessToken offline en texto plano. El caller lo
 *   desencripta (decryptSecret) antes de pasarlo.
 * @param query - GraphQL query/mutation string.
 * @param variables - variables de la query (opcional).
 * @returns `data` del response. userErrors de las mutations los lee el caller.
 * @throws Error si !res.ok (status no-2xx), el body no es JSON válido, o
 *   `errors[]` del GraphQL (errores de transporte/sintaxis, no userErrors).
 */
export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessTokenPlano: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shop}/admin/api/${getShopifyApiVersion()}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shopify-Access-Token": accessTokenPlano,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const body: ShopifyGraphQLResponse<T> | null = await res.json().catch(() => null);
  if (!res.ok || !body) {
    const detalle = body ? JSON.stringify(body).slice(0, 500) : `status ${res.status}`;
    throw new Error(`Shopify GraphQL falló (${res.status}): ${detalle}`);
  }
  if (body.errors && body.errors.length > 0) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify GraphQL errors: ${msg}`);
  }
  if (!body.data) {
    throw new Error("Shopify GraphQL sin data y sin errors — respuesta inesperada");
  }
  return body.data;
}
