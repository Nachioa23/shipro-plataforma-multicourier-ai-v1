// ============================================================================
// API — Modalidades (Analitica)
//
// Endpoint scope-aware migrado a usar helper lib/utils/modalidades.ts
// (funcion calcularModalidadesAnalitica). Soporta 3 modos (autodetectados):
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
// Migrado en Phase 2.2 (Panel cliente, 2026-06-15).
// Antes: guard estricto modoDios + logica inline 274 lineas.
// Ahora: delegate a calcularModalidadesAnalitica scope-aware automatico.
//
// Acepta ?ventanaDias=N (default 90).
//
// NOTA: este endpoint usa calcularModalidadesAnalitica (analitica
// retroactiva). NO confundir con inferirModalidad del mismo helper,
// que sirve a crear.ts en runtime de creacion de envios.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularModalidadesAnalitica } from "@/lib/utils/modalidades";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularModalidadesAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en modalidades:", error);
    return NextResponse.json(
      { error: "Error calculando modalidades" },
      { status: 500 }
    );
  }
}
