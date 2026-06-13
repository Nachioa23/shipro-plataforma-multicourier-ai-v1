// ============================================================================
// API — Promesa Calibrada (Analitica)
//
// Endpoint scope-aware migrado a usar helper lib/utils/promesa-calibrada.ts
// (funcion calcularPromesaAnalitica). Soporta 3 modos (autodetectados):
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
// Migrado en Phase 1.5 (Panel cliente, 2026-06-13).
// Antes: guard estricto modoDios + logica inline 302 lineas.
// Ahora: helper centralizado + scope automatico via AuthContext.
//
// Acepta ?ventanaDias=N (default 90).
//
// NOTA: Este endpoint usa calcularPromesaAnalitica (analitica retroactiva).
// NO confundir con calcularPromesaCalibrada del mismo helper, que sirve al
// cotizador real-time al checkout (cuadruple fallback Nivel 1-4).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularPromesaAnalitica } from "@/lib/utils/promesa-calibrada";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularPromesaAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en promesa-calibrada:", error);
    return NextResponse.json(
      { error: "Error calculando promesa calibrada" },
      { status: 500 }
    );
  }
}
