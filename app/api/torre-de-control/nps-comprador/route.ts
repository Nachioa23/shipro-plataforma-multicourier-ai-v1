// ============================================================================
// API — NPS Comprador (Transaccional)
//
// Endpoint scope-aware migrado a usar helper lib/utils/nps.ts
// (funcion calcularNpsCompradorAnalitica). Soporta 3 modos (autodetectados):
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
// Migrado en Phase 2.3 (Panel cliente, 2026-06-15).
// Antes: guard estricto modoDios + logica inline 225 lineas.
// Ahora: delegate a calcularNpsCompradorAnalitica scope-aware automatico.
//
// Acepta ?ventanaDias=N (default 90).
//
// NOTA: este endpoint usa calcularNpsCompradorAnalitica (NPS post-entrega
// del comprador final). NO confundir con nps-cliente-empresa (NPS
// trimestral de la empresa cliente sobre Shipro), que usa nps-empresa.ts.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularNpsCompradorAnalitica } from "@/lib/utils/nps";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularNpsCompradorAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en nps-comprador:", error);
    return NextResponse.json(
      { error: "Error calculando NPS comprador" },
      { status: 500 }
    );
  }
}
