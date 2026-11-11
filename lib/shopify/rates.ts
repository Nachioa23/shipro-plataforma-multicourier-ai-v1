// =============================================================================
// Shopify — Mapeo OpcionTarifa → Shopify rate (Fase 2, 2026-10-14).
// =============================================================================
// Convierte las OpcionTarifa domiciliarias del cotizador al shape del response
// del rates callback de Shopify. Scope FASE 2: SOLO DOMICILIO (sin sucursal/
// pickup — es otro mecanismo de Shopify, Fase futura).
//
// Decisiones alineadas con el molde de Tiendanube:
//   - Sin `codigoServicio` → se descarta la opción (sin code estable no tiene
//     sentido publicarla; mismo criterio que el rates callback TN).
//   - `price` en SUBUNIDADES (centavos) — Shopify espera `total_price` como
//     string de la cantidad entera en subunidades de la currency.
//   - DEUDA 156: `precioFinalBuyer ?? precioFinal` (el comprador ve el precio
//     con descuento del cliente; la facturación usa `precioFinal` aparte).
//   - Dedupe por `service_code` (ya es estable per generarServiceCodeShopify).
//
// `min_delivery_date` / `max_delivery_date` opcionales: si `slaHs` presente, se
// derivan en formato Shopify (`YYYY-MM-DD HH:mm:ss -0300`) a partir de días
// hábiles (saltea findes + feriados activos) usando `lib/utils/dias-habiles.ts`
// — misma cuenta que `calcularFechaEstimada` del cotizador, para que Shopify
// no diverja del resto de las superficies (PIEZA 4 cascada de promesa). Rango
// real: min = (días-1) hábiles, max = días hábiles después de hoy. Si slaHs
// no viene, se omiten (Shopify los admite null/undefined).
// =============================================================================

import type { Prisma } from "@prisma/client";
import { generarServiceCodeShopify } from "@/lib/shopify/servicios";
import {
  obtenerFeriadosActivosCacheados,
  calcularRangoDiasHabiles,
} from "@/lib/utils/dias-habiles";
import { DIAS_PREPARACION_DEFAULT } from "@/lib/constants/preparacion";

// Shape mínimo requerido por este helper — subset de OpcionTarifa.
// No importamos el tipo completo para dejar el helper reusable desde
// consumers de testing que no quieran construir todo el OpcionTarifa.
interface OpcionDomicilioShape {
  courier: string;
  modalidad: string;
  codigoServicio?: string;
  precioFinal: Prisma.Decimal;
  precioFinalBuyer?: Prisma.Decimal;
  slaHs?: number;
}

export interface ShopifyRate {
  service_name: string;
  service_code: string;
  total_price: string; // subunidades de la currency (ej. centavos ARS)
  currency: string;
  description?: string;
  min_delivery_date?: string;
  max_delivery_date?: string;
}

/**
 * Formatea un Date a `YYYY-MM-DD HH:mm:ss -0300` (formato que Shopify espera
 * en min/max_delivery_date). Fijo UTC-3 Argentina (ver recon timezone 2026-10-14:
 * AR es un solo huso sin DST — el motor asume AR global).
 */
function formatShopifyDate(d: Date): string {
  // Convertir a hora local Argentina sumando el offset manual al UTC.
  const argMs = d.getTime() - 3 * 60 * 60 * 1000;
  const arg = new Date(argMs);
  const yyyy = arg.getUTCFullYear();
  const mm = String(arg.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(arg.getUTCDate()).padStart(2, "0");
  const hh = String(arg.getUTCHours()).padStart(2, "0");
  const mi = String(arg.getUTCMinutes()).padStart(2, "0");
  const ss = String(arg.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} -0300`;
}

/**
 * Mapea las opciones domiciliarias de la cotización al array de rates para
 * Shopify. Opciones sin `codigoServicio` se descartan (sin service_code estable).
 * Dedupe por service_code.
 *
 * @param domicilio - `resultado.domicilio` del cotizador.
 * @param currency - código de moneda del request (ej. "ARS").
 * @returns array de rates listos para `{ rates: [...] }` del response.
 */
export async function mapearCotizacionAShopify(
  domicilio: OpcionDomicilioShape[],
  currency: string
): Promise<ShopifyRate[]> {
  const ahora = new Date();
  // Cargar feriados una sola vez por invocación (el helper cachea a nivel
  // módulo con TTL; esta llamada es barata y evita N queries por opción).
  const feriados = await obtenerFeriadosActivosCacheados();
  const seen = new Set<string>();
  const rates: ShopifyRate[] = [];

  for (const o of domicilio) {
    if (!o.codigoServicio) continue; // sin code estable → no se publica
    const service_code = generarServiceCodeShopify(o.courier, o.codigoServicio);
    if (seen.has(service_code)) continue;
    seen.add(service_code);

    // Precio al buyer en subunidades (centavos ARS). DEUDA 156.
    const precioBuyer = Number(o.precioFinalBuyer ?? o.precioFinal);
    const total_price = String(Math.round(precioBuyer * 100));

    const rate: ShopifyRate = {
      service_name: `${o.courier} - ${o.modalidad}`,
      service_code,
      total_price,
      currency,
      description: o.modalidad,
    };

    if (typeof o.slaHs === "number" && o.slaHs > 0) {
      // PIEZA 4 cascada de promesa: ETA por días hábiles (saltea findes +
      // feriados), misma fuente que `calcularFechaEstimada` del cotizador.
      // Capa de preparación v1 (2026-11-11): slaHs es TRÁNSITO; se suma
      // DIAS_PREPARACION_DEFAULT para llevar la fecha al comprador a
      // end-to-end. Misma suma que hace el cotizador en calcularFechaEstimada.
      const diasTransito = Math.ceil(o.slaHs / 24);
      const totalDias = DIAS_PREPARACION_DEFAULT + diasTransito;
      const { fechaMin, fechaMax } = calcularRangoDiasHabiles(ahora, totalDias, feriados);
      rate.min_delivery_date = formatShopifyDate(fechaMin);
      rate.max_delivery_date = formatShopifyDate(fechaMax);
    }

    rates.push(rate);
  }

  return rates;
}
