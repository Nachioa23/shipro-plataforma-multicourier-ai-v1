// ============================================================================
// HELPER — Tiempos Colecta
//
// Mide cuanto tarda el courier entre la creacion de la etiqueta
// (fechaImpresion) y la efectiva recoleccion del paquete (fechaColecta).
//
// Helper creado en Phase 1.4 (Panel cliente migration, 2026-06-13).
// Extrae la orquestacion que estaba inline en el endpoint Torre
// /api/torre-de-control/tiempos-colecta.
//
// SCOPE-AWARE: auto-detecta scope desde AuthContext y retorna shape
// diferenciado:
//
// - Cliente (modoDios=false): filtra por ctx.empresaId, retorna shape
//   "cliente" con porDeposito/porCourier/porDiaSemana/porMes.
//   Omite porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): retorna
//   shape "shipro" completo con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): shape
//   "shipro" sin porEmpresa.
//
// Decisiones de producto (director 2026-06-13):
// D1 - Helper dedicado (archivo nuevo, no append a percentiles.ts).
// D2 - porEmpresa solo en shape Shipro.
// D3 - porMes en ambos shapes (trending).
// D4 - Panel cliente: P50 en Card; modal con 3-tile + porDeposito +
//      porCourier + porDiaSemana (sin porEmpresa).
// D5 - Discriminated union { scope: 'cliente' | 'shipro' }.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { calcularEstadisticos, type EstadisticosResult } from "./percentiles";

const VENTANA_DIAS_DEFAULT = 30;

const DIAS_SEMANA_NOMBRES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

export interface GrupoDeposito {
  depositoId: number;
  depositoNombre: string;
  medianaHoras: number;
  promedioHoras: number;
  p95Horas: number;
  cantidad: number;
}

export interface GrupoCourierColecta {
  courierId: number;
  courierNombre: string;
  medianaHoras: number;
  promedioHoras: number;
  p95Horas: number;
  cantidad: number;
}

export interface GrupoDiaSemana {
  diaSemana: number;
  diaSemanaNombre: string;
  medianaHoras: number;
  promedioHoras: number;
  p95Horas: number;
  cantidad: number;
}

export interface GrupoMesColecta {
  mes: string;
  medianaHoras: number;
  promedioHoras: number;
  p95Horas: number;
  cantidad: number;
}

export interface GrupoEmpresaColecta {
  empresaId: number;
  empresaNombre: string;
  medianaHoras: number;
  promedioHoras: number;
  p95Horas: number;
  cantidad: number;
}

export interface ResultadoTiemposColectaCliente {
  ventanaDias: number;
  estadisticosGlobales: EstadisticosResult | null;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosSinFechaColecta: number;
  porDeposito: GrupoDeposito[];
  porCourier: GrupoCourierColecta[];
  porDiaSemana: GrupoDiaSemana[];
  porMes: GrupoMesColecta[];
  scope: "cliente";
}

export interface ResultadoTiemposColectaShipro {
  ventanaDias: number;
  estadisticosGlobales: EstadisticosResult | null;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosSinFechaColecta: number;
  porDeposito: GrupoDeposito[];
  porCourier: GrupoCourierColecta[];
  porDiaSemana: GrupoDiaSemana[];
  porMes: GrupoMesColecta[];
  porEmpresa: GrupoEmpresaColecta[];
  scope: "shipro";
}

export type ResultadoTiemposColecta = ResultadoTiemposColectaCliente | ResultadoTiemposColectaShipro;

export async function calcularTiemposColecta(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<ResultadoTiemposColecta> {
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
    select: {
      id: true,
      fechaImpresion: true,
      fechaColecta: true,
      depositoId: true,
      courierId: true,
      empresaId: true,
      deposito: { select: { id: true, nombre: true } },
      courier: { select: { id: true, nombre: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  const cantidadEnviosTotal = envios.length;

  // Filter envios con fechaColecta poblada.
  const enviosValidos = envios.filter(e => e.fechaColecta !== null);
  const cantidadEnviosValidos = enviosValidos.length;
  const cantidadEnviosSinFechaColecta = cantidadEnviosTotal - cantidadEnviosValidos;

  // Compute delta horas para cada envio valido.
  type EnvioConDelta = {
    envio: typeof enviosValidos[number];
    deltaHoras: number;
  };
  const enviosConDelta: EnvioConDelta[] = enviosValidos.map(e => ({
    envio: e,
    deltaHoras: (e.fechaColecta!.getTime() - e.fechaImpresion.getTime()) / 3600000,
  }));

  const todasLasHoras = enviosConDelta.map(d => d.deltaHoras);
  const estadisticosGlobales = todasLasHoras.length > 0 ? calcularEstadisticos(todasLasHoras) : null;

  // Helper para computar estadisticos por grupo.
  // Usa optional chaining: calcularEstadisticos puede retornar null si
  // valores.length < umbralMinimo (=1). Pattern consistente con endpoint Torre.
  const estadisticosDeGrupo = (horas: number[]): { medianaHoras: number; promedioHoras: number; p95Horas: number; cantidad: number } => {
    const stats = calcularEstadisticos(horas);
    return {
      medianaHoras: stats?.p50 ?? 0,
      promedioHoras: stats?.promedio ?? 0,
      p95Horas: stats?.p95 ?? 0,
      cantidad: stats?.cantidad ?? 0,
    };
  };

  // ============================================================
  // Group by deposito.
  // ============================================================
  const depositoMap = new Map<number, { depositoNombre: string; horas: number[] }>();
  for (const d of enviosConDelta) {
    if (!d.envio.deposito) continue;
    const did = d.envio.deposito.id;
    if (!depositoMap.has(did)) {
      depositoMap.set(did, { depositoNombre: d.envio.deposito.nombre, horas: [] });
    }
    depositoMap.get(did)!.horas.push(d.deltaHoras);
  }
  const porDeposito: GrupoDeposito[] = Array.from(depositoMap.entries())
    .map(([depositoId, g]) => ({
      depositoId,
      depositoNombre: g.depositoNombre,
      ...estadisticosDeGrupo(g.horas),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // ============================================================
  // Group by courier.
  // ============================================================
  const courierMap = new Map<number, { courierNombre: string; horas: number[] }>();
  for (const d of enviosConDelta) {
    const cid = d.envio.courier.id;
    if (!courierMap.has(cid)) {
      courierMap.set(cid, { courierNombre: d.envio.courier.nombre, horas: [] });
    }
    courierMap.get(cid)!.horas.push(d.deltaHoras);
  }
  const porCourier: GrupoCourierColecta[] = Array.from(courierMap.entries())
    .map(([courierId, g]) => ({
      courierId,
      courierNombre: g.courierNombre,
      ...estadisticosDeGrupo(g.horas),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // ============================================================
  // Group by dia semana (0=Domingo, 6=Sabado).
  // ============================================================
  const diaSemanaMap = new Map<number, number[]>();
  for (const d of enviosConDelta) {
    const dia = d.envio.fechaImpresion.getDay();
    if (!diaSemanaMap.has(dia)) diaSemanaMap.set(dia, []);
    diaSemanaMap.get(dia)!.push(d.deltaHoras);
  }
  const porDiaSemana: GrupoDiaSemana[] = Array.from(diaSemanaMap.entries())
    .map(([dia, horas]) => ({
      diaSemana: dia,
      diaSemanaNombre: DIAS_SEMANA_NOMBRES[dia],
      ...estadisticosDeGrupo(horas),
    }))
    .sort((a, b) => a.diaSemana - b.diaSemana);

  // ============================================================
  // Group by mes (YYYY-MM).
  // ============================================================
  const mesMap = new Map<string, number[]>();
  for (const d of enviosConDelta) {
    const f = d.envio.fechaImpresion;
    const mes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
    if (!mesMap.has(mes)) mesMap.set(mes, []);
    mesMap.get(mes)!.push(d.deltaHoras);
  }
  const porMes: GrupoMesColecta[] = Array.from(mesMap.entries())
    .map(([mes, horas]) => ({
      mes,
      ...estadisticosDeGrupo(horas),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  if (!ctx.modoDios) {
    return {
      ventanaDias,
      estadisticosGlobales,
      cantidadEnviosTotal,
      cantidadEnviosValidos,
      cantidadEnviosSinFechaColecta,
      porDeposito,
      porCourier,
      porDiaSemana,
      porMes,
      scope: "cliente",
    };
  }

  // Shipro: include porEmpresa.
  const empresaMap = new Map<number, { empresaNombre: string; horas: number[] }>();
  if (ctx.empresaId === null) {
    for (const d of enviosConDelta) {
      if (!d.envio.empresa) continue;
      const eid = d.envio.empresa.id;
      if (!empresaMap.has(eid)) {
        empresaMap.set(eid, { empresaNombre: d.envio.empresa.nombre, horas: [] });
      }
      empresaMap.get(eid)!.horas.push(d.deltaHoras);
    }
  }
  const porEmpresa: GrupoEmpresaColecta[] = Array.from(empresaMap.entries())
    .map(([empresaId, g]) => ({
      empresaId,
      empresaNombre: g.empresaNombre,
      ...estadisticosDeGrupo(g.horas),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    ventanaDias,
    estadisticosGlobales,
    cantidadEnviosTotal,
    cantidadEnviosValidos,
    cantidadEnviosSinFechaColecta,
    porDeposito,
    porCourier,
    porDiaSemana,
    porMes,
    porEmpresa,
    scope: "shipro",
  };
}
