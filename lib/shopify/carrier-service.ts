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
// Decisión (2026-10-21, Chat A+B diagnóstico prod): el camino create-vs-update
// se decide por la REALIDAD en Shopify (lo que la app propia ve con
// `carrierServices { ... }`), NO por el id guardado en nuestra BD. Razón: en
// Shopify cada CarrierService pertenece a la app que lo creó; una app nueva
// NO ve los carriers de otra app, y UPDATE sobre un id ajeno falla
// silenciosamente dejando el cotizador muerto. Esto se vio en prod cuando el
// callback intentó UPDATE sobre el carrier de la app CUSTOM anterior → la
// app pública nunca llegó a crear el suyo → Shopify nunca llamó
// `/api/shopify/rates`. Listar primero y decidir según la realidad autocura
// el reinstall + evita el pegado a carriers huérfanos de otras apps.
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
}

export type RegistrarCarrierShopifyResult =
  | { ok: true; carrierServiceId: string; creado: boolean }
  | { ok: false; motivo: "plan"; detalle: string };

export interface CarrierServiceShopify {
  id: string;
  name: string;
  active: boolean;
  callbackUrl: string;
  supportsServiceDiscovery: boolean;
}

// Query de listado — doc oficial Shopify Admin GraphQL 2025-10, requiere
// read_shipping (que write_shipping ya cubre, no hace falta sumar scope).
// first:50 es generoso; en la práctica una tienda tiene <5 carriers.
const QUERY_LIST = `
  query ListarCarrierServices {
    carrierServices(first: 50) {
      edges {
        node {
          id
          name
          active
          callbackUrl
          supportsServiceDiscovery
        }
      }
    }
  }
`;

// Mutations GraphQL. Doc: https://shopify.dev/docs/api/admin-graphql/latest/mutations/carrierservicecreate
const MUTATION_CREATE = `
  mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService { id }
      userErrors { field message }
    }
  }
`;
// NOTA (Chat B 2026-10-15): firma CONFIRMADA empíricamente contra prod + doc
// oficial — el `id` va DENTRO del `input` (NO como argumento separado). La
// hipótesis previa de GN (id como arg separado) resultó incorrecta; se revirtió
// tras el error de la primera prueba de reinstall.
const MUTATION_UPDATE = `
  mutation carrierServiceUpdate($input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(input: $input) {
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
 * Lista los carrier services que ESTA app ve en la tienda (Shopify filtra
 * por app automáticamente — nunca devuelve carriers de otras apps).
 */
export async function listarCarrierServicesShopify(
  shop: string,
  accessTokenCifrado: string,
): Promise<CarrierServiceShopify[]> {
  const accessToken = decryptSecret(accessTokenCifrado);
  const data = await shopifyGraphQL<{
    carrierServices?: {
      edges?: Array<{ node: CarrierServiceShopify }>;
    };
  }>(shop, accessToken, QUERY_LIST);
  const edges = data?.carrierServices?.edges ?? [];
  return edges.map((e) => e.node);
}

/**
 * Registra o actualiza el CarrierService de Shipro en la tienda Shopify.
 *
 * Decide crear-vs-actualizar según lo que la app ve HOY en Shopify (listado
 * en vivo), no según el id guardado en BD — ver header del archivo para el
 * razonamiento. Autocura reinstalls y evita quedar pegado a carriers de otras
 * apps.
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

  // 1. Listar carriers visibles para ESTA app + buscar el nuestro por name
  //    "Shipro" + callbackUrl que apunte a /api/shopify/rates (el token puede
  //    haber rotado — matcheamos solo el path, no el query string).
  const carriersVisibles = await listarCarrierServicesShopify(
    input.shop,
    input.accessTokenCifrado,
  );
  const nuestros = carriersVisibles.filter(
    (c) => c.name === "Shipro" && c.callbackUrl.includes("/api/shopify/rates"),
  );

  if (nuestros.length > 1) {
    console.warn(
      `[registrarCarrierServiceShopify] shop=${input.shop} ${nuestros.length} carriers "Shipro" visibles; usando el primero (ids=${nuestros.map((c) => c.id).join(",")}). Duplicados a limpiar manualmente.`,
    );
  }

  const nuestroExistente = nuestros[0] ?? null;
  const esReinstall = !!nuestroExistente;

  // Shape del input de la mutation:
  //   - CREATE: incluye `supportsServiceDiscovery: true` (necesario al dar de alta).
  //   - UPDATE: incluye `id` dentro del input (firma confirmada 2026-10-15 vs
  //     prod + doc). Omite `supportsServiceDiscovery` — el carrier ya lo tiene
  //     del create; pasarlo acá no hace falta y mantiene el input mínimo.
  const inputGQL: Record<string, unknown> = esReinstall
    ? {
        id: nuestroExistente!.id,
        name: "Shipro",
        callbackUrl,
        active: true,
      }
    : {
        name: "Shipro",
        callbackUrl,
        active: true,
        supportsServiceDiscovery: true,
      };

  const data = await shopifyGraphQL<Record<string, unknown>>(
    input.shop,
    accessToken,
    esReinstall ? MUTATION_UPDATE : MUTATION_CREATE,
    { input: inputGQL }
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

  // Red de seguridad UPDATE → CREATE (2026-10-21): doc oficial Shopify REST
  // confirma "Only the app that creates a carrier service can update it";
  // además, el comportamiento del listado `carrierServices` cross-app NO está
  // documentado. Si el listado nos trajo un carrier fantasma de la app vieja,
  // el UPDATE va a fallar con userErrors de ownership (no de plan). En ese caso
  // caemos a CREATE limpio bajo la app nueva en vez de throwear.
  if (esReinstall && userErrors.length > 0) {
    console.warn(
      `[registrarCarrierServiceShopify] shop=${input.shop} UPDATE sobre id=${nuestroExistente!.id} falló con userErrors no-plan: ${userErrors
        .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
        .join(" | ")} — fallback a CREATE bajo la app actual.`,
    );
    const inputCreateFallback: Record<string, unknown> = {
      name: "Shipro",
      callbackUrl,
      active: true,
      supportsServiceDiscovery: true,
    };
    const dataFallback = await shopifyGraphQL<Record<string, unknown>>(
      input.shop,
      accessToken,
      MUTATION_CREATE,
      { input: inputCreateFallback },
    );
    const resCreate: any = (dataFallback as any)?.carrierServiceCreate;
    const errCreate: Array<{ field?: string[]; message: string }> = resCreate?.userErrors ?? [];
    const csCreate = resCreate?.carrierService;

    if (errCreate.length > 0 && errCreate.every((e) => esErrorDePlan(e.message))) {
      return {
        ok: false,
        motivo: "plan",
        detalle: errCreate.map((e) => e.message).join("; "),
      };
    }
    if (errCreate.length > 0) {
      throw new Error(
        `carrierService create (fallback post-update-fail) userErrors: ${errCreate
          .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
          .join(" | ")}`,
      );
    }
    const idCreate: string | undefined = csCreate?.id;
    if (!idCreate) {
      throw new Error("carrierService (fallback create) sin id en respuesta de Shopify");
    }
    return { ok: true, carrierServiceId: idCreate, creado: true };
  }

  // Otros userErrors en el camino CREATE (sin update previo): no esperados →
  // throw para que el caller lo logee + registre AuditoriaConfiguracion.
  if (userErrors.length > 0) {
    throw new Error(
      `carrierService create userErrors: ${userErrors
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
