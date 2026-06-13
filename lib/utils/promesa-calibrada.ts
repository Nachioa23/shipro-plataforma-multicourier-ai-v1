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

// ============================================================================
// ORQUESTACION SCOPE-AWARE — calcularPromesaAnalitica(ctx)
//
// Phase 1.5.b (Panel cliente migration, 2026-06-13).
// Extrae al helper la logica de orquestacion que estaba inline en el
// endpoint /api/torre-de-control/promesa-calibrada.
//
// SEMANTICA: analitica retroactiva. Diferente a calcularPromesaCalibrada()
// que esta arriba — esa es para el cotizador real-time al checkout con
// cuadruple fallback (Nivel 1-4). calcularPromesaAnalitica retorna el
// resumen global + combinaciones sobre envios YA entregados en la ventana,
// para mostrar en Torre y Panel cliente.
//
// SCOPE-AWARE: auto-detecta scope desde AuthContext:
// - Cliente (modoDios=false): filtra por ctx.empresaId, omite porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): shape completo
//   con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): shape "shipro".
//
// Decisiones de producto (director 2026-06-13):
// D1 - Nombre: calcularPromesaAnalitica (claro vs calcularPromesaCalibrada cotizador).
// D2 - porEmpresa solo en shape Shipro.
// D3 - Discriminated union scope cliente/shipro.
// D4 - Panel cliente shape = identico al Torre (4-tile + tabla con columna Confiable).
// D5 - Slot Card 10 reservado en Panel.
// D6 - No romper helper existente.
// ============================================================================

import type { AuthContext } from "@/lib/auth-context";
import { calcularEstadisticos } from "./percentiles";

function horasADiasCorridos(horas: number): number {
  return Math.ceil(horas / 24);
}

export interface CombinacionPromesa {
  depositoId: number;
  depositoNombre: string;
  courierId: number;
  courierNombre: string;
  provinciaDestino: string;
  p50Horas: number;
  p75Horas: number;
  p90Horas: number;
  promedioHoras: number;
  p50Dias: number;
  p75Dias: number;
  p90Dias: number;
  promedioDias: number;
  cantidad: number;
  muestraConfiable: boolean;
  promesaCalibradaDias: number;
  promesaCalibradaHoras: number;
  tasaCumplimiento: number | null;
  cantidadConPromesa: number;
}

export interface EstadisticosPromesaGlobales {
  p50Horas: number;
  p75Horas: number | null;
  p95Horas: number;
  promedioHoras: number;
  p50Dias: number;
  p75Dias: number | null;
  p95Dias: number;
  promedioDias: number;
  cantidad: number;
}

export interface GrupoEmpresaPromesa {
  empresaId: number;
  empresaNombre: string;
  cantidad: number;
  p50Dias: number;
  p75Dias: number | null;
  tasaCumplimiento: number | null;
}

export interface ResultadoPromesaCliente {
  ventanaDias: number;
  estadisticosGlobales: EstadisticosPromesaGlobales | null;
  tasaCumplimientoGlobal: number | null;
  cantidadEnviosConPromesa: number;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosSinDatos: number;
  umbralMuestraMinima: number;
  combinaciones: CombinacionPromesa[];
  scope: "cliente";
}

export interface ResultadoPromesaShipro {
  ventanaDias: number;
  estadisticosGlobales: EstadisticosPromesaGlobales | null;
  tasaCumplimientoGlobal: number | null;
  cantidadEnviosConPromesa: number;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosSinDatos: number;
  umbralMuestraMinima: number;
  combinaciones: CombinacionPromesa[];
  porEmpresa: GrupoEmpresaPromesa[];
  scope: "shipro";
}

export type ResultadoPromesa = ResultadoPromesaCliente | ResultadoPromesaShipro;

export async function calcularPromesaAnalitica(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<ResultadoPromesa> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause scope-aware.
  const whereClause: any = {
    fechaImpresion: { gte: ventanaInicio },
    fechaEntrega: { not: null },
    destinoId: { not: null },
  };
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  const envios = await prisma.envio.findMany({
    where: whereClause,
    select: {
      id: true,
      fechaImpresion: true,
      fechaEntrega: true,
      diasPrometidosCheckout: true,
      depositoId: true,
      courierId: true,
      empresaId: true,
      deposito: { select: { id: true, nombre: true } },
      courier: { select: { id: true, nombre: true } },
      destino: { select: { provincia: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  const cantidadEnviosTotal = envios.length;

  // Filter envios validos.
  const enviosValidos = envios.filter(e =>
    e.fechaEntrega !== null && e.fechaImpresion !== null &&
    e.depositoId !== null && e.courierId !== null &&
    e.destino !== null && e.destino.provincia !== null &&
    e.deposito !== null && e.courier !== null
  );
  const cantidadEnviosValidos = enviosValidos.length;
  const cantidadEnviosSinDatos = cantidadEnviosTotal - cantidadEnviosValidos;

  // Compute delta horas + accumulate.
  type ComboAccum = {
    depositoId: number;
    depositoNombre: string;
    courierId: number;
    courierNombre: string;
    provinciaDestino: string;
    horas: number[];
    cumplimientosPromesa: { real: number; prometida: number }[];
  };
  const combinacionesMap = new Map<string, ComboAccum>();

  type EmpresaAccum = {
    empresaId: number;
    empresaNombre: string;
    horas: number[];
    cumplimientosPromesa: { real: number; prometida: number }[];
  };
  const empresaMap = new Map<number, EmpresaAccum>();

  const todasLasHoras: number[] = [];
  let cantidadEnviosConPromesa = 0;
  let cumplidosGlobales = 0;

  for (const e of enviosValidos) {
    const provNorm = normalizarProvincia(e.destino!.provincia);
    if (!provNorm) continue;

    const horasDelta = (e.fechaEntrega!.getTime() - e.fechaImpresion!.getTime()) / 3600000;
    todasLasHoras.push(horasDelta);

    const clave = `${e.depositoId}|${e.courierId}|${provNorm}`;
    if (!combinacionesMap.has(clave)) {
      combinacionesMap.set(clave, {
        depositoId: e.depositoId!,
        depositoNombre: e.deposito!.nombre,
        courierId: e.courierId!,
        courierNombre: e.courier!.nombre,
        provinciaDestino: provNorm,
        horas: [],
        cumplimientosPromesa: [],
      });
    }
    const combo = combinacionesMap.get(clave)!;
    combo.horas.push(horasDelta);

    if (e.diasPrometidosCheckout != null) {
      const diasReales = horasADiasCorridos(horasDelta);
      combo.cumplimientosPromesa.push({
        real: diasReales,
        prometida: e.diasPrometidosCheckout,
      });
      cantidadEnviosConPromesa++;
      if (diasReales <= e.diasPrometidosCheckout) cumplidosGlobales++;
    }

    // Per-empresa accum (solo modoDios global).
    if (ctx.modoDios && ctx.empresaId === null && e.empresa) {
      const eid = e.empresa.id;
      if (!empresaMap.has(eid)) {
        empresaMap.set(eid, {
          empresaId: eid,
          empresaNombre: e.empresa.nombre,
          horas: [],
          cumplimientosPromesa: [],
        });
      }
      const emp = empresaMap.get(eid)!;
      emp.horas.push(horasDelta);
      if (e.diasPrometidosCheckout != null) {
        emp.cumplimientosPromesa.push({
          real: horasADiasCorridos(horasDelta),
          prometida: e.diasPrometidosCheckout,
        });
      }
    }
  }

  // Compute estadisticosGlobales.
  let estadisticosGlobales: EstadisticosPromesaGlobales | null = null;
  if (todasLasHoras.length > 0) {
    const stats = calcularEstadisticos(todasLasHoras);
    if (stats) {
      const p75H = calcularP75(todasLasHoras);
      estadisticosGlobales = {
        p50Horas: Math.round(stats.p50),
        p75Horas: p75H !== null ? Math.round(p75H) : null,
        p95Horas: Math.round(stats.p95),
        promedioHoras: Math.round(stats.promedio),
        p50Dias: horasADiasCorridos(stats.p50),
        p75Dias: p75H !== null ? horasADiasCorridos(p75H) : null,
        p95Dias: horasADiasCorridos(stats.p95),
        promedioDias: horasADiasCorridos(stats.promedio),
        cantidad: stats.cantidad,
      };
    }
  }

  // tasaCumplimientoGlobal.
  const tasaCumplimientoGlobal = cantidadEnviosConPromesa > 0
    ? cumplidosGlobales / cantidadEnviosConPromesa
    : null;

  // Build combinaciones output.
  const combinaciones: CombinacionPromesa[] = Array.from(combinacionesMap.values())
    .map(c => {
      const stats = calcularEstadisticos(c.horas);
      const p75H = calcularP75(c.horas);
      const ordenados = [...c.horas].sort((a, b) => a - b);
      const idx90 = Math.floor(ordenados.length * 0.90);
      const p90H = ordenados[Math.min(idx90, ordenados.length - 1)];

      const promesaH = p75H !== null ? Math.round(p75H) : Math.round(stats?.p50 ?? 0);
      const promesaD = p75H !== null ? horasADiasCorridos(p75H) : horasADiasCorridos(stats?.p50 ?? 0);

      let tasaCumplimiento: number | null = null;
      if (c.cumplimientosPromesa.length > 0) {
        const cumplidos = c.cumplimientosPromesa.filter(cp => cp.real <= cp.prometida).length;
        tasaCumplimiento = cumplidos / c.cumplimientosPromesa.length;
      }

      return {
        depositoId: c.depositoId,
        depositoNombre: c.depositoNombre,
        courierId: c.courierId,
        courierNombre: c.courierNombre,
        provinciaDestino: c.provinciaDestino,
        p50Horas: Math.round(stats?.p50 ?? 0),
        p75Horas: p75H !== null ? Math.round(p75H) : 0,
        p90Horas: Math.round(p90H),
        promedioHoras: Math.round(stats?.promedio ?? 0),
        p50Dias: horasADiasCorridos(stats?.p50 ?? 0),
        p75Dias: p75H !== null ? horasADiasCorridos(p75H) : 0,
        p90Dias: horasADiasCorridos(p90H),
        promedioDias: horasADiasCorridos(stats?.promedio ?? 0),
        cantidad: c.horas.length,
        muestraConfiable: c.horas.length >= UMBRAL_MUESTRA_MINIMA,
        promesaCalibradaDias: promesaD,
        promesaCalibradaHoras: promesaH,
        tasaCumplimiento,
        cantidadConPromesa: c.cumplimientosPromesa.length,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);

  if (!ctx.modoDios) {
    return {
      ventanaDias,
      estadisticosGlobales,
      tasaCumplimientoGlobal,
      cantidadEnviosConPromesa,
      cantidadEnviosTotal,
      cantidadEnviosValidos,
      cantidadEnviosSinDatos,
      umbralMuestraMinima: UMBRAL_MUESTRA_MINIMA,
      combinaciones,
      scope: "cliente",
    };
  }

  // Shipro: include porEmpresa.
  const porEmpresa: GrupoEmpresaPromesa[] = Array.from(empresaMap.values())
    .map(e => {
      const stats = calcularEstadisticos(e.horas);
      const p75H = calcularP75(e.horas);
      let tasaCumplimiento: number | null = null;
      if (e.cumplimientosPromesa.length > 0) {
        const cumplidos = e.cumplimientosPromesa.filter(cp => cp.real <= cp.prometida).length;
        tasaCumplimiento = cumplidos / e.cumplimientosPromesa.length;
      }
      return {
        empresaId: e.empresaId,
        empresaNombre: e.empresaNombre,
        cantidad: e.horas.length,
        p50Dias: horasADiasCorridos(stats?.p50 ?? 0),
        p75Dias: p75H !== null ? horasADiasCorridos(p75H) : null,
        tasaCumplimiento,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    ventanaDias,
    estadisticosGlobales,
    tasaCumplimientoGlobal,
    cantidadEnviosConPromesa,
    cantidadEnviosTotal,
    cantidadEnviosValidos,
    cantidadEnviosSinDatos,
    umbralMuestraMinima: UMBRAL_MUESTRA_MINIMA,
    combinaciones,
    porEmpresa,
    scope: "shipro",
  };
}
