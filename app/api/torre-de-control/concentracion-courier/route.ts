// ============================================================================
// API — Concentracion Courier / Riesgo Courier (Analitica)
//
// Endpoint scope-aware via helper lib/utils/concentracion-courier.ts
// (funcion calcularConcentracionCourierAnalitica). Soporta 3 modos
// (autodetectados):
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente" con resumen.vista = "empresa".
//
// 2. Shipro Torre global (modoDios=true, sin filtro): todas las empresas.
//    Response: shape "shipro" con resumen.vista = "global" + porEmpresa.
//
// 3. Shipro Torre inspeccion (modoDios=true, con filtro): empresa especifica.
//    Response: shape "shipro" con resumen.vista = "empresa".
//
// Migrado en Phase 2.5 (Panel cliente) + Phase 4.d (limpieza dual-param).
// Phase 2.5 introdujo DUAL-PARAM compat (?filtroEmpresa + ?empresaId legacy)
// para no romper Torre dashboard. Phase 4.d limpia ese fallback tras la
// migracion de Torre dashboard a ?filtroEmpresa= en Phase 4.c.
//
// Acepta:
// - ?filtroEmpresa=N (standard, scope-aware via resolverContext).
// - ?ventanaDias=N (default 90).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularConcentracionCourierAnalitica } from "@/lib/utils/concentracion-courier";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const filtroEmpresa = searchParams.get("filtroEmpresa");

    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularConcentracionCourierAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en concentracion-courier:", error);
    return NextResponse.json(
      { error: "Error calculando concentracion courier" },
      { status: 500 }
    );
  }
}
