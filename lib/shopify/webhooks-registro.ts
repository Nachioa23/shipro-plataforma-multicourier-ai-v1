// =============================================================================
// Shopify — Registrar webhookSubscriptionCreate (Fase 3, 2026-10-15).
// =============================================================================
// Al instalar / reinstalar la app, Shopify necesita saber dónde empujar los
// eventos de la tienda. Fase 3 registra UN webhook: ORDERS_PAID → nuestro
// endpoint /api/shopify/webhooks/orders-paid.
//
// Idempotencia: Shopify permite múltiples subscriptions por topic, pero NO
// duplicados exactos (topic + callbackUrl). Si la subscription ya existe,
// userErrors devuelve "address for this topic has already been taken" o
// similar — se trata como "ya estaba", no error. Mismo criterio que el
// patrón de carrier-service: userErrors matchean "already" / "taken" →
// return { ok: true, duplicado: true }; otros errores → throw.
//
// Best-effort: si falla, la instalación de la tienda NO se rompe. El caller
// (callback OAuth) registra el error en AuditoriaConfiguracion.
// =============================================================================

import { shopifyGraphQL } from "@/lib/shopify/graphql";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

export interface RegistrarWebhooksShopifyInput {
  shop: string;
  accessTokenCifrado: string;
}

export type RegistrarWebhooksShopifyResult =
  | { ok: true; registrados: string[]; duplicados: string[] }
  | { ok: false; detalle: string };

// Topics a registrar en Fase 3. Agregar más acá (ORDERS_CANCELLED,
// FULFILLMENTS_UPDATE, APP_UNINSTALLED, etc.) cuando se construyan sus flows.
const TOPICS = [
  { topic: "ORDERS_PAID", path: "/api/shopify/webhooks/orders-paid" },
];

const MUTATION_CREATE = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

/**
 * Matchea userErrors que indican "la subscription ya existe" vs errores
 * reales. Shopify no devuelve un código estable; matchea sobre el message
 * en lowercase. Mantener laxo para tolerar variaciones del wording entre
 * versiones del API.
 */
function esErrorDeDuplicado(mensaje: string): boolean {
  const m = mensaje.toLowerCase();
  return (
    m.includes("already been taken") ||
    m.includes("already exists") ||
    m.includes("has already") ||
    m.includes("duplicate")
  );
}

export async function registrarWebhooksShopify(
  arg: RegistrarWebhooksShopifyInput,
): Promise<RegistrarWebhooksShopifyResult> {
  const accessToken = decryptSecret(arg.accessTokenCifrado);
  const base = getAppUrlOrThrow();

  const registrados: string[] = [];
  const duplicados: string[] = [];

  for (const t of TOPICS) {
    const callbackUrl = `${base}${t.path}`;
    const input = { callbackUrl, format: "JSON" };
    try {
      const data = await shopifyGraphQL<Record<string, unknown>>(
        arg.shop,
        accessToken,
        MUTATION_CREATE,
        { topic: t.topic, input },
      );
      const resultado: any = (data as any)?.webhookSubscriptionCreate;
      const userErrors: Array<{ field?: string[]; message: string }> =
        resultado?.userErrors ?? [];
      if (userErrors.length === 0 && resultado?.webhookSubscription?.id) {
        registrados.push(t.topic);
        continue;
      }
      // Si todos los userErrors son de duplicado → la subscription ya está, OK.
      if (userErrors.length > 0 && userErrors.every((e) => esErrorDeDuplicado(e.message))) {
        duplicados.push(t.topic);
        continue;
      }
      // Otros userErrors → errores reales.
      return {
        ok: false,
        detalle: `webhookSubscriptionCreate(${t.topic}) userErrors: ${userErrors
          .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
          .join(" | ")}`,
      };
    } catch (e) {
      return {
        ok: false,
        detalle: `webhookSubscriptionCreate(${t.topic}) threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  return { ok: true, registrados, duplicados };
}
