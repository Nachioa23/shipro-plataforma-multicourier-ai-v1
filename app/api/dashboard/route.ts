// ============================================================================
// API — Panel cliente Hero KPIs + lista de couriers
//
// Endpoint legacy reducido. Antes computaba 17 fields para Panel cliente; tras
// las migraciones Phase 1 + Phase 2 (DEUDA 62), solo 5 fields siguen ALIVE:
//
//   - enviosMes:       cantidad de envios en el rango (Hero Card 1).
//   - porcentajeExito: % entregados sobre rolling 180 dias (Card 1).
//   - gastoTotal:      suma precioFactura (fallback precioMostrado) (Card 1).
//   - ticketsActivos:  count de tickets no CERRADOS por empresa (Card 1).
//   - nombresCouriers: lookup id+nombre para couriersLista del Panel.
//
// DEAD fields eliminados (sin consumers JSX tras Phases 1.1-2.5): ruteoStats,
// aforoStats, efectividadStats, soporteStats, nps, slaStats, despachoSegmentos,
// despachoPorCourier, auditoriaStats, totalEnvios (dup de enviosMes),
// modalidades, couriers (groupBy).
//
// Phase 4.e cleanup (2026-06-16): -80% lineas (432 -> ~85). 8 secciones M2-M11
// dropped. 2 prisma.envio.groupBy + prisma.encuestaNPS.findMany + prisma
// .slaCourier.findMany eliminadas. Include enviosData simplificado (drop
// courier/destino/tickets/eventos; finanzas pasa a select 2 fields).
//
// Auth: proxy enforcing (consistente con resto del codebase, no usa
// getServerSession — patron no presente en este proyecto).
//
// Soporte completo de query params preservado:
// - ?empresaId=N | ?empresaId=TODAS (Shipro power-user)
// - ?rango=hoy | semana | trimestre | mes_actual (default)
// - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (custom range, overrides rango)
//
// DEUDA proyectada Phase 4.f (no incluida en este commit): refactorizar este
// endpoint en helpers scope-aware (kpis-hero.ts + lista-couriers.ts) y
// deprecar /api/dashboard por completo. Por ahora se mantiene como single
// endpoint reducido al minimo.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaIdParam = searchParams.get("empresaId") || "";
    const rango = searchParams.get("rango");
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    if (!empresaIdParam) {
      return NextResponse.json({ error: "Sin empresaId" }, { status: 400 });
    }

    // Date range parsing (preservado del endpoint legacy).
    const ahora = new Date();
    let fechaInicio: Date;
    let fechaFin: Date | null = null;
    if (desde && hasta) {
      fechaInicio = new Date(`${desde}T00:00:00.000Z`);
      fechaFin = new Date(`${hasta}T23:59:59.999Z`);
    } else {
      fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      if (rango === "hoy") fechaInicio.setHours(0, 0, 0, 0);
      else if (rango === "semana") fechaInicio.setDate(ahora.getDate() - 7);
      else if (rango === "trimestre") fechaInicio.setDate(ahora.getDate() - 90);
    }

    // baseWhere para empresa scoping (preserva soporte "TODAS").
    const baseWhere = empresaIdParam !== "TODAS"
      ? { empresaId: parseInt(empresaIdParam) }
      : {};

    // whereMes con date filter del usuario.
    const whereMes: any = {
      ...baseWhere,
      fechaImpresion: fechaFin
        ? { gte: fechaInicio, lte: fechaFin }
        : { gte: fechaInicio },
    };

    // where180 con rolling 180d hardcoded (porcentajeExito independiente
    // del filtroTiempo del usuario).
    const inicio180d = new Date(ahora.getTime() - 180 * 24 * 60 * 60 * 1000);
    const where180: any = {
      ...baseWhere,
      fechaImpresion: { gte: inicio180d },
    };

    // enviosData del rango con finanzas minimas (solo gastoTotal).
    const enviosData = await prisma.envio.findMany({
      where: whereMes,
      include: {
        finanzas: { select: { precioFactura: true, precioMostrado: true } },
      },
    });

    const enviosMes = enviosData.length;

    // Porcentaje exito sobre rolling 180 dias (estadoActual = "ENTREGADO").
    const paquetesSalidos = await prisma.envio.count({ where: where180 });
    const paquetesEntregados = await prisma.envio.count({
      where: { ...where180, estadoActual: "ENTREGADO" },
    });
    const porcentajeExito = paquetesSalidos > 0
      ? Math.round((paquetesEntregados / paquetesSalidos) * 100)
      : 0;

    // Gasto total del rango (suma precioFactura, fallback precioMostrado).
    const gastoTotal = enviosData.reduce(
      (acc, e) => acc + (e.finanzas?.precioFactura || e.finanzas?.precioMostrado || 0),
      0
    );

    // Tickets activos: estado distinto de "CERRADO" (agnostic a enum drift
    // entre "ABIERTO" | "EN_PROGRESO" | "PROGRESO" legacy).
    const ticketsActivos = await prisma.ticketSoporte.count({
      where: {
        envio: empresaIdParam !== "TODAS"
          ? { empresaId: parseInt(empresaIdParam) }
          : {},
        estado: { not: "CERRADO" },
      },
    });

    // Lista couriers para filtros Panel. courierIds derivado de enviosData
    // (evita groupBy adicional).
    const courierIds = [
      ...new Set(
        enviosData
          .map(e => e.courierId)
          .filter((id): id is number => id != null)
      ),
    ];
    const nombresCouriers = courierIds.length > 0
      ? await prisma.courier.findMany({
          where: { id: { in: courierIds } },
          select: { id: true, nombre: true },
        })
      : [];

    return NextResponse.json({
      enviosMes,
      porcentajeExito,
      gastoTotal,
      ticketsActivos,
      nombresCouriers,
    });
  } catch (error: any) {
    console.error("[Panel] Error en /api/dashboard:", error.message);
    return NextResponse.json(
      { error: "Error interno al calcular metricas" },
      { status: 500 }
    );
  }
}
