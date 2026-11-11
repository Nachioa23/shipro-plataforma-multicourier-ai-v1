// ============================================================================
// PROMESA DE ENTREGA — cálculo compartido de fechas end-to-end + copy UX.
// ============================================================================
// Consolida en un único lugar el cómputo (pickup / min / max) que antes vivía
// duplicado en el cotizador (texto "Llega entre X e Y") y en el mapper de
// Shopify (min/max_delivery_date). Reusa los building blocks existentes:
//   - lib/utils/dias-habiles.ts: cache de feriados + loop días hábiles.
//   - lib/constants/preparacion.ts: DIAS_PREPARACION_DEFAULT v1 global.
//
// Uso típico (en un mapper que emite múltiples rates por invocación):
//   const feriados = await obtenerFeriadosActivosCacheados();
//   const ahora = new Date();
//   for (const o of opciones) {
//     const fechas = await calcularPromesaFechas({
//       slaHoras: o.slaHs, fechaBase: ahora, feriados,
//     });
//     rate.min_delivery_date = formatFechaARDateTime(fechas.fechaMin);
//     rate.description = construirCopyPromesa(fechas, { estimado });
//   }
//
// En single-shot (una sola fecha por invocación), basta con llamar sin
// feriados/fechaBase — el helper los resuelve solo.
// ============================================================================

import {
  obtenerFeriadosActivosCacheados,
  sumarDiasHabiles,
  calcularRangoDiasHabiles,
} from "@/lib/utils/dias-habiles";
import { DIAS_PREPARACION_DEFAULT } from "@/lib/constants/preparacion";

export interface PromesaFechas {
  // Día hábil en que el courier retira del depósito (base + prep días hábiles).
  pickupDate: Date;
  // Inicio del rango end-to-end de entrega al comprador.
  fechaMin: Date;
  // Fin del rango end-to-end de entrega al comprador.
  fechaMax: Date;
  // prep + tránsito (días hábiles totales desde base hasta fechaMax).
  totalDiasHabiles: number;
}

export async function calcularPromesaFechas(opts: {
  slaHoras: number;
  fechaBase?: Date;
  diasPreparacion?: number;
  feriados?: Set<string>;
}): Promise<PromesaFechas> {
  const prep = opts.diasPreparacion ?? DIAS_PREPARACION_DEFAULT;
  const feriados = opts.feriados ?? (await obtenerFeriadosActivosCacheados());
  const base = opts.fechaBase ?? new Date();
  // Tránsito: ceil(horas/24), piso 1. Alineado con la cuenta original de
  // calcularFechaEstimada del cotizador (byte-identical al refactorear).
  const diasTransito = Math.max(1, Math.ceil(opts.slaHoras / 24));
  const totalDiasHabiles = prep + diasTransito;
  const pickupDate = sumarDiasHabiles(base, prep, feriados);
  const { fechaMin, fechaMax } = calcularRangoDiasHabiles(base, totalDiasHabiles, feriados);
  return { pickupDate, fechaMin, fechaMax, totalDiasHabiles };
}

// ----------------------------------------------------------------------------
// Copy UX es-AR para canales que tienen un campo de descripción textual
// (ej. Shopify `description`, o la API REST pública).
// ----------------------------------------------------------------------------

function esMismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function etiquetaPickup(pickupDate: Date, hoy: Date): string {
  const mañana = new Date(hoy);
  mañana.setDate(hoy.getDate() + 1);
  if (esMismoDia(pickupDate, hoy)) return "hoy";
  if (esMismoDia(pickupDate, mañana)) return "mañana";
  // Intl.DateTimeFormat es-AR devuelve el weekday en minúscula ("lunes").
  return `el ${pickupDate.toLocaleDateString("es-AR", { weekday: "long" })}`;
}

/**
 * Formato (es-AR, weekdays lowercase):
 *   "Recolección {hoy|mañana|el <wd>} · entrega entre el <wdMin> y el <wdMax>"
 *   "Recolección ... · entrega el <wd>"       (si fechaMin === fechaMax)
 *   + " (estimada)" al final cuando opts.estimado === true.
 *
 * `estimado` es un flag del caller — reusa el campo de confianza que ya existe
 * en la cotización (ej. OpcionTarifa.etiquetaSla === "Tiempo estimado"), este
 * helper no recomputa confianza.
 */
export function construirCopyPromesa(
  f: PromesaFechas,
  opts?: { estimado?: boolean; hoy?: Date }
): string {
  const hoy = opts?.hoy ?? new Date();
  const pickup = etiquetaPickup(f.pickupDate, hoy);
  const sufijo = opts?.estimado ? " (estimada)" : "";
  if (f.fechaMin.getTime() === f.fechaMax.getTime()) {
    const dia = f.fechaMax.toLocaleDateString("es-AR", { weekday: "long" });
    return `Recolección ${pickup} · entrega el ${dia}${sufijo}`;
  }
  const dMin = f.fechaMin.toLocaleDateString("es-AR", { weekday: "long" });
  const dMax = f.fechaMax.toLocaleDateString("es-AR", { weekday: "long" });
  return `Recolección ${pickup} · entrega entre el ${dMin} y el ${dMax}${sufijo}`;
}

// ----------------------------------------------------------------------------
// Formato ISO 8601 AR usado por Tiendanube en min/max_delivery_date:
// `YYYY-MM-DDTHH:mm:ss-0300` (separador "T", sin espacio antes del offset).
// Shape verbatim del ejemplo oficial del shipping-carrier rate de TN:
// "2016-07-14T14:48:45-0300". AR es un solo huso sin DST (recon timezone
// 2026-10-14): offset -0300 fijo.
//
// Shopify NO usa este formato — tiene su propio `formatShopifyDate` local
// en lib/shopify/rates.ts con el shape `YYYY-MM-DD HH:mm:ss -0300` (espacio
// separador y espacio antes del offset) que Shopify documenta aparte.
// ----------------------------------------------------------------------------
export function formatFechaARDateTime(d: Date): string {
  const argMs = d.getTime() - 3 * 60 * 60 * 1000;
  const arg = new Date(argMs);
  const yyyy = arg.getUTCFullYear();
  const mm = String(arg.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(arg.getUTCDate()).padStart(2, "0");
  const hh = String(arg.getUTCHours()).padStart(2, "0");
  const mi = String(arg.getUTCMinutes()).padStart(2, "0");
  const ss = String(arg.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-0300`;
}
