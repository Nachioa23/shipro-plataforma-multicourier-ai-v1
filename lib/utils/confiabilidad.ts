// ============================================================================
// DEUDA 186 PIEZA 3 (2026-10-21) — Helper calcularConfiabilidad.
// ============================================================================
// Lee MetricaConfiabilidad (poblada por el cron PIEZA 2) con fallback escalonado
// y devuelve la señal de confiabilidad lista para el consumo del scoring (c_sla
// = porcentajeOnTime / 100 cuando el motor FASE 3+ se encienda).
//
// MOLDE: lib/utils/promesa-calibrada.ts — mismo patrón de niveles de fallback,
// mismo PromesaCalibradaResult shape, misma convención de normalización de
// provincia.
//
// NIVELES DE FALLBACK (en orden de preferencia; cae al siguiente si no hay
// muestra suficiente — umbral 30, estándar industria para % confiable):
//
//   1. (courier, provincia, esGlobal=false, ventanaDias pedida)
//      → la fila más granular + fresca; mejor confianza.
//
//   2. (courier, provincia, esGlobal=false, VENTANA MÁS GRANDE)
//      → si la ventana pedida no tiene muestra suficiente, prueba ventanas
//        mayores en orden (90 → 180 → 270 → 360). Preserva el dato real a
//        costa de menos frescura.
//
//   3. (courier, esGlobal=true, cualquier ventana)
//      → fila agregada cross-provincia del courier. "El courier en general,
//        cuando no hay data de ESA provincia". Fallback a global por ventana
//        pedida; si tampoco, probar ventanas mayores.
//
//   4. TEÓRICO — porcentajeOnTime=100, muestra=0, gapPromedioHs=0,
//      esMuestraReal=false, etiqueta "Teórico (sin datos)".
//      Es el fallback PRE-DATOS. La tasa de cumplimiento del courier NO EXISTE
//      en ningún lado — recon 2026-10-22 confirmó: ni se declara por API,
//      ni la cargamos a mano, SlaCourier.diasPactados solo tiene PLAZO no tasa.
//      Entonces: todos los couriers arrancan empatados en 100% teórico, y
//      c_sla se degrada automáticamente con observación real a medida que el
//      cron PIEZA 2 acumula muestra ≥ 30.
//
// Si provinciaDestino es null/vacía → saltar Niveles 1-2 (necesitan provincia),
// ir directo a Nivel 3 (global) → Nivel 4.
//
// READ-ONLY: solo prisma.metricaConfiabilidad.findFirst / findUnique. Zero
// writes, zero touch de Envio/MovimientoFinanciero/saldoActivo/cotizador.
// Money-safe por naturaleza.
// ============================================================================

import prisma from "@/lib/prisma";
import { normalizarProvincia } from "@/lib/utils/promesa-calibrada";

// Umbral estadístico industria para que un % sea confiable (teorema del límite
// central mínimo para proporciones). Distinto del UMBRAL_MUESTRA_MINIMA=10 de
// promesa-calibrada — ese es para promedios de tiempo (menos sensible).
export const UMBRAL_MUESTRA_CONFIABILIDAD = 30;

// Ventanas canónicas (deben coincidir con las que puebla el cron PIEZA 2).
const VENTANAS_CANONICAS = [90, 180, 270, 360] as const;
export type VentanaConfiabilidad = typeof VENTANAS_CANONICAS[number];

// Niveles del fallback en orden de preferencia (1 = mejor, 4 = teórico).
export type NivelConfiabilidad = 1 | 2 | 3 | 4;

export interface ConfiabilidadResult {
  /** Porcentaje on-time 0-100. En Nivel 4 (teórico) es 100 constante. */
  porcentajeOnTime: number;
  /** Cantidad de envíos en la muestra. 0 en Nivel 4 (teórico sin muestra). */
  muestra: number;
  /** Delivery Estimation Accuracy — gap promedio (horas). 0 en Nivel 4. */
  gapPromedioHs: number;
  /** Nivel del fallback que produjo el resultado. */
  nivel: NivelConfiabilidad;
  /** true si Nivel 1-3 (datos reales con muestra ≥ umbral); false en Nivel 4. */
  esMuestraReal: boolean;
  /** Etiqueta UX-friendly para mostrar al operador / Torre. */
  etiqueta: string;
}

// Ventanas mayores a la pedida (en orden de preferencia: la más chica primero
// para preservar la frescura). Ej: pidió 90 → [180, 270, 360].
function ventanasMayores(ventana: VentanaConfiabilidad): VentanaConfiabilidad[] {
  return VENTANAS_CANONICAS.filter((v) => v > ventana);
}

// Fila teórica de Nivel 4. Sin muestra, se asume 100% on-time y gap 0 hasta
// que el cron PIEZA 2 acumule datos reales. Documentado en el header.
function nivelTeorico(): ConfiabilidadResult {
  return {
    porcentajeOnTime: 100,
    muestra: 0,
    gapPromedioHs: 0,
    nivel: 4,
    esMuestraReal: false,
    etiqueta: "Teórico (sin datos)",
  };
}

// Convierte una fila de la tabla al shape ConfiabilidadResult. Prisma devuelve
// Decimal para porcentajeOnTime y gapPromedioHs — toNumber() los pasa a float.
interface FilaMetrica {
  muestra: number;
  porcentajeOnTime: { toNumber(): number } | number;
  gapPromedioHs: { toNumber(): number } | number;
  muestraSuficiente: boolean;
}

function toResult(
  fila: FilaMetrica,
  nivel: NivelConfiabilidad,
  etiqueta: string,
): ConfiabilidadResult {
  const pOnTime =
    typeof fila.porcentajeOnTime === "number"
      ? fila.porcentajeOnTime
      : fila.porcentajeOnTime.toNumber();
  const gap =
    typeof fila.gapPromedioHs === "number"
      ? fila.gapPromedioHs
      : fila.gapPromedioHs.toNumber();
  return {
    porcentajeOnTime: pOnTime,
    muestra: fila.muestra,
    gapPromedioHs: gap,
    nivel,
    esMuestraReal: true,
    etiqueta,
  };
}

/**
 * Devuelve la confiabilidad del (courier, provincia, ventana) con fallback
 * escalonado 4 niveles. Lista para que el scoring consuma `c_sla =
 * porcentajeOnTime / 100`.
 *
 * @param courierId     ID del courier a scorear.
 * @param provinciaDestino Provincia destino string libre; se normaliza (lowercase+trim).
 *                      Si null/vacía, se saltan Niveles 1-2 → Nivel 3 (global) → 4.
 * @param ventanaDias   Ventana canónica (90/180/270/360). La empresa define
 *                      cuál usa (`Empresa.ventanaConfiabilidadDias`).
 * @param courierNombre Nombre del courier (reservado para futuras extensiones
 *                      — ej. si Nivel 4 pasa a leer una tasa declarada por
 *                      courier). Hoy el Nivel 4 es 100% constante para TODOS.
 */
export async function calcularConfiabilidad(
  courierId: number,
  provinciaDestino: string | null | undefined,
  ventanaDias: VentanaConfiabilidad,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  courierNombre: string,
): Promise<ConfiabilidadResult> {
  const provNorm = normalizarProvincia(provinciaDestino);

  // ========================================================================
  // NIVEL 1 — (courier, provincia, esGlobal=false, ventana pedida).
  // Requiere provincia.
  // ========================================================================
  if (provNorm) {
    const nivel1 = await prisma.metricaConfiabilidad.findUnique({
      where: {
        courierId_provinciaDestino_esGlobal_ventanaDias: {
          courierId,
          provinciaDestino: provNorm,
          esGlobal: false,
          ventanaDias,
        },
      },
      select: {
        muestra: true,
        porcentajeOnTime: true,
        gapPromedioHs: true,
        muestraSuficiente: true,
      },
    });
    if (nivel1 && nivel1.muestraSuficiente) {
      return toResult(nivel1, 1, "Confiabilidad por provincia");
    }

    // ======================================================================
    // NIVEL 2 — misma (courier, provincia) pero ventana MAYOR (preserva data
    // real a costa de menos frescura). Probar en orden las ventanas mayores.
    // ======================================================================
    for (const vMayor of ventanasMayores(ventanaDias)) {
      const nivel2 = await prisma.metricaConfiabilidad.findUnique({
        where: {
          courierId_provinciaDestino_esGlobal_ventanaDias: {
            courierId,
            provinciaDestino: provNorm,
            esGlobal: false,
            ventanaDias: vMayor,
          },
        },
        select: {
          muestra: true,
          porcentajeOnTime: true,
          gapPromedioHs: true,
          muestraSuficiente: true,
        },
      });
      if (nivel2 && nivel2.muestraSuficiente) {
        return toResult(nivel2, 2, `Confiabilidad por provincia (ventana ${vMayor}d)`);
      }
    }
  }

  // ========================================================================
  // NIVEL 3 — fila GLOBAL del courier (esGlobal=true, provinciaDestino="").
  // Fallback por ventana pedida; si tampoco, probar ventanas mayores.
  // ========================================================================
  const ventanasAIntentarGlobal: VentanaConfiabilidad[] = [
    ventanaDias,
    ...ventanasMayores(ventanaDias),
  ];
  for (const v of ventanasAIntentarGlobal) {
    const nivel3 = await prisma.metricaConfiabilidad.findUnique({
      where: {
        courierId_provinciaDestino_esGlobal_ventanaDias: {
          courierId,
          provinciaDestino: "",
          esGlobal: true,
          ventanaDias: v,
        },
      },
      select: {
        muestra: true,
        porcentajeOnTime: true,
        gapPromedioHs: true,
        muestraSuficiente: true,
      },
    });
    if (nivel3 && nivel3.muestraSuficiente) {
      const etiqueta =
        v === ventanaDias
          ? "Confiabilidad global del courier"
          : `Confiabilidad global del courier (ventana ${v}d)`;
      return toResult(nivel3, 3, etiqueta);
    }
  }

  // ========================================================================
  // NIVEL 4 — TEÓRICO. 100% constante, muestra 0. Se degrada con observación
  // real a medida que el cron PIEZA 2 acumula ≥ UMBRAL_MUESTRA_CONFIABILIDAD.
  // La tasa del courier NO EXISTE (recon 2026-10-22) → la única opción honesta
  // pre-datos.
  // ========================================================================
  return nivelTeorico();
}
