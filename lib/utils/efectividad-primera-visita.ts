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

import type { EventoTracking, Envio, FinanzasEnvio } from "@prisma/client";
import { ESTADOS_COURIER, type EstadoCourierKey } from "./estados";

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

// ====================================================
// METRICA 2.5 — ANATOMIA DE LA DEVOLUCION
//
// Analisis detallado de envios DEVUELTO_AL_REMITENTE: causa, costo,
// tiempo de inmovilizacion, touchpoints, y punto del flujo donde se
// origino la devolucion.
//
// Decisiones (director 2026-06-09):
// - Universo: solo envios DEVUELTO_AL_REMITENTE en la ventana.
// - Costo: precioFactura del envio (lo que Shipro le cobra a la empresa).
// - Tiempo: dias desde fechaImpresion (inmovilizacion de stock) hasta
//   evento DEVUELTO_AL_REMITENTE.
// - Touchpoints: cantidad de EventoTracking con estado en ESTADOS_COURIER × 2.
// - Punto de perdida: ultimo estado courier antes del evento DEVUELTO.
// ====================================================

// Set de keys courier para filtrar touchpoints (excluye estados internos
// como PENDIENTE, RETENIDO, IMPRESO, BLOQUEADO_*).
const KEYS_COURIER: Set<string> = new Set(Object.keys(ESTADOS_COURIER));

/**
 * Calcula dias desde fechaImpresion hasta el evento DEVUELTO_AL_REMITENTE.
 * Retorna null si no hay evento DEVUELTO o si fechaImpresion no esta.
 */
export function calcularDiasInmovilizacion(
  envio: { fechaImpresion: Date | null },
  eventos: EventoTracking[]
): number | null {
  if (!envio.fechaImpresion) return null;

  const eventoDevuelto = eventos.find(e => e.estado === "DEVUELTO_AL_REMITENTE");
  if (!eventoDevuelto) return null;

  const ms = new Date(eventoDevuelto.fecha).getTime() - new Date(envio.fechaImpresion).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Cuenta touchpoints del courier (eventos cuyo estado esta en el catalogo
 * ESTADOS_COURIER F1). Multiplica × 2 para representar ida + vuelta del
 * paquete por la red logistica.
 *
 * Estados internos (PENDIENTE, IMPRESO, RETENIDO, BLOQUEADO_*) NO cuentan
 * porque son del lado Shipro, no del courier moviendo el paquete.
 */
export function contarTouchpoints(eventos: EventoTracking[]): number {
  const touchpoints = eventos.filter(e => KEYS_COURIER.has(e.estado)).length;
  return touchpoints * 2;
}

/**
 * Identifica el ultimo estado courier antes del evento DEVUELTO_AL_REMITENTE.
 * Sirve para clasificar el "punto del flujo" donde se origino la devolucion:
 * - EN_DISTRIBUCION: el courier intento entregar y no pudo.
 * - VISITA_FALLIDA: ultima visita fallida explicita.
 * - INCIDENCIA: paquete siniestrado / extraviado.
 * - Otro: caso atipico (ej: directamente DEVUELTO sin contexto).
 */
export function identificarPuntoPerdida(eventos: EventoTracking[]): string | null {
  // Ordenar por fecha ascendente.
  const ordenados = [...eventos].sort((a, b) => {
    return new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
  });

  // Encontrar el indice del evento DEVUELTO_AL_REMITENTE.
  const idxDevuelto = ordenados.findIndex(e => e.estado === "DEVUELTO_AL_REMITENTE");
  if (idxDevuelto === -1) return null;

  // Buscar el ultimo estado courier ANTES del DEVUELTO.
  for (let i = idxDevuelto - 1; i >= 0; i--) {
    const evento = ordenados[i];
    if (KEYS_COURIER.has(evento.estado) && evento.estado !== "DEVUELTO_AL_REMITENTE") {
      return evento.estado;
    }
  }

  return null;
}

/**
 * Extrae el costo del envio devuelto desde FinanzasEnvio.
 * Si no hay finanzas o precioFactura es NULL, retorna sin_dato.
 */
export function extraerCosto(envio: { finanzas?: FinanzasEnvio | null }): {
  precioFactura: number | null;
  fuente: "facturado" | "sin_dato";
} {
  if (!envio.finanzas || envio.finanzas.precioFactura == null) {
    return { precioFactura: null, fuente: "sin_dato" };
  }
  return { precioFactura: envio.finanzas.precioFactura, fuente: "facturado" };
}

// ====================================================
// SHAPE CONSOLIDADO POR ENVIO
// ====================================================

export interface AnatomiaDevolucion {
  envioId: number;
  motivo: string | null;                  // observacion del evento DEVUELTO
  diasInmovilizacion: number | null;      // null si no hay timestamps
  visitasPrevias: number;                 // cantidad de EN_DISTRIBUCION
  touchpoints: number;                    // eventos courier × 2
  precioFactura: number | null;           // costo en pesos, null si sin dato
  puntoPerdida: string | null;            // ultimo estado antes de DEVUELTO
}

/**
 * Construye el shape consolidado para un envio devuelto.
 */
export function extraerInfoDevolucion(
  envio: { id: number; fechaImpresion: Date | null; finanzas?: FinanzasEnvio | null },
  eventos: EventoTracking[]
): AnatomiaDevolucion {
  return {
    envioId: envio.id,
    motivo: obtenerMotivoUltimaFalla(eventos),
    diasInmovilizacion: calcularDiasInmovilizacion(envio, eventos),
    visitasPrevias: contarVisitas(eventos),
    touchpoints: contarTouchpoints(eventos),
    precioFactura: extraerCosto(envio).precioFactura,
    puntoPerdida: identificarPuntoPerdida(eventos),
  };
}

// ====================================================
// AGREGADOR DE DEVOLUCIONES
// ====================================================

export interface ResumenDevoluciones {
  cantidadTotal: number;
  costoTotalFacturado: number;            // suma de precioFactura no-null
  cantidadSinCosto: number;               // cuantos envios no tienen precio
  diasInmovilizacionPromedio: number | null;
  diasInmovilizacionTotal: number;        // suma para visualizar magnitud
  touchpointsPromedio: number;
  touchpointsTotal: number;
  distribucionVisitas: {
    cero: number;
    una: number;
    dos: number;
    tresOmas: number;
  };
  distribucionPuntosPerdida: {
    EN_DISTRIBUCION: number;
    VISITA_FALLIDA: number;
    INCIDENCIA: number;
    otro: number;
  };
}

/**
 * Agrega anatomias de devoluciones en un resumen global.
 */
export function resumirDevoluciones(
  anatomias: AnatomiaDevolucion[]
): ResumenDevoluciones {
  const total = anatomias.length;

  let costoTotal = 0;
  let sinCosto = 0;
  let diasTotal = 0;
  let diasCount = 0;
  let touchpointsTotal = 0;

  const distVisitas = { cero: 0, una: 0, dos: 0, tresOmas: 0 };
  const distPuntos = { EN_DISTRIBUCION: 0, VISITA_FALLIDA: 0, INCIDENCIA: 0, otro: 0 };

  for (const a of anatomias) {
    // Costo.
    if (a.precioFactura != null) {
      costoTotal += a.precioFactura;
    } else {
      sinCosto++;
    }

    // Dias.
    if (a.diasInmovilizacion != null) {
      diasTotal += a.diasInmovilizacion;
      diasCount++;
    }

    // Touchpoints.
    touchpointsTotal += a.touchpoints;

    // Distribucion visitas.
    if (a.visitasPrevias === 0) distVisitas.cero++;
    else if (a.visitasPrevias === 1) distVisitas.una++;
    else if (a.visitasPrevias === 2) distVisitas.dos++;
    else distVisitas.tresOmas++;

    // Distribucion puntos de perdida.
    if (a.puntoPerdida === "EN_DISTRIBUCION") distPuntos.EN_DISTRIBUCION++;
    else if (a.puntoPerdida === "VISITA_FALLIDA") distPuntos.VISITA_FALLIDA++;
    else if (a.puntoPerdida === "INCIDENCIA") distPuntos.INCIDENCIA++;
    else distPuntos.otro++;
  }

  return {
    cantidadTotal: total,
    costoTotalFacturado: Math.round(costoTotal * 100) / 100,
    cantidadSinCosto: sinCosto,
    diasInmovilizacionPromedio: diasCount > 0 ? Math.round(diasTotal / diasCount) : null,
    diasInmovilizacionTotal: diasTotal,
    touchpointsPromedio: total > 0 ? Math.round(touchpointsTotal / total) : 0,
    touchpointsTotal,
    distribucionVisitas: distVisitas,
    distribucionPuntosPerdida: distPuntos,
  };
}
