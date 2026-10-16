// =============================================================================
// Shopify — Fulfillment Orders + push de Fulfillment (Fase 3, 2026-10-15).
// =============================================================================
// Flow Fase 3 (order management app, SIN FulfillmentService):
//   1. Webhook orders/paid dispara el flow.
//   2. obtenerFulfillmentOrders(order) → lista los FOs con CREATE_FULFILLMENT
//      en supportedActions. Esos son los que la app tiene permiso de cumplir.
//   3. Shipro crea el Envío + obtiene trackingNumber real del courier.
//   4. pushFulfillmentShopify(foId, trackingInfo) → mutation fulfillmentCreate
//      (NO fulfillmentCreateV2 — deprecada) con lineItemsByFulfillmentOrder:
//      [{fulfillmentOrderId}] (sin line items = cumple todo lo restante).
//
// Decisión GN: `fulfillmentCreate` vigente en API 2025-07; `fulfillmentCreateV2`
// quedó deprecated y será removida. Usamos la forma vigente.
// =============================================================================

import { shopifyGraphQL } from "@/lib/shopify/graphql";
import { decryptSecret } from "@/lib/utils/secret-crypto";

export interface FulfillmentOrderNode {
  id: string; // GID
  status: string; // "OPEN" | "SCHEDULED" | "IN_PROGRESS" | ...
  supportedActions: Array<{ action: string }>;
  lineItems: {
    nodes: Array<{ id: string; remainingQuantity: number }>;
  };
}

const QUERY_FULFILLMENT_ORDERS = `
  query obtenerFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          supportedActions { action }
          lineItems(first: 50) {
            nodes { id remainingQuantity }
          }
        }
      }
    }
  }
`;

/**
 * Obtiene los FulfillmentOrders de una orden que la app TIENE PERMISO de
 * cumplir (acción CREATE_FULFILLMENT en supportedActions). Filtra el ruido
 * (FOs ya cumplidos, FOs asignados a otra app, etc.) para que el caller sólo
 * decida sobre los relevantes.
 *
 * @param shop - shopDomain validado.
 * @param accessTokenPlano - token en plaintext (caller decrypt antes).
 * @param orderGid - GID de la orden (ej. "gid://shopify/Order/12345").
 * @returns array de FOs con CREATE_FULFILLMENT. Vacío si no hay match.
 */
export async function obtenerFulfillmentOrders(
  shop: string,
  accessTokenPlano: string,
  orderGid: string,
): Promise<FulfillmentOrderNode[]> {
  const data = await shopifyGraphQL<Record<string, unknown>>(
    shop,
    accessTokenPlano,
    QUERY_FULFILLMENT_ORDERS,
    { id: orderGid },
  );
  const order: any = (data as any)?.order;
  const nodes: FulfillmentOrderNode[] = order?.fulfillmentOrders?.nodes ?? [];
  return nodes.filter((n) =>
    (n.supportedActions ?? []).some((a) => a.action === "CREATE_FULFILLMENT"),
  );
}

// =============================================================================

export interface PushFulfillmentShopifyInput {
  shop: string;
  accessTokenCifrado: string;
  fulfillmentOrderId: string; // GID del FO a cumplir
  trackingCompany: string; // nombre del courier (ej. "Andreani")
  trackingNumber: string;
  trackingUrl: string;
  notifyCustomer: boolean;
}

export interface PushFulfillmentShopifyResult {
  ok: boolean;
  fulfillmentId?: string; // GID del Fulfillment creado
  userErrors?: Array<{ field?: string[]; message: string }>;
}

const MUTATION_FULFILLMENT_CREATE = `
  mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`;

/**
 * Crea un Fulfillment en Shopify para el FulfillmentOrder dado + trackingInfo.
 * Sin line items en el input = cumple TODO lo pendiente del FO (semántica
 * Shopify estándar).
 *
 * @returns `{ok, fulfillmentId}` si éxito; `{ok:false, userErrors}` ante error
 *   del lado Shopify. Transporte/sintaxis GraphQL throwean (via shopifyGraphQL).
 */
export async function pushFulfillmentShopify(
  arg: PushFulfillmentShopifyInput,
): Promise<PushFulfillmentShopifyResult> {
  const accessToken = decryptSecret(arg.accessTokenCifrado);
  const input = {
    lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: arg.fulfillmentOrderId }],
    trackingInfo: {
      company: arg.trackingCompany,
      number: arg.trackingNumber,
      url: arg.trackingUrl,
    },
    notifyCustomer: arg.notifyCustomer,
  };
  const data = await shopifyGraphQL<Record<string, unknown>>(
    arg.shop,
    accessToken,
    MUTATION_FULFILLMENT_CREATE,
    { fulfillment: input },
  );
  const resultado: any = (data as any)?.fulfillmentCreate;
  const userErrors = resultado?.userErrors ?? [];
  const fulfillmentId: string | undefined = resultado?.fulfillment?.id;
  if (userErrors.length > 0 || !fulfillmentId) {
    return { ok: false, userErrors };
  }
  return { ok: true, fulfillmentId };
}
