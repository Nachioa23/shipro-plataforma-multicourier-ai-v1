// ============================================================================
// API — Cobertura Postal Activa (Métrica 4.3 Torre de Control)
//
// Endpoint scope-aware que consume lib/utils/cobertura-postal.ts.
// Patrón espejo de /api/torre-de-control/fuga-ruteo:
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente" (sin porEmpresa).
// 2. Shipro global (modoDios=true, sin filtroEmpresa): todas las empresas.
//    Response: shape "shipro" con porEmpresa.
// 3. Shipro inspección (modoDios=true, con filtroEmpresa=N): empresa
//    específica. Response: shape "shipro" (porEmpresa viene vacío).
//
// Lee RegistroCoberturaVacia (writer ya existente en lib/cotizador.ts
// desde Fase J); cero capture nueva. Nuevo helper + endpoint + UI card
// como parte del cierre parcial de DEUDA 39 (métrica missing confirmada
// por drift sweep 2026-10-13).
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularCoberturaPostal } from "@/lib/utils/cobertura-postal";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularCoberturaPostal(ctx);

    return NextResponse.json(resultado);
  } catch (error) {
    console.error("[Torre/Panel] Error en cobertura-postal:", error);
    return NextResponse.json(
      { error: "Error calculando cobertura postal" },
      { status: 500 }
    );
  }
}
