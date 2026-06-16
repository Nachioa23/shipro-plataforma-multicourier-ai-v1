// ============================================================================
// API — Concentracion Courier / Riesgo Courier (Analitica)
//
// Endpoint scope-aware migrado a usar helper lib/utils/concentracion-courier.ts
// (funcion calcularConcentracionCourierAnalitica). Soporta 3 modos (autodetectados):
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
// Migrado en Phase 2.5 (Panel cliente, 2026-06-15).
// Antes: guard estricto modoDios + logica inline 201 lineas + parametro
// non-standard ?empresaId=N.
// Ahora: delegate a calcularConcentracionCourierAnalitica scope-aware
// automatico + DUAL-PARAM compat:
//   - ?filtroEmpresa=N (standard, prioridad).
//   - ?empresaId=N (legacy alias para Torre dashboard L303 que aun lo usa).
//
// DEUDA Phase 4 cleanup: cuando Torre dashboard L303-304 migre a
// ?filtroEmpresa= standard, retirar el fallback ?empresaId= de este
// endpoint route.ts.
//
// Acepta ?ventanaDias=N (default 90).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularConcentracionCourierAnalitica } from "@/lib/utils/concentracion-courier";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // DUAL-PARAM compat: ?filtroEmpresa (standard) toma prioridad,
    // fallback a ?empresaId (legacy alias para Torre dashboard).
    const filtroEmpresa =
      searchParams.get("filtroEmpresa") ?? searchParams.get("empresaId");

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
