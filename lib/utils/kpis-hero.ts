// ============================================================================
// HELPER — KPIs Hero Panel cliente (Analitica)
//
// Phase 4.f.b (cleanup global, 2026-06-16). Helper creado desde cero.
// Centraliza la logica analitica de los 4 KPIs del Hero Card 1 del Panel
// cliente (antes en /api/dashboard reducido). Reemplaza a /api/dashboard
// post-Phase 4.f.
//
// SEMANTICA: orquestador scope-aware unico calcularKPIsHeroAnalitica.
// Computa 4 KPIs en un solo round-trip al DB con queries optimizadas:
//
//   - enviosMes:       cantidad de envios en el dateRange del usuario.
//   - porcentajeExito: % envios entregados sobre rolling 180 dias hardcoded.
//   - gastoTotal:      suma precioFactura (fallback precioMostrado) en dateRange.
//   - ticketsActivos:  count tickets no CERRADOS por empresa (sin date filter).
//
// Tambien retorna courierIds (derivados de enviosData) para lookup posterior
// con helper hermano lista-couriers.ts.
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.envio por ctx.empresaId.
//   Retorna shape "cliente".
// - Shipro Torre global (modoDios=true, ctx.empresaId=null): sin filtro
//   de empresa. Retorna shape "shipro".
// - Shipro inspeccion (modoDios=true, ctx.empresaId=N): filtra a esa
//   empresa. Retorna shape "shipro".
//
// Decisiones de producto (director 2026-06-16):
// D1 - Single helper que orquesta 4 KPIs + courierIds (no split por metrica
//      individual). enviosData se fetch UNA vez y se reutiliza para 3
//      computos (enviosMes, gastoTotal, courierIds).
// D2 - Endpoint parsea dateRange (rango/desde/hasta) y pasa { fechaInicio,
//      fechaFin } resueltos al helper. Helper queda puro, testeable sin
//      clock mocks.
// D3 - VENTANA_EXITO_DIAS hardcoded a 180 (constante interna). No
//      configurable por param — decision historica de producto.
// D4 - ticketsActivos usa estado: { not: "CERRADO" } (agnostic a enum
//      drift entre "EN_PROGRESO" / "PROGRESO" legacy en TicketSoporte).
// D5 - estadoActual para Envio (no estado — schema correcto verificado).
//
// DEUDA Phase 3 proyectada: Categoria B/C puede reutilizar este helper o
// extender con metricas adicionales del Hero (ej: SLA general, retencion).
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_EXITO_DIAS = 180;

export interface DateRangeKPIs {
  fechaInicio: Date;
  fechaFin: Date | null;
}

export interface ResumenKPIsHero {
  enviosMes: number;
  porcentajeExito: number;
  gastoTotal: number;
  ticketsActivos: number;
}

export interface ResultadoKPIsHeroBase {
  resumen: ResumenKPIsHero;
  courierIds: number[];
}

export interface ResultadoKPIsHeroCliente extends ResultadoKPIsHeroBase {
  scope: "cliente";
}

export interface ResultadoKPIsHeroShipro extends ResultadoKPIsHeroBase {
  scope: "shipro";
}

export type ResultadoKPIsHero = ResultadoKPIsHeroCliente | ResultadoKPIsHeroShipro;

export async function calcularKPIsHeroAnalitica(
  ctx: AuthContext,
  dateRange: DateRangeKPIs
): Promise<ResultadoKPIsHero> {
  // Build base where clause scope-aware (filter por empresa si aplica).
  const baseWhere: any = {};
  if (!ctx.modoDios) {
    baseWhere.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    baseWhere.empresaId = ctx.empresaId;
  }
  // Shipro global (modoDios=true, empresaId=null) sin filtro.

  // whereMes: date range del usuario.
  const whereMes: any = {
    ...baseWhere,
    fechaImpresion: dateRange.fechaFin
      ? { gte: dateRange.fechaInicio, lte: dateRange.fechaFin }
      : { gte: dateRange.fechaInicio },
  };

  // where180: rolling 180 dias hardcoded para porcentajeExito.
  const inicio180d = new Date(
    Date.now() - VENTANA_EXITO_DIAS * 24 * 60 * 60 * 1000
  );
  const where180: any = {
    ...baseWhere,
    fechaImpresion: { gte: inicio180d },
  };

  // Query A: enviosData del dateRange con finanzas minimas (gastoTotal).
  const enviosData = await prisma.envio.findMany({
    where: whereMes,
    include: {
      finanzas: { select: { precioFactura: true, precioMostrado: true } },
    },
  });

  const enviosMes = enviosData.length;

  // Query B + C: porcentajeExito sobre rolling 180d.
  const paquetesSalidos = await prisma.envio.count({ where: where180 });
  const paquetesEntregados = await prisma.envio.count({
    where: { ...where180, estadoActual: "ENTREGADO" },
  });
  const porcentajeExito = paquetesSalidos > 0
    ? Math.round((paquetesEntregados / paquetesSalidos) * 100)
    : 0;

  // gastoTotal: reduce sobre finanzas (in-memory).
  const gastoTotalDecimal = enviosData.reduce(
    (acc, e) => acc.add(e.finanzas?.precioFactura ?? e.finanzas?.precioMostrado ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0)
  );
  const gastoTotal = gastoTotalDecimal.toNumber();

  // Query D: tickets activos sin date filter (agnostic a enum drift).
  const ticketsWhere: any = {
    estado: { not: "CERRADO" },
  };
  if (!ctx.modoDios) {
    ticketsWhere.envio = { empresaId: ctx.empresaId };
  } else if (ctx.empresaId !== null) {
    ticketsWhere.envio = { empresaId: ctx.empresaId };
  }
  // Shipro global sin filtro de empresa.

  const ticketsActivos = await prisma.ticketSoporte.count({
    where: ticketsWhere,
  });

  // courierIds: derivado de enviosData (no requiere query adicional).
  const courierIds = [
    ...new Set(
      enviosData
        .map(e => e.courierId)
        .filter((id): id is number => id != null)
    ),
  ];

  const resumen: ResumenKPIsHero = {
    enviosMes,
    porcentajeExito,
    gastoTotal,
    ticketsActivos,
  };

  const base: ResultadoKPIsHeroBase = {
    resumen,
    courierIds,
  };

  if (!ctx.modoDios) {
    return { ...base, scope: "cliente" };
  }

  return { ...base, scope: "shipro" };
}
