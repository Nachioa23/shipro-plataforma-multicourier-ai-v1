// =============================================================================
// Shopify — service_code estable por (courier, codigoServicio).
// =============================================================================
// Shopify asocia cada línea de envío cotizada con un `service_code`. A diferencia
// de Tiendanube — que exige pre-registrar los codes como carrier_options antes
// de emitir rates — Shopify los acepta "al vuelo" en la respuesta del rates
// callback. PERO: para que el merchant pueda referenciar un servicio desde
// Shopify Flow / fulfillment rules / webhooks (ej. "si service_code = andreani_entrega_estandar
// entonces notificar X"), el code debe ser **estable e independiente del CP**.
//
// Formato: `{slug(courier)}_{slug(codigoServicio)}` lowercase. `slug` colapsa
// non-alfanuméricos a `_` y recorta bordes. Mismo input → mismo output —
// determinista — para que sea referenciable en reglas del merchant.
//
// NOTA sobre separador vs Tiendanube: TN usa `-`; Shopify usa `_`. Shopify
// permite `[a-z0-9_-]` en service_code — ambos funcionarían, pero `_` es el
// convenio de otros providers (US-centric: USPS, FedEx) y mantiene paridad
// con nombres de scopes/features de Shopify.
// =============================================================================

/**
 * Normaliza una parte del service_code: lowercase, colapsa non-[a-z0-9] a `_`,
 * recorta `_` en bordes, colapsa `_` repetidos.
 */
function slug(parte: string): string {
  return parte
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/**
 * Genera el service_code estable para Shopify a partir del par
 * (courier, codigoServicio canónico). Formato: `{slug(courier)}_{slug(codigoServicio)}`.
 *
 * Ejemplo: `("Andreani", "entrega_domicilio_estandar")` → `"andreani_entrega_domicilio_estandar"`.
 *
 * El output debe ser determinista + estable: el mismo par siempre produce el
 * mismo code, para que las reglas del merchant lo matcheen a futuro sin romperse.
 *
 * @param courier - nombre canónico del courier (ej. "Andreani", "Mocis").
 * @param codigoServicio - código canónico del registry (ej. "entrega_domicilio_estandar").
 * @returns service_code estable lowercase `[a-z0-9_]`.
 */
export function generarServiceCodeShopify(courier: string, codigoServicio: string): string {
  return `${slug(courier)}_${slug(codigoServicio)}`;
}
