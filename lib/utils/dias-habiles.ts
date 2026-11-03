// ============================================================================
// PIEZA 0 cascada de promesa — cálculo de días hábiles reutilizable.
// Extracción de la mecánica que vivía como closure interna en lib/cotizador.ts
// (líneas 95-127 antes del refactor). Aditivo, sin cambio de comportamiento
// visible: mismo loop, misma regla de findes (getDay 0/6), misma comparación
// de fechas de feriados contra el set cargado desde Feriado.activo=true.
//
// DIFERENCIA DELIBERADA respecto del original:
// - Los feriados activos se cachean a nivel módulo con TTL corto (5 min).
//   Antes, el cotizador hacía `prisma.feriado.findMany` en cada invocación
//   de `calcularFechaEstimada` (2 llamadas por courier en el peor caso →
//   2*N queries por cotización). El cache elimina el round-trip sin
//   cambiar la math.
//
//   Consecuencia operativa a tener presente: si el admin carga un feriado
//   nuevo por /admin-couriers (tab Feriados), el cotizador puede seguir
//   usando el set previo hasta 5 minutos. El impacto es un texto UX
//   ligeramente desactualizado ("Llega el 5 de mayo" en vez de "Llega el 6")
//   — nunca afecta plata.
//
// DEUDA DE ZONA HORARIA (preservada, no corregida en esta pieza):
// El loop usa `fecha.setDate(...)` + `fecha.getDay()` + `fecha.toISOString()`,
// que mezclan la zona horaria LOCAL del server (setDate/getDay) con UTC
// (toISOString). En producción (Linode UTC) resulta todo-UTC consistente;
// en desarrollo local (Mac AR) puede divergir en el cruce de medianoche.
// Pasar todo a America/Argentina/Buenos_Aires requiere un helper de TZ
// (Intl.DateTimeFormat o libs como date-fns-tz) y afecta puntos donde hoy
// no se controla la TZ — queda fuera del alcance de la Pieza 0 (ajuste
// acotado). DEUDA registrada para una pieza posterior de la cascada.
//
// USO TÍPICO:
//   const feriados = await obtenerFeriadosActivosCacheados();
//   const { fechaMin, fechaMax } = calcularRangoDiasHabiles(new Date(), 3, feriados);
//   // formateo a string en el caller (Intl.DateTimeFormat / toLocaleDateString)
// ============================================================================

import prisma from "@/lib/prisma";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

let cache: { fechas: Set<string>; expiraEn: number } | null = null;
let inflightFetch: Promise<Set<string>> | null = null;

/**
 * Devuelve el conjunto de feriados activos como strings `YYYY-MM-DD`
 * (mismo formato que produce el loop: `date.toISOString().split('T')[0]`).
 *
 * Cache in-memory con TTL (ver CACHE_TTL_MS). Serializa requests concurrentes
 * vía `inflightFetch` para no disparar N findMany en paralelo en el primer hit
 * frío (defensive: cotizar() corre couriers con Promise.allSettled y cada tarea
 * puede llegar acá a la vez).
 */
export async function obtenerFeriadosActivosCacheados(): Promise<Set<string>> {
  const ahora = Date.now();
  if (cache && cache.expiraEn > ahora) return cache.fechas;
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    try {
      const filas = await prisma.feriado.findMany({ where: { activo: true } });
      const fechas = new Set(filas.map((f) => f.fecha.toISOString().split("T")[0]));
      cache = { fechas, expiraEn: Date.now() + CACHE_TTL_MS };
      return fechas;
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

/**
 * Suma `diasHabiles` días hábiles a `fechaBase`, salteando sábados y domingos
 * (getDay 0=domingo, 6=sábado) y las fechas de `feriados` (strings `YYYY-MM-DD`
 * equivalentes al `toISOString().split('T')[0]` de la fecha iterada).
 *
 * Mecánica byte-por-byte igual al closure original de lib/cotizador.ts
 * (ver header de este archivo por la deuda de TZ).
 *
 * @param fechaBase punto de partida (NO modificado; se clona).
 * @param diasHabiles cantidad de días hábiles a sumar.
 * @param feriados set de fechas no laborables en formato `YYYY-MM-DD`.
 * @returns nueva Date resultante.
 */
export function sumarDiasHabiles(
  fechaBase: Date,
  diasHabiles: number,
  feriados: Set<string>,
): Date {
  const fecha = new Date(fechaBase);
  let agregados = 0;
  while (agregados < diasHabiles) {
    fecha.setDate(fecha.getDate() + 1);
    const fechaString = fecha.toISOString().split("T")[0];
    const esFinDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6;
    const esFeriado = feriados.has(fechaString);
    if (!esFinDeSemana && !esFeriado) agregados++;
  }
  return fecha;
}

/**
 * Rango de entrega en días hábiles: `fechaMin` = (diasHabilesRequeridos − 1)
 * días hábiles después de `fechaBase` (con piso 1), `fechaMax` =
 * `diasHabilesRequeridos` días hábiles después. Replica el par
 * (fechaMin, fechaMax) que el cotizador armaba internamente para producir
 * el texto UX "Llega entre el X y el Y".
 */
export function calcularRangoDiasHabiles(
  fechaBase: Date,
  diasHabilesRequeridos: number,
  feriados: Set<string>,
): { fechaMin: Date; fechaMax: Date } {
  const fechaMin = sumarDiasHabiles(fechaBase, Math.max(1, diasHabilesRequeridos - 1), feriados);
  const fechaMax = sumarDiasHabiles(fechaBase, diasHabilesRequeridos, feriados);
  return { fechaMin, fechaMax };
}

/**
 * Invalida el cache de feriados. Útil para tests y para el POST de
 * /api/admin/feriados si queremos que el siguiente cotizar() vea los
 * cambios sin esperar al TTL (no se enchufa en esta pieza — se deja
 * disponible para la UI de admin si Nacho decide usarlo).
 */
export function invalidarCacheFeriados(): void {
  cache = null;
}
