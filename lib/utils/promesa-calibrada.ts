// ============================================================================
// HELPER COMPARTIDO — PROMESA DE ENTREGA CALIBRADA (Torre de Control 2.3)
// ============================================================================
//
// Documento maestro: docs/TORRE-DE-CONTROL.md (DEUDA 39, diseño 2026-06-04).
//
// Que hace:
//   Dado un (courierId, depositoId?, provinciaDestino), devuelve la promesa
//   calibrada en horas via cuadruple fallback:
//
//     Nivel 1: P75 historico por (deposito, courier, provincia) si muestra >= 10
//     Nivel 2: P75 historico por (courier, provincia) si muestra >= 10
//     Nivel 3: promedio MetricaSLA por (courier, provincia) si existe
//     Nivel 4: fallback hardcoded (24h Mocis, 72h resto)
//
//   La decision 3 de la metrica (nivel de seguridad) hardcodea P75 en v1.
//   Cuando se implemente configuracion por cliente, este helper acepta nuevo
//   parametro 'percentil'.
//
// Consumers:
//   - app/api/torre-de-control/promesa-calibrada/route.ts (endpoint analitico)
//   - lib/cotizador.ts (motor de cotizacion al checkout y dashboard)
//
// Notas tecnicas:
//   - Calculo on-the-fly. No usa cron ni cache. SQLite no soporta percentile
//     functions nativas, calculo en JavaScript.
//   - Provincia normalizada (lowercase + trim) para evitar duplicados.
//     Cuando se migre a PostgreSQL, podemos mover la normalizacion a la query
//     con mode: 'insensitive'.
//   - Umbral minimo 10 envios consistente con cotizador actual.
//   - Conversion horas a dias se hace en el caller (Math.ceil), NO aqui.
//     El helper devuelve siempre horas para coherencia interna.
// ============================================================================

import prisma from "@/lib/prisma";

// Ventana temporal de busqueda (en dias).
export const VENTANA_DIAS_DEFAULT = 90;

// Umbral minimo de envios para considerar calibracion confiable.
// Mismo valor que el cotizador actual (lib/cotizador.ts linea 174).
export const UMBRAL_MUESTRA_MINIMA = 10;

// Percentil hardcoded para v1 (Decision 3: γ).
const PERCENTIL_PROMESA = 0.75;

// Niveles de fallback en orden de preferencia.
export type NivelCalibracion = 1 | 2 | 3 | 4;

export interface PromesaCalibradaResult {
  // Promesa calibrada en horas (siempre).
  slaHoras: number;

  // Nivel de fallback que se uso (1 = mejor calibracion, 4 = hardcoded).
  nivel: NivelCalibracion;

  // Cantidad de envios en la muestra que produjo la promesa.
  // null para nivel 4 (hardcoded sin muestra).
  cantidadMuestra: number | null;

  // Etiqueta UX-friendly para mostrar al usuario.
  etiqueta: "Calibrado por deposito" | "Calibrado por courier" | "Promedio historico" | "Tiempo estimado";

  // Flag de confianza: true si nivel 1 o 2 (datos reales).
  esCalibracionReal: boolean;
}

/**
 * Normaliza una provincia para comparar (lowercase + trim).
 * Cuando migremos a PostgreSQL, esto puede moverse a query con mode: 'insensitive'.
 * Exportado para reuso en endpoint analitico y cotizador.
 */
export function normalizarProvincia(provincia: string | null | undefined): string | null {
  if (!provincia) return null;
  const limpia = provincia.trim().toLowerCase();
  if (limpia.length === 0) return null;
  return limpia;
}

/**
 * Calcula P75 sobre un array de horas. Devuelve null si muestra vacia.
 * Exportado para reuso en endpoint analitico (que computa otros percentiles
 * tambien P50 P90, pero esta es la del nivel de seguridad estandar).
 */
export function calcularP75(horas: number[]): number | null {
  if (horas.length === 0) return null;
  const ordenados = [...horas].sort((a, b) => a - b);
  const indice = Math.floor(ordenados.length * PERCENTIL_PROMESA);
  return ordenados[Math.min(indice, ordenados.length - 1)];
}

// Fallback hardcoded por courier (mismo criterio que cotizador actual).
function fallbackHardcoded(nombreCourier: string): number {
  const nombreLimpio = nombreCourier.toLowerCase().trim();
  if (nombreLimpio === "mocis") return 24;
  return 72;
}

/**
 * Calcula la promesa de entrega calibrada para una combinacion especifica.
 *
 * Aplica cuadruple fallback en orden:
 *   1. P75 por (deposito, courier, provincia)
 *   2. P75 por (courier, provincia)
 *   3. Promedio MetricaSLA por (courier, provincia)
 *   4. Hardcoded por nombre de courier
 *
 * @param courierId ID del courier que va a hacer el envio.
 * @param depositoId ID del deposito de origen. Puede ser null cuando el caller
 *                   no conoce el deposito (ej: cotizador-rapido manual).
 * @param provinciaDestino Provincia del destinatario. String libre, se normaliza.
 * @param nombreCourier Nombre del courier (para el fallback hardcoded).
 * @param ventanaDias Ventana temporal de busqueda. Default 90 dias.
 * @returns PromesaCalibradaResult con horas, nivel, muestra, etiqueta.
 */
export async function calcularPromesaCalibrada(
  courierId: number,
  depositoId: number | null,
  provinciaDestino: string | null | undefined,
  nombreCourier: string,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<PromesaCalibradaResult> {
  const provinciaNorm = normalizarProvincia(provinciaDestino);

  // Si no hay provincia normalizable, saltamos directo a nivel 3.
  // (nivel 1 y 2 requieren provincia para agrupar).
  if (!provinciaNorm) {
    return await intentarMetricaSLA(courierId, nombreCourier);
  }

  // Calcular ventana temporal.
  const desde = new Date();
  desde.setDate(desde.getDate() - ventanaDias);

  // ========================================================================
  // QUERY UNICA — Traer envios candidatos por courier en la ventana.
  // Filtramos por courier para reducir tamaño. La normalizacion de provincia
  // y el filtro por deposito se hacen en JavaScript (SQLite no soporta
  // mode: insensitive).
  // ========================================================================
  const enviosCandidatos = await prisma.envio.findMany({
    where: {
      courierId,
      fechaImpresion: { gte: desde },
      fechaEntrega: { not: null },
      destinoId: { not: null },
    },
    select: {
      depositoId: true,
      fechaImpresion: true,
      fechaEntrega: true,
      destino: { select: { provincia: true } },
    },
  });

  // Pre-calcular horas por envio (descartar negativos o invalidos).
  const enviosConHoras = enviosCandidatos
    .filter(e =>
      e.fechaEntrega !== null &&
      e.fechaImpresion !== null &&
      e.destino !== null
    )
    .map(e => {
      const provNorm = normalizarProvincia(e.destino!.provincia);
      const horas = (e.fechaEntrega!.getTime() - e.fechaImpresion!.getTime()) / 3600000;
      return {
        depositoId: e.depositoId,
        provinciaNorm: provNorm,
        horas,
      };
    })
    .filter(e => e.horas > 0 && e.provinciaNorm !== null);

  // ========================================================================
  // NIVEL 1 — (deposito, courier, provincia)
  // ========================================================================
  if (depositoId !== null) {
    const horasNivel1 = enviosConHoras
      .filter(e => e.depositoId === depositoId && e.provinciaNorm === provinciaNorm)
      .map(e => e.horas);

    if (horasNivel1.length >= UMBRAL_MUESTRA_MINIMA) {
      const p75 = calcularP75(horasNivel1);
      if (p75 !== null) {
        return {
          slaHoras: p75,
          nivel: 1,
          cantidadMuestra: horasNivel1.length,
          etiqueta: "Calibrado por deposito",
          esCalibracionReal: true,
        };
      }
    }
  }

  // ========================================================================
  // NIVEL 2 — (courier, provincia) sin distinguir deposito
  // ========================================================================
  const horasNivel2 = enviosConHoras
    .filter(e => e.provinciaNorm === provinciaNorm)
    .map(e => e.horas);

  if (horasNivel2.length >= UMBRAL_MUESTRA_MINIMA) {
    const p75 = calcularP75(horasNivel2);
    if (p75 !== null) {
      return {
        slaHoras: p75,
        nivel: 2,
        cantidadMuestra: horasNivel2.length,
        etiqueta: "Calibrado por courier",
        esCalibracionReal: true,
      };
    }
  }

  // ========================================================================
  // NIVEL 3 — MetricaSLA (cron pre-calculado, promedio historico)
  // ========================================================================
  return await intentarMetricaSLA(courierId, nombreCourier, provinciaNorm);
}

/**
 * Intento intermedio en la cadena de fallback:
 *   Consulta MetricaSLA del cron. Si existe, devuelve nivel 3.
 *   Si no existe, devuelve nivel 4 (hardcoded).
 */
async function intentarMetricaSLA(
  courierId: number,
  nombreCourier: string,
  provinciaNorm?: string | null
): Promise<PromesaCalibradaResult> {
  // Query MetricaSLA. Si tenemos provincia, filtramos por ella; si no, traemos
  // cualquier metrica del courier (improbable que aporte, pero es defensivo).
  const where: any = { courierId };
  // MetricaSLA.provinciaDestino es string libre tambien. Para match real
  // necesitariamos normalizar tambien ahi, pero la BD del cron lo guarda
  // tal como llega del Envio.destino.provincia. Asumimos misma capitalizacion.
  // Cuando migremos a PostgreSQL, mode: 'insensitive' resuelve esto.

  const metricasSLA = await prisma.metricaSLA.findMany({
    where,
    select: {
      slaPromedioHs: true,
      muestraEnvios: true,
      provinciaDestino: true,
    },
  });

  // Match contra provincia normalizada (en JavaScript).
  if (provinciaNorm) {
    const match = metricasSLA.find(
      m => normalizarProvincia(m.provinciaDestino) === provinciaNorm
    );
    if (match && match.muestraEnvios >= UMBRAL_MUESTRA_MINIMA) {
      return {
        slaHoras: match.slaPromedioHs,
        nivel: 3,
        cantidadMuestra: match.muestraEnvios,
        etiqueta: "Promedio historico",
        esCalibracionReal: false,
      };
    }
  }

  // ========================================================================
  // NIVEL 4 — Hardcoded por nombre de courier
  // ========================================================================
  return {
    slaHoras: fallbackHardcoded(nombreCourier),
    nivel: 4,
    cantidadMuestra: null,
    etiqueta: "Tiempo estimado",
    esCalibracionReal: false,
  };
}
