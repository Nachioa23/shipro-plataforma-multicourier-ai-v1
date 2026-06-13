// ============================================================================
// API — Tiempos Colecta
//
// Endpoint scope-aware migrado a usar helper lib/utils/tiempos-colecta.ts.
// Soporta 3 modos (autodetectados desde AuthContext):
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente" simplificado (sin porEmpresa).
//
// 2. Shipro Torre global (modoDios=true, sin filtroEmpresa): todas las
//    empresas. Response: shape "shipro" completo.
//
// 3. Shipro Torre inspeccion (modoDios=true, con filtroEmpresa=N):
//    empresa especifica. Response: shape "shipro" completo.
//
// Migrado en Phase 1.4 (Panel cliente, 2026-06-13).
// Antes: guard estricto modoDios + logica inline 235 lineas.
// Ahora: helper centralizado + scope automatico via AuthContext.
//
// Acepta ?ventanaDias=N (default 30).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularTiemposColecta } from "@/lib/utils/tiempos-colecta";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularTiemposColecta(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en tiempos-colecta:", error);
    return NextResponse.json(
      { error: "Error calculando tiempos de colecta" },
      { status: 500 }
    );
  }
}
