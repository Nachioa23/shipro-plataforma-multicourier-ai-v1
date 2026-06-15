// ============================================================================
// API — Mapa de Calor SLA (Analitica)
//
// Endpoint scope-aware migrado a usar helper lib/utils/sla.ts
// (funcion calcularMapaSlaAnalitica). Soporta 3 modos (autodetectados):
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente" simplificado (sin porEmpresa).
//
// 2. Shipro Torre global (modoDios=true, sin filtroEmpresa): todas las
//    empresas. Response: shape "shipro" con porEmpresa adicional.
//
// 3. Shipro Torre inspeccion (modoDios=true, con filtroEmpresa=N):
//    empresa especifica. Response: shape "shipro" sin porEmpresa.
//
// Migrado en Phase 2.1 (Panel cliente, 2026-06-15).
// Antes: guard estricto modoDios + delegate a calcularMapaSLA (sin scope).
// Ahora: delegate a calcularMapaSlaAnalitica scope-aware automatico.
//
// Acepta ?ventanaDias=N (default 90).
//
// NOTA: BUG 1 de DEUDA 61 corregido incidentalmente en el helper.
// BUGS 2 y 3 preservados.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularMapaSlaAnalitica } from "@/lib/utils/sla";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularMapaSlaAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en mapa-sla:", error);
    return NextResponse.json(
      { error: "Error calculando mapa de SLA" },
      { status: 500 }
    );
  }
}
