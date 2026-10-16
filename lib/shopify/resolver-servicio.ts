// =============================================================================
// Shopify — Resolver opción elegida por el buyer en el checkout (Fase 3).
// =============================================================================
// Al webhook orders/paid le llega qué opción eligió el buyer en el checkout:
//   - shipping_lines[0].code → el service_code que publicamos en /rates (Fase 2).
//     Primario: matchea 1:1 contra generarServiceCodeShopify(courier, codigoServicio).
//   - shipping_lines[0].price → el precioFinalBuyer que publicamos.
//     Fallback: Shopify a veces pisa el code con el string "Shipping" u otro
//     wording (merchants que personalizan nombres de métodos). En ese caso,
//     resolver por PROXIMIDAD DE PRECIO contra `precioFinalBuyer` de la
//     cotización fresca que corre el webhook — la opción cuyo precioFinalBuyer
//     está más cerca del precio pagado es la que el buyer eligió.
//
// Devuelve null si el array de domicilio está vacío (sin cobertura → el buyer
// NO debería haber podido pagar, pero defensive).
// =============================================================================

import type { OpcionTarifa } from "@/lib/cotizador";
import { generarServiceCodeShopify } from "@/lib/shopify/servicios";

/**
 * Resuelve qué `OpcionTarifa` eligió el buyer en el checkout.
 *
 * @param domicilio - resultado.domicilio de la cotización fresca (misma que
 *   corrió el rates callback — asumimos determinismo del motor).
 * @param shippingLineCode - `shipping_lines[0].code` del order payload (puede
 *   ser null si el merchant lo pisó).
 * @param precioPagadoBuyer - `Number(shipping_lines[0].price)` ya convertido
 *   a unidad base (ARS). Los orders webhooks mandan price como string
 *   decimal (ej. "1500.00"), NO subunidades.
 * @returns la OpcionTarifa elegida; null si domicilio está vacío.
 */
export function resolverOpcionElegida(
  domicilio: OpcionTarifa[],
  shippingLineCode: string | null,
  precioPagadoBuyer: number,
): OpcionTarifa | null {
  if (!domicilio || domicilio.length === 0) return null;

  // Primario: match por service_code estable.
  if (shippingLineCode) {
    const porCode = domicilio.find((o) => {
      if (!o.codigoServicio) return false;
      return generarServiceCodeShopify(o.courier, o.codigoServicio) === shippingLineCode;
    });
    if (porCode) return porCode;
  }

  // Fallback: proximidad de precio contra precioFinalBuyer (el que publicamos
  // al checkout). Las diferencias esperadas son 0 (match exacto en el mismo
  // motor); un umbral absoluto es excesivo — nos quedamos con el mínimo.
  let mejor: OpcionTarifa | null = null;
  let mejorDelta = Infinity;
  for (const o of domicilio) {
    const precioOpcion = Number(o.precioFinalBuyer ?? o.precioFinal);
    const delta = Math.abs(precioOpcion - precioPagadoBuyer);
    if (delta < mejorDelta) {
      mejorDelta = delta;
      mejor = o;
    }
  }
  return mejor;
}
