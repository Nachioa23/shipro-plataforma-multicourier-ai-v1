// ============================================================================
// API — KPIs Hero Panel cliente (Analitica)
//
// Endpoint scope-aware que delega a 2 helpers:
//   - lib/utils/kpis-hero.ts (calcularKPIsHeroAnalitica): 4 KPIs analiticos +
//     courierIds derivados.
//   - lib/utils/lista-couriers.ts (obtenerNombresCouriers): lookup nombres
//     a partir de courierIds.
//
// Reemplaza a /api/dashboard (deprecado en Phase 4.f.f). Soporta 3 modos
// scope-aware (autodetectados via resolverContext):
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente".
//
// 2. Shipro Torre global (modoDios=true, sin filtro): sin filtro empresa.
//    Response: shape "shipro".
//
// 3. Shipro Torre inspeccion (modoDios=true, con ?filtroEmpresa=N): empresa
//    especifica. Response: shape "shipro".
//
// Phase 4.f.d (cleanup global, 2026-06-16). Single endpoint que orquesta los
// dos helpers — Single Responsibility en helpers, orquestacion en endpoint.
//
// Acepta query params:
// - ?filtroEmpresa=N (standard, scope-aware via resolverContext).
// - ?rango=hoy | semana | trimestre | mes_actual (default).
// - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (custom range, overrides rango).
//
// Auth: proxy enforcing (consistente con codebase).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularKPIsHeroAnalitica } from "@/lib/utils/kpis-hero";
import { obtenerNombresCouriers } from "@/lib/utils/lista-couriers";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const rango = searchParams.get("rango");
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    // Parse dateRange del usuario (?rango=X o ?desde&hasta).
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

    // Helper 1: KPIs analiticos + courierIds.
    const kpis = await calcularKPIsHeroAnalitica(ctx, { fechaInicio, fechaFin });

    // Helper 2: lookup nombres de couriers.
    const nombresCouriers = await obtenerNombresCouriers(kpis.courierIds);

    return NextResponse.json({
      enviosMes: kpis.resumen.enviosMes,
      porcentajeExito: kpis.resumen.porcentajeExito,
      gastoTotal: kpis.resumen.gastoTotal,
      ticketsActivos: kpis.resumen.ticketsActivos,
      nombresCouriers,
      scope: kpis.scope,
    });
  } catch (error: any) {
    console.error("[Torre/Panel] Error en kpis-hero:", error);
    return NextResponse.json(
      { error: "Error calculando KPIs Hero" },
      { status: 500 }
    );
  }
}
