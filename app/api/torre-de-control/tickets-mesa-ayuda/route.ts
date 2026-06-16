// ============================================================================
// API — Tickets Mesa de Ayuda (Analitica)
//
// Endpoint scope-aware migrado a usar helper lib/utils/tickets-mesa-ayuda.ts
// (funcion calcularTicketsMesaAyudaAnalitica). Soporta 3 modos (autodetectados):
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
// Migrado en Phase 2.4 (Panel cliente, 2026-06-15).
// Antes: guard estricto modoDios + logica inline 239 lineas.
// Ahora: delegate a calcularTicketsMesaAyudaAnalitica scope-aware automatico.
//
// Acepta ?ventanaDias=N (default 90).
//
// DEUDA 53 registrada: heuristica esRadarShipro basada en substrings
// del motivo es fragil. Requiere campo formal TicketSoporte.origen.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularTicketsMesaAyudaAnalitica } from "@/lib/utils/tickets-mesa-ayuda";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");
    const ventanaDiasRaw = searchParams.get("ventanaDias");
    const ventanaDias = ventanaDiasRaw ? parseInt(ventanaDiasRaw) : undefined;

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularTicketsMesaAyudaAnalitica(ctx, ventanaDias);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre/Panel] Error en tickets-mesa-ayuda:", error);
    return NextResponse.json(
      { error: "Error calculando tickets de mesa de ayuda" },
      { status: 500 }
    );
  }
}
