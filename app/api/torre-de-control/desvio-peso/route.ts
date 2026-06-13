// ============================================================================
// API — Desvio Financiero por Peso Volumetrico
//
// Endpoint scope-aware migrado a usar helper lib/utils/desvio-peso.ts.
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
// Migrado en Phase 1.2 (Panel cliente, 2026-06-13).
// Antes: guard estricto modoDios + logica inline 269 líneas.
// Ahora: helper centralizado + scope automatico via AuthContext.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularDesvioPeso } from "@/lib/utils/desvio-peso";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularDesvioPeso(ctx);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en desvio-peso:", error);
    return NextResponse.json(
      { error: "Error calculando desvio por peso" },
      { status: 500 }
    );
  }
}
