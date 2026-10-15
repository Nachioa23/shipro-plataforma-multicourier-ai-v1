// =============================================================================
// Shopify — Registrar/update CarrierService (Fase 2, 2026-10-14).
// =============================================================================
// El CarrierService es la pieza de Shopify que apunta a nuestro endpoint de
// rates (`/api/shopify/rates?token=...`). Shopify lo invoca en cada checkout
// para pedir las tarifas que mostramos al buyer.
//
// Autorización del endpoint de rates: Shopify NO firma esos requests ni manda
// el shop domain → la ÚNICA auth es el `token` opaco de la callbackUrl. Lo
// generamos acá (plain), lo pasamos encriptado implícitamente vía HMAC-SHA256
// (`hashApiKey`) a `TiendaShopify.rateCallbackTokenHash`, y Shopify guarda SOLO
// el plain en su CarrierService.
//
// Caminos:
//   - Fresh install (carrierServiceIdPrevio = null) → `carrierServiceCreate`.
//   - Reinstall (carrierServiceIdPrevio != null) → `carrierServiceUpdate` para
//     refrescar la callbackUrl con el nuevo token.
//
// userErrors contemplados:
//   - "not available" / "shopify plan" → return { ok:false, motivo:"plan" }.
//     Shopify restringe CarrierService a tiendas Advanced/Plus/anuales — una
//     tienda Basic no puede usarlo. NO rompe la instalación; el merchant verá
//     el aviso de activar plan avanzado.
//   - Otros userErrors → throw (son errores de spec, no recoverable).
// =============================================================================

import { shopifyGraphQL } from "@/lib/shopify/graphql";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

export interface RegistrarCarrierShopifyInput {
  shop: string; // shopDomain validado
  accessTokenCifrado: string;
  rateCallbackTokenPlano: string;
  carrierServiceIdPrevio: string | null; // null = fresh install, != null = reinstall
}

export type RegistrarCarrierShopifyResult =
  | { ok: true; carrierServiceId: string; creado: boolean }
  | { ok: false; motivo: "plan"; detalle: string };

// Mutations GraphQL. Doc: https://shopify.dev/docs/api/admin-graphql/latest/mutations/carrierservicecreate
const MUTATION_CREATE = `
  mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService { id }
      userErrors { field message }
    }
  }
`;
// NOTA (Chat B 2026-10-14): firma documentada por GN — `id` como argumento
// SEPARADO del input (vs embebido). Si al introspectar el schema real en la
// primera prueba de reinstall resultara que el id va dentro del input, se
// revierte. Confirmamos empíricamente contra Shopify.
const MUTATION_UPDATE = `
  mutation carrierServiceUpdate($id: ID!, $input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(id: $id, input: $input) {
      carrierService { id }
      userErrors { field message }
    }
  }
`;

/**
 * Patrón para detectar userErrors de plan insuficiente (Basic / Shopify
 * Starter no soportan CarrierService). Los strings varían levemente entre
 * versiones del API — matcheo laxo con `includes` sobre lowercase.
 */
function esErrorDePlan(mensaje: string): boolean {
  const m = mensaje.toLowerCase();
  return (
    m.includes("not available") ||
    m.includes("plan") ||
    m.includes("advanced") ||
    m.includes("upgrade")
  );
}

/**
 * Registra o actualiza el CarrierService de Shipro en la tienda Shopify.
 *
 * @throws Error si el GraphQL falla por transporte/sintaxis, o si userErrors
 *   contiene algo que NO es error de plan (indica un bug nuestro).
 */
export async function registrarCarrierServiceShopify(
  input: RegistrarCarrierShopifyInput
): Promise<RegistrarCarrierShopifyResult> {
  const accessToken = decryptSecret(input.accessTokenCifrado);
  const callbackUrl = `${getAppUrlOrThrow()}/api/shopify/rates?token=${encodeURIComponent(
    input.rateCallbackTokenPlano
  )}`;

  const esReinstall = !!input.carrierServiceIdPrevio;

  // Shape del input de la mutation — mismos campos en create/update. En update
  // el `id` va como argumento SEPARADO (no dentro del input) según firma GN —
  // ver NOTA sobre MUTATION_UPDATE arriba.
  const inputGQL: Record<string, unknown> = {
    name: "Shipro",
    callbackUrl,
    active: true,
    supportsServiceDiscovery: true,
  };

  const variables: Record<string, unknown> = esReinstall
    ? { id: input.carrierServiceIdPrevio, input: inputGQL }
    : { input: inputGQL };

  const data = await shopifyGraphQL<Record<string, unknown>>(
    input.shop,
    accessToken,
    esReinstall ? MUTATION_UPDATE : MUTATION_CREATE,
    variables
  );

  const resultado: any = esReinstall
    ? (data as any)?.carrierServiceUpdate
    : (data as any)?.carrierServiceCreate;
  const userErrors: Array<{ field?: string[]; message: string }> = resultado?.userErrors ?? [];
  const carrierService = resultado?.carrierService;

  // Error de plan: la tienda está en Basic / Starter y no puede activar
  // CarrierService. Best-effort: no rompemos la instalación.
  if (userErrors.length > 0 && userErrors.every((e) => esErrorDePlan(e.message))) {
    return {
      ok: false,
      motivo: "plan",
      detalle: userErrors.map((e) => e.message).join("; "),
    };
  }
  // Otros userErrors: no esperados en el camino feliz → throw para que el
  // caller lo logee + registre AuditoriaConfiguracion.
  if (userErrors.length > 0) {
    throw new Error(
      `carrierService ${esReinstall ? "update" : "create"} userErrors: ${userErrors
        .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
        .join(" | ")}`
    );
  }

  const carrierServiceId: string | undefined = carrierService?.id;
  if (!carrierServiceId) {
    throw new Error("carrierService sin id en respuesta de Shopify");
  }
  return { ok: true, carrierServiceId, creado: !esReinstall };
}
