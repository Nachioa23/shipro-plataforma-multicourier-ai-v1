// ============================================================================
// HELPER — Auditoria de Desvio Financiero por Peso Volumetrico (Metrica 3.4)
//
// El courier en su liquidacion mensual factura segun el peso real medido
// (pesoAforado), que puede ser distinto al peso declarado al cotizar
// (pesoCobrado). Cuando pesoAforado > pesoCobrado, el courier cobra mas
// que lo cotizado, generando fuga financiera para el cliente Shipro.
//
// Fuente de data: FinanzasEnvio (pesoCobrado, pesoAforado, precioMostrado,
// precioFactura). pesoAforado se popula via /api/conciliacion al subir el
// Excel mensual del courier.
//
// Decisiones:
// - La fuga monetaria = precioFactura - precioMostrado (heredado del legacy
//   /api/metricas). Refleja el margen que come el e-commerce.
// - Severidad por diferencia de kg: leve <=1, moderado 1-3, grave >3.
// - Solo se cuentan envios con pesoAforado > 0 (aforo procesado).
//
// NIVEL 1 (V1): comparacion pesoCobrado vs pesoAforado del courier.
// NIVEL 2 (DEUDA 57 potencial): recomputar pesoVolumetrico desde dimensiones
//   del paquete (no persistidas hoy) para detectar abusos del courier.
// ============================================================================

export const SEVERIDAD_LEVE_KG = 1;
export const SEVERIDAD_GRAVE_KG = 3;

export type SeveridadDesvio = "LEVE" | "MODERADO" | "GRAVE";

export function clasificarSeveridad(diffKg: number): SeveridadDesvio {
  if (diffKg <= SEVERIDAD_LEVE_KG) return "LEVE";
  if (diffKg <= SEVERIDAD_GRAVE_KG) return "MODERADO";
  return "GRAVE";
}

export interface EnvioParaAuditar {
  pesoCobrado: number | null;
  pesoAforado: number | null;
  precioMostrado: number | null;
  precioFactura: number | null;
}

export interface AuditoriaDesvio {
  tieneAforo: boolean;
  tieneDesvio: boolean;
  pesoCobrado: number;
  pesoAforado: number;
  diffKg: number;
  fugaPesos: number;
  severidad: SeveridadDesvio | null;
}

export function auditarDesvio(envio: EnvioParaAuditar): AuditoriaDesvio {
  const pesoCobrado = envio.pesoCobrado || 0;
  const pesoAforado = envio.pesoAforado || 0;
  const tieneAforo = pesoAforado > 0;

  if (!tieneAforo) {
    return {
      tieneAforo: false,
      tieneDesvio: false,
      pesoCobrado,
      pesoAforado: 0,
      diffKg: 0,
      fugaPesos: 0,
      severidad: null,
    };
  }

  const diffKg = pesoAforado - pesoCobrado;
  const tieneDesvio = diffKg > 0;

  if (!tieneDesvio) {
    return {
      tieneAforo: true,
      tieneDesvio: false,
      pesoCobrado,
      pesoAforado,
      diffKg: 0,
      fugaPesos: 0,
      severidad: null,
    };
  }

  // Fuga monetaria = precioFactura - precioMostrado (heredado del legacy).
  // Si negativa o cero, no se computa.
  const precioFactura = envio.precioFactura || 0;
  const precioMostrado = envio.precioMostrado || 0;
  const fugaPesos = Math.max(0, precioFactura - precioMostrado);

  return {
    tieneAforo: true,
    tieneDesvio: true,
    pesoCobrado,
    pesoAforado,
    diffKg: Math.round(diffKg * 100) / 100,
    fugaPesos: Math.round(fugaPesos * 100) / 100,
    severidad: clasificarSeveridad(diffKg),
  };
}

export interface ResumenDesvio {
  totalEnvios: number;
  enviosConAforo: number;
  enviosConDesvio: number;
  // Tasa "legacy": envios con desvio / total envios.
  tasaSobreTotal: number;
  // Tasa "pura": envios con desvio / envios con aforo procesado.
  tasaSobreAforados: number;
  fugaTotal: number;
  fugaPromedio: number;
  fugaMax: number;
  desvioPromedioKg: number;
  desvioMaxKg: number;
  ahorroProyectadoAnual: number;
  distribucionSeveridad: {
    leve: number;
    moderado: number;
    grave: number;
  };
  distribucionSeveridadPct: {
    leve: number;
    moderado: number;
    grave: number;
  };
}

const VENTANA_DIAS = 90;

export function resumirAuditorias(
  auditorias: AuditoriaDesvio[],
  totalEnvios: number
): ResumenDesvio {
  const conAforo = auditorias.filter(a => a.tieneAforo);
  const conDesvio = auditorias.filter(a => a.tieneDesvio);

  const fugaTotal = conDesvio.reduce((sum, a) => sum + a.fugaPesos, 0);
  const fugaPromedio = conDesvio.length > 0 ? fugaTotal / conDesvio.length : 0;
  const fugaMax = conDesvio.length > 0
    ? Math.max(...conDesvio.map(a => a.fugaPesos))
    : 0;

  const desvioPromedioKg = conDesvio.length > 0
    ? conDesvio.reduce((sum, a) => sum + a.diffKg, 0) / conDesvio.length
    : 0;
  const desvioMaxKg = conDesvio.length > 0
    ? Math.max(...conDesvio.map(a => a.diffKg))
    : 0;

  const leve = conDesvio.filter(a => a.severidad === "LEVE").length;
  const moderado = conDesvio.filter(a => a.severidad === "MODERADO").length;
  const grave = conDesvio.filter(a => a.severidad === "GRAVE").length;

  return {
    totalEnvios,
    enviosConAforo: conAforo.length,
    enviosConDesvio: conDesvio.length,
    tasaSobreTotal: totalEnvios > 0
      ? Math.round((conDesvio.length / totalEnvios) * 1000) / 10
      : 0,
    tasaSobreAforados: conAforo.length > 0
      ? Math.round((conDesvio.length / conAforo.length) * 1000) / 10
      : 0,
    fugaTotal: Math.round(fugaTotal * 100) / 100,
    fugaPromedio: Math.round(fugaPromedio * 100) / 100,
    fugaMax: Math.round(fugaMax * 100) / 100,
    desvioPromedioKg: Math.round(desvioPromedioKg * 100) / 100,
    desvioMaxKg: Math.round(desvioMaxKg * 100) / 100,
    ahorroProyectadoAnual: Math.round(fugaTotal * (365 / VENTANA_DIAS) * 100) / 100,
    distribucionSeveridad: { leve, moderado, grave },
    distribucionSeveridadPct: {
      leve: conDesvio.length > 0 ? Math.round((leve / conDesvio.length) * 1000) / 10 : 0,
      moderado: conDesvio.length > 0 ? Math.round((moderado / conDesvio.length) * 1000) / 10 : 0,
      grave: conDesvio.length > 0 ? Math.round((grave / conDesvio.length) * 1000) / 10 : 0,
    },
  };
}
