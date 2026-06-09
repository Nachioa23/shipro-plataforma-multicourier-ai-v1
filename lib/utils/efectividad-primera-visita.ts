// ============================================================================
// HELPER DE EFECTIVIDAD DE PRIMERA VISITA (Métrica 2.2, 2026-06-09)
//
// Mide la cantidad de visitas del courier antes de la entrega exitosa.
//
// Regla operativa (definida por el director, 2026-06-09):
// - Visitas = cantidad de eventos `EN_DISTRIBUCION` en el historial.
// - `VISITA_FALLIDA` NO cuenta como visita separada (es resultado de la
//   `EN_DISTRIBUCION` previa, no una salida nueva del courier).
//
// Universo: solo envios ENTREGADO. Envios no entregados quedan en NO_APLICA.
//
// Edge case (decision director): envio ENTREGADO sin ningun EN_DISTRIBUCION
// previo (e.g., Same Day o Retiro en Sucursal) cuenta como
// PRIMERA_VISITA_EXITOSA.
// ============================================================================

import type { EventoTracking } from "@prisma/client";

// ====================================================
// CLASIFICACIONES
// ====================================================

export type ClasificacionEfectividad =
  | "PRIMERA_VISITA_EXITOSA"   // ENTREGADO con 0 o 1 EN_DISTRIBUCION previos
  | "VISITAS_FORZADAS"         // ENTREGADO con 2+ EN_DISTRIBUCION previos
  | "DEVUELTO_AL_REMITENTE"    // Envio que termina con devolucion al remitente (cierre del ciclo original)
  | "NO_APLICA";               // En curso, INCIDENCIA, CANCELADO o sin datos

// ====================================================
// CONSTANTES
// ====================================================

// Estados que cuentan como "visita" en el conteo.
// Por decision del director (2.2.B.3): solo EN_DISTRIBUCION.
// VISITA_FALLIDA es resultado, no visita separada.
const ESTADO_VISITA = "EN_DISTRIBUCION";
const ESTADO_FINAL_EXITOSO = "ENTREGADO";
const ESTADO_DEVUELTO = "DEVUELTO_AL_REMITENTE";

// ====================================================
// FUNCIONES PURAS
// ====================================================

/**
 * Cuenta cuantas veces el envio paso por EN_DISTRIBUCION en su historial.
 * No incluye VISITA_FALLIDA (es consecuencia, no salida nueva del courier).
 */
export function contarVisitas(eventos: EventoTracking[]): number {
  return eventos.filter(e => e.estado === ESTADO_VISITA).length;
}

/**
 * Clasifica el envio segun el patron de visitas vs cierre del ciclo.
 *
 * Reglas (decision director 2026-06-09):
 * - ENTREGADO con 0 o 1 visitas previas → PRIMERA_VISITA_EXITOSA
 * - ENTREGADO con 2+ visitas previas → VISITAS_FORZADAS
 * - DEVUELTO_AL_REMITENTE (sin ENTREGADO) → DEVUELTO_AL_REMITENTE (cierre con devolucion)
 * - Otros casos (en curso, INCIDENCIA, CANCELADO) → NO_APLICA
 *
 * El universo "util" para la metrica es ENTREGADO + DEVUELTO_AL_REMITENTE.
 * Los tres clasificadores no-NO_APLICA suman al funnel del modal.
 */
export function clasificarEfectividad(eventos: EventoTracking[]): ClasificacionEfectividad {
  const fueEntregado = eventos.some(e => e.estado === ESTADO_FINAL_EXITOSO);
  const fueDevuelto = eventos.some(e => e.estado === ESTADO_DEVUELTO);

  // ENTREGADO siempre prioriza (caso bidireccional: paquete "perdido" reaparece).
  if (fueEntregado) {
    const cantidadVisitas = contarVisitas(eventos);
    if (cantidadVisitas <= 1) return "PRIMERA_VISITA_EXITOSA";
    return "VISITAS_FORZADAS";
  }

  if (fueDevuelto) return "DEVUELTO_AL_REMITENTE";

  return "NO_APLICA";
}

/**
 * Extrae el motivo de la ultima visita fallida o incidencia para mostrar
 * en "Top Motivos de Falla" del modal.
 *
 * Retorna null si no hay eventos de falla/incidencia.
 */
export function obtenerMotivoUltimaFalla(eventos: EventoTracking[]): string | null {
  // Buscar el ultimo evento de VISITA_FALLIDA o INCIDENCIA (orden cronologico inverso).
  const ordenadoDesc = [...eventos].sort((a, b) => {
    return new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
  });

  for (const evento of ordenadoDesc) {
    if (evento.estado === "VISITA_FALLIDA" || evento.estado === "INCIDENCIA" || evento.estado === ESTADO_DEVUELTO) {
      // Si tiene observacion, devolverla. Si no, devolver el estado crudo
      // original (que el cron preserva por F2 + F5).
      return evento.observacion || evento.estadoCrudoOriginal || evento.estado;
    }
  }

  return null;
}

// ====================================================
// AGRUPADOR DE METRICAS PARA MULTIPLES ENVIOS
// ====================================================

export interface ResumenEfectividad {
  totalEnvios: number;
  totalEntregados: number;
  totalDevueltos: number;
  totalUniverso: number;            // ENTREGADOS + DEVUELTOS (el "funnel" del modal)
  totalPrimeraVisitaExitosa: number;
  totalVisitasForzadas: number;
  totalNoAplica: number;
  porcentajePrimeraVisita: number;   // % sobre universo (decision 2.2.C.4 opcion A)
  porcentajeVisitasForzadas: number; // % sobre universo
  porcentajeDevoluciones: number;    // % sobre universo
}

/**
 * Calcula el resumen agregado de efectividad sobre un set de envios.
 * Recibe envios con sus eventos joinados.
 */
export function resumirEfectividad(
  enviosConEventos: Array<{ id: number; eventos: EventoTracking[] }>
): ResumenEfectividad {
  let totalEntregados = 0;
  let totalDevueltos = 0;
  let totalPrimeraVisitaExitosa = 0;
  let totalVisitasForzadas = 0;
  let totalNoAplica = 0;

  for (const envio of enviosConEventos) {
    const clasificacion = clasificarEfectividad(envio.eventos);

    switch (clasificacion) {
      case "PRIMERA_VISITA_EXITOSA":
        totalPrimeraVisitaExitosa++;
        totalEntregados++;
        break;
      case "VISITAS_FORZADAS":
        totalVisitasForzadas++;
        totalEntregados++;
        break;
      case "DEVUELTO_AL_REMITENTE":
        totalDevueltos++;
        break;
      case "NO_APLICA":
        totalNoAplica++;
        break;
    }
  }

  // Universo: ENTREGADOS + DEVUELTOS (decision 2.2.C.4 opcion A).
  const totalUniverso = totalEntregados + totalDevueltos;

  const porcentajePrimeraVisita = totalUniverso > 0
    ? Math.round((totalPrimeraVisitaExitosa / totalUniverso) * 100)
    : 0;
  const porcentajeVisitasForzadas = totalUniverso > 0
    ? Math.round((totalVisitasForzadas / totalUniverso) * 100)
    : 0;
  const porcentajeDevoluciones = totalUniverso > 0
    ? Math.round((totalDevueltos / totalUniverso) * 100)
    : 0;

  return {
    totalEnvios: enviosConEventos.length,
    totalEntregados,
    totalDevueltos,
    totalUniverso,
    totalPrimeraVisitaExitosa,
    totalVisitasForzadas,
    totalNoAplica,
    porcentajePrimeraVisita,
    porcentajeVisitasForzadas,
    porcentajeDevoluciones,
  };
}
