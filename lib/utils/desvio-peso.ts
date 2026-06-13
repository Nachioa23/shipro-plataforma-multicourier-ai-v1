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

// ============================================================================
// ORQUESTACION SCOPE-AWARE — calcularDesvioPeso(ctx)
//
// Phase 1.2.b (Panel cliente migration, 2026-06-13).
// Extrae al helper la logica de orquestacion que estaba inline en el
// endpoint /api/torre-de-control/desvio-peso (preserva semantica exacta).
//
// Patron: igual a calcularFugaRuteo en lib/utils/fuga-ruteo.ts.
// Auto-detecta scope desde AuthContext:
//
// - Cliente (modoDios=false): filtra por ctx.empresaId, retorna shape
//   "cliente" sin porEmpresa.
// - Shipro Torre (modoDios=true, sin filtroEmpresa): scope global,
//   retorna shape "shipro" completo.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): empresa
//   especifica, retorna shape "shipro" sin porEmpresa (1-entry).
//
// Reusa auditarDesvio + resumirAuditorias del bloque anterior — NO
// recomputa fuga ni desvios. La fuente unica de verdad es auditoria.X.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT_ORQUESTACION = 90;

export interface GrupoCourier {
  courierId: number;
  nombre: string;
  enviosTotal: number;
  enviosConAforo: number;
  enviosConDesvio: number;
  porcentajeDesvio: number;
  fugaTotal: number;
  desvioPromedioKg: number;
}

export interface GrupoEmpresa {
  empresaId: number;
  empresaNombre: string;
  enviosTotal: number;
  enviosConDesvio: number;
  fugaTotal: number;
  desvioPromedioKg: number;
}

export interface GrupoMes {
  mes: string;
  enviosConDesvio: number;
  fugaTotal: number;
}

export interface EnvioTopDesvio {
  envioId: number;
  fechaImpresion: Date;
  empresaNombre: string;
  courierNombre: string;
  pesoCobrado: number;
  pesoAforado: number;
  diffKg: number;
  severidad: SeveridadDesvio | null;
  fugaPesos: number;
}

export interface CalidadDatosDesvio {
  ventanaDias: number;
  fuente: string;
  nivelImplementado: string;
  nivelPendiente: string;
}

export interface ResultadoDesvioPesoCliente {
  resumen: ResumenDesvio;
  porCourier: GrupoCourier[];
  porMes: GrupoMes[];
  topEnvios: EnvioTopDesvio[];
  calidadDatos: CalidadDatosDesvio;
  scope: "cliente";
}

export interface ResultadoDesvioPesoShipro {
  resumen: ResumenDesvio;
  porCourier: GrupoCourier[];
  porEmpresa: GrupoEmpresa[];
  porMes: GrupoMes[];
  topEnvios: EnvioTopDesvio[];
  calidadDatos: CalidadDatosDesvio;
  scope: "shipro";
}

export type ResultadoDesvioPeso = ResultadoDesvioPesoCliente | ResultadoDesvioPesoShipro;

export async function calcularDesvioPeso(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT_ORQUESTACION
): Promise<ResultadoDesvioPeso> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause scope-aware.
  const whereClause: any = {
    fechaImpresion: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  const envios = await prisma.envio.findMany({
    where: whereClause,
    include: {
      finanzas: true,
      courier: { select: { id: true, nombre: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  const totalEnvios = envios.length;

  // Audit per envio + keep pairing.
  const auditados = envios
    .filter(e => e.finanzas !== null)
    .map(e => ({
      envio: e,
      auditoria: auditarDesvio({
        pesoCobrado: e.finanzas!.pesoCobrado,
        pesoAforado: e.finanzas!.pesoAforado,
        precioMostrado: e.finanzas!.precioMostrado,
        precioFactura: e.finanzas!.precioFactura,
      }),
    }));

  const auditorias = auditados.map(a => a.auditoria);
  const resumen = resumirAuditorias(auditorias, totalEnvios);

  // Group by courier (uses auditoria values - no recompute).
  const courierMap = new Map<number, {
    courierId: number;
    nombre: string;
    enviosTotal: number;
    enviosConAforo: number;
    enviosConDesvio: number;
    sumaFuga: number;
    sumaDesvioKg: number;
  }>();

  for (const a of auditados) {
    const cid = a.envio.courier.id;
    if (!courierMap.has(cid)) {
      courierMap.set(cid, {
        courierId: cid,
        nombre: a.envio.courier.nombre,
        enviosTotal: 0,
        enviosConAforo: 0,
        enviosConDesvio: 0,
        sumaFuga: 0,
        sumaDesvioKg: 0,
      });
    }
    const c = courierMap.get(cid)!;
    c.enviosTotal++;
    if (a.auditoria.tieneAforo) c.enviosConAforo++;
    if (a.auditoria.tieneDesvio) {
      c.enviosConDesvio++;
      c.sumaFuga += a.auditoria.fugaPesos;
      c.sumaDesvioKg += a.auditoria.diffKg;
    }
  }

  const porCourier: GrupoCourier[] = Array.from(courierMap.values())
    .map(c => ({
      courierId: c.courierId,
      nombre: c.nombre,
      enviosTotal: c.enviosTotal,
      enviosConAforo: c.enviosConAforo,
      enviosConDesvio: c.enviosConDesvio,
      porcentajeDesvio: c.enviosConAforo > 0
        ? Math.round((c.enviosConDesvio / c.enviosConAforo) * 1000) / 10
        : 0,
      fugaTotal: Math.round(c.sumaFuga),
      desvioPromedioKg: c.enviosConDesvio > 0
        ? Math.round((c.sumaDesvioKg / c.enviosConDesvio) * 10) / 10
        : 0,
    }))
    .sort((a, b) => b.porcentajeDesvio - a.porcentajeDesvio);

  // Group by month.
  const mesMap = new Map<string, { enviosConDesvio: number; sumaFuga: number }>();
  for (const a of auditados) {
    if (!a.auditoria.tieneDesvio) continue;
    const f = a.envio.fechaImpresion;
    const mes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
    if (!mesMap.has(mes)) mesMap.set(mes, { enviosConDesvio: 0, sumaFuga: 0 });
    const m = mesMap.get(mes)!;
    m.enviosConDesvio++;
    m.sumaFuga += a.auditoria.fugaPesos;
  }

  const porMes: GrupoMes[] = Array.from(mesMap.entries())
    .map(([mes, m]) => ({
      mes,
      enviosConDesvio: m.enviosConDesvio,
      fugaTotal: Math.round(m.sumaFuga),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // Top envios.
  const topEnvios: EnvioTopDesvio[] = auditados
    .filter(a => a.auditoria.tieneDesvio)
    .sort((a, b) => b.auditoria.fugaPesos - a.auditoria.fugaPesos)
    .slice(0, 20)
    .map(a => ({
      envioId: a.envio.id,
      fechaImpresion: a.envio.fechaImpresion,
      empresaNombre: a.envio.empresa.nombre,
      courierNombre: a.envio.courier.nombre,
      pesoCobrado: a.auditoria.pesoCobrado,
      pesoAforado: a.auditoria.pesoAforado,
      diffKg: a.auditoria.diffKg,
      severidad: a.auditoria.severidad,
      fugaPesos: a.auditoria.fugaPesos,
    }));

  const calidadDatos: CalidadDatosDesvio = {
    ventanaDias,
    fuente: "FinanzasEnvio.pesoAforado (poblado via /api/conciliacion al subir Excel mensual del courier)",
    nivelImplementado: "NIVEL 1 (pesoCobrado vs pesoAforado)",
    nivelPendiente: "NIVEL 2 (recomputo de pesoVolumetrico desde dimensiones) - DEUDA 57",
  };

  if (!ctx.modoDios) {
    return {
      resumen,
      porCourier,
      porMes,
      topEnvios,
      calidadDatos,
      scope: "cliente",
    };
  }

  // Shipro: include porEmpresa.
  const empresaMap = new Map<number, {
    empresaId: number;
    empresaNombre: string;
    enviosTotal: number;
    enviosConDesvio: number;
    sumaFuga: number;
    sumaDesvioKg: number;
  }>();

  for (const a of auditados) {
    const eid = a.envio.empresa.id;
    if (!empresaMap.has(eid)) {
      empresaMap.set(eid, {
        empresaId: eid,
        empresaNombre: a.envio.empresa.nombre,
        enviosTotal: 0,
        enviosConDesvio: 0,
        sumaFuga: 0,
        sumaDesvioKg: 0,
      });
    }
    const emp = empresaMap.get(eid)!;
    emp.enviosTotal++;
    if (a.auditoria.tieneDesvio) {
      emp.enviosConDesvio++;
      emp.sumaFuga += a.auditoria.fugaPesos;
      emp.sumaDesvioKg += a.auditoria.diffKg;
    }
  }

  const porEmpresa: GrupoEmpresa[] = Array.from(empresaMap.values())
    .map(e => ({
      empresaId: e.empresaId,
      empresaNombre: e.empresaNombre,
      enviosTotal: e.enviosTotal,
      enviosConDesvio: e.enviosConDesvio,
      fugaTotal: Math.round(e.sumaFuga),
      desvioPromedioKg: e.enviosConDesvio > 0
        ? Math.round((e.sumaDesvioKg / e.enviosConDesvio) * 10) / 10
        : 0,
    }))
    .sort((a, b) => b.fugaTotal - a.fugaTotal);

  return {
    resumen,
    porCourier,
    porEmpresa,
    porMes,
    topEnvios,
    calidadDatos,
    scope: "shipro",
  };
}
