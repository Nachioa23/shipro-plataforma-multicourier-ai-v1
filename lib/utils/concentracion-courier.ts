// ============================================================================
// HELPER — Concentracion Courier / Riesgo Courier (Analitica)
//
// Phase 2.5.b (Panel cliente migration, 2026-06-15).
// Helper creado desde cero. Centraliza la logica analitica del endpoint
// /api/torre-de-control/concentracion-courier (antes inline 201 lineas).
//
// SEMANTICA: orquestador scope-aware unico calcularConcentracionCourierAnalitica.
// Mide el "riesgo de proveedor unico" — cuanto del volumen se concentra en
// el courier lider. Si el lider sobrepasa THRESHOLD_SPOF (60%) el cliente
// queda expuesto a interrupcion de servicio si ese courier falla.
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.envio por ctx.empresaId.
//   Retorna shape "cliente" con resumen.vista = "empresa".
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): sin filtro
//   de empresa. Retorna shape "shipro" con resumen.vista = "global" +
//   porEmpresa adicional (concentracion por cliente — view distinta a
//   shareByCourier, util para Shipro power-user).
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): filtra a esa
//   empresa. Retorna shape "shipro" con resumen.vista = "empresa", sin
//   porEmpresa (1-entry o vacio).
//
// Decisiones de producto (director 2026-06-15):
// D1 - Nombre: calcularConcentracionCourierAnalitica (sufijo Analitica
//      consistente con Phases 2.1-2.4).
// D2 - Endpoint acepta dual-param ?filtroEmpresa (standard) Y ?empresaId
//      (legacy alias) — ver Phase 2.5.c. Helper queda 100% standard.
// D3 - porEmpresa extendido en shape Shipro con hhiCliente + topShareCliente
//      (concentracion intra-cliente). Da insight cross-cliente para Shipro
//      (que cliente tiene mas riesgo de SPOF).
// D4 - resumen.vista discriminator preservado ("global" | "empresa") —
//      Torre dashboard L2280 lo consume condicionalmente.
// D5 - Shape EXACTO del endpoint actual preservado. Torre consume any[]
//      asi que tsc no detecta renames — peligro regresion silenciosa.
// D6 - calidadDatos.vista duplicate de resumen.vista preservado.
// D7 - calcularHHI + nivelHHI utilities INTERNAS (no exportadas).
//
// DEUDA Phase 4 cleanup: el endpoint /api/torre-de-control/concentracion-courier
// acepta dual-param ?filtroEmpresa (standard) Y ?empresaId (legacy alias)
// para no romper Torre dashboard que sigue usando ?empresaId=. Cuando Torre
// dashboard migre a ?filtroEmpresa=, retirar la compat del endpoint route.ts.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT = 90;
const THRESHOLD_SPOF = 60;
const UMBRAL_HHI_MODERADO = 1500;
const UMBRAL_HHI_ALTO = 2500;

function calcularHHI(porcentajes: number[]): number {
  return Math.round(porcentajes.reduce((sum, p) => sum + p * p, 0));
}

function nivelHHI(hhi: number): "bajo" | "moderado" | "alto" {
  if (hhi < UMBRAL_HHI_MODERADO) return "bajo";
  if (hhi < UMBRAL_HHI_ALTO) return "moderado";
  return "alto";
}

export interface ShareCourier {
  courierId: number;
  nombre: string;
  cantidad: number;
  porcentaje: number;
  esLider: boolean;
}

export interface DistribucionCourierMes {
  courierId: number;
  nombre: string;
  cantidad: number;
  porcentaje: number;
}

export interface MesConcentracion {
  mes: string;
  distribuciones: DistribucionCourierMes[];
}

export interface ResumenConcentracion {
  vista: "global" | "empresa";
  empresaId: number | null;
  empresaNombre: string | null;
  totalEnvios: number;
  cantidadCouriers: number;
  topShare: number;
  esRiesgoAlto: boolean;
  thresholdSPOF: number;
  hhi: number;
  nivelConcentracion: "bajo" | "moderado" | "alto";
}

export interface GrupoEmpresaConcentracion {
  empresaId: number;
  empresaNombre: string;
  cantidad: number;
  porcentaje: number;
  hhiCliente: number;
  topShareCliente: number;
}

export interface CalidadDatosConcentracion {
  ventanaDias: number;
  vista: "global" | "empresa";
}

export interface ResultadoConcentracionBase {
  resumen: ResumenConcentracion;
  shareByCourier: ShareCourier[];
  porMes: MesConcentracion[];
  calidadDatos: CalidadDatosConcentracion;
}

export interface ResultadoConcentracionCliente extends ResultadoConcentracionBase {
  scope: "cliente";
}

export interface ResultadoConcentracionShipro extends ResultadoConcentracionBase {
  porEmpresa: GrupoEmpresaConcentracion[];
  scope: "shipro";
}

export type ResultadoConcentracionCourier = ResultadoConcentracionCliente | ResultadoConcentracionShipro;

export async function calcularConcentracionCourierAnalitica(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<ResultadoConcentracionCourier> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Determinar vista y empresaId efectivo.
  let vista: "global" | "empresa";
  let empresaIdEfectivo: number | null;
  if (!ctx.modoDios) {
    vista = "empresa";
    empresaIdEfectivo = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    vista = "empresa";
    empresaIdEfectivo = ctx.empresaId;
  } else {
    vista = "global";
    empresaIdEfectivo = null;
  }

  // Lookup empresa nombre si vista === "empresa".
  let empresaNombre: string | null = null;
  if (empresaIdEfectivo !== null) {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaIdEfectivo },
      select: { nombre: true },
    });
    empresaNombre = empresa?.nombre ?? null;
  }

  // Build where clause scope-aware.
  const whereClause: any = {
    fechaImpresion: { gte: ventanaInicio },
  };
  if (empresaIdEfectivo !== null) {
    whereClause.empresaId = empresaIdEfectivo;
  }

  // Include: courier siempre + empresa siempre (no condicional para preservar
  // type inference Prisma — el join extra para queries cliente es inocuo).
  // porEmpresa accumulator filtra en runtime via ctx.modoDios + ctx.empresaId === null.
  const envios = await prisma.envio.findMany({
    where: whereClause,
    include: {
      courier: { select: { id: true, nombre: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  const totalEnvios = envios.length;

  // shareByCourier — agrupar por courier.
  type CourierAccum = { courierId: number; nombre: string; cantidad: number };
  const courierMap = new Map<number, CourierAccum>();
  for (const e of envios) {
    if (e.courier) {
      const cid = e.courier.id;
      if (!courierMap.has(cid)) {
        courierMap.set(cid, {
          courierId: cid,
          nombre: e.courier.nombre,
          cantidad: 0,
        });
      }
      courierMap.get(cid)!.cantidad++;
    }
  }

  const shareByCourier: ShareCourier[] = Array.from(courierMap.values())
    .map(c => ({
      courierId: c.courierId,
      nombre: c.nombre,
      cantidad: c.cantidad,
      porcentaje: totalEnvios > 0
        ? Math.round((c.cantidad / totalEnvios) * 1000) / 10
        : 0,
      esLider: false,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  if (shareByCourier.length > 0) {
    shareByCourier[0].esLider = true;
  }

  // Resumen.
  const topShare = shareByCourier.length > 0 ? shareByCourier[0].porcentaje : 0;
  const porcentajes = shareByCourier.map(s => s.porcentaje);
  const hhi = calcularHHI(porcentajes);

  const resumen: ResumenConcentracion = {
    vista,
    empresaId: empresaIdEfectivo,
    empresaNombre,
    totalEnvios,
    cantidadCouriers: shareByCourier.length,
    topShare,
    esRiesgoAlto: topShare >= THRESHOLD_SPOF,
    thresholdSPOF: THRESHOLD_SPOF,
    hhi,
    nivelConcentracion: nivelHHI(hhi),
  };

  // porMes — agrupar por YYYY-MM, luego por courier dentro de cada mes.
  type MesCourierAccum = { courierId: number; nombre: string; cantidad: number };
  const mesMap = new Map<string, Map<number, MesCourierAccum>>();
  for (const e of envios) {
    if (!e.fechaImpresion || !e.courier) continue;
    const mesKey = `${e.fechaImpresion.getFullYear()}-${String(e.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;
    if (!mesMap.has(mesKey)) mesMap.set(mesKey, new Map());
    const mesInner = mesMap.get(mesKey)!;
    const cid = e.courier.id;
    if (!mesInner.has(cid)) {
      mesInner.set(cid, {
        courierId: cid,
        nombre: e.courier.nombre,
        cantidad: 0,
      });
    }
    mesInner.get(cid)!.cantidad++;
  }

  const porMes: MesConcentracion[] = Array.from(mesMap.entries())
    .map(([mes, inner]) => {
      const items = Array.from(inner.values());
      const totalMes = items.reduce((s, i) => s + i.cantidad, 0);
      const distribuciones: DistribucionCourierMes[] = items
        .map(i => ({
          courierId: i.courierId,
          nombre: i.nombre,
          cantidad: i.cantidad,
          porcentaje: totalMes > 0
            ? Math.round((i.cantidad / totalMes) * 1000) / 10
            : 0,
        }))
        .sort((a, b) => b.cantidad - a.cantidad);
      return { mes, distribuciones };
    })
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const calidadDatos: CalidadDatosConcentracion = {
    ventanaDias,
    vista,
  };

  const base: ResultadoConcentracionBase = {
    resumen,
    shareByCourier,
    porMes,
    calidadDatos,
  };

  if (!ctx.modoDios) {
    return { ...base, scope: "cliente" };
  }

  // porEmpresa — solo Shipro global.
  // Para cada empresa: contar envios + calcular HHI/topShare intra-empresa.
  type EmpresaAccum = {
    empresaId: number;
    empresaNombre: string;
    cantidadTotal: number;
    courierCounts: Map<number, number>;
  };
  const empresaMap = new Map<number, EmpresaAccum>();
  if (ctx.empresaId === null) {
    for (const e of envios) {
      const emp = e.empresa;
      if (!emp || !e.courier) continue;
      const eid = emp.id;
      if (!empresaMap.has(eid)) {
        empresaMap.set(eid, {
          empresaId: eid,
          empresaNombre: emp.nombre,
          cantidadTotal: 0,
          courierCounts: new Map(),
        });
      }
      const emAccum = empresaMap.get(eid)!;
      emAccum.cantidadTotal++;
      emAccum.courierCounts.set(
        e.courier.id,
        (emAccum.courierCounts.get(e.courier.id) ?? 0) + 1
      );
    }
  }

  const porEmpresa: GrupoEmpresaConcentracion[] = Array.from(empresaMap.values())
    .map(e => {
      const courierShares = Array.from(e.courierCounts.values()).map(c =>
        e.cantidadTotal > 0
          ? Math.round((c / e.cantidadTotal) * 1000) / 10
          : 0
      );
      const sortedShares = [...courierShares].sort((a, b) => b - a);
      const topShareCliente = sortedShares.length > 0 ? sortedShares[0] : 0;
      const hhiCliente = calcularHHI(courierShares);
      return {
        empresaId: e.empresaId,
        empresaNombre: e.empresaNombre,
        cantidad: e.cantidadTotal,
        porcentaje: totalEnvios > 0
          ? Math.round((e.cantidadTotal / totalEnvios) * 1000) / 10
          : 0,
        hhiCliente,
        topShareCliente,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);

  return { ...base, porEmpresa, scope: "shipro" };
}
