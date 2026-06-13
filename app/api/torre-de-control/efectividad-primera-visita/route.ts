// ============================================================================
// API — Efectividad de Primera Visita
//
// Endpoint scope-aware migrado a usar helper lib/utils/efectividad-primera-visita.ts.
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
// Migrado en Phase 1.3 (Panel cliente, 2026-06-13).
// Antes: guard estricto modoDios + logica inline 229 lineas.
// Ahora: helper centralizado + scope automatico via AuthContext.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularEfectividad } from "@/lib/utils/efectividad-primera-visita";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularEfectividad(ctx);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en efectividad-primera-visita:", error);
    return NextResponse.json(
      { error: "Error calculando efectividad de primera visita" },
      { status: 500 }
    );
  }
}
