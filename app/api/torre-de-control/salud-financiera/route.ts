// ============================================================================
// API — Salud Financiera de la Operación (Métrica 4.4 Torre de Control)
//
// Endpoint scope-aware que consume lib/utils/salud-financiera.ts.
// Patrón espejo de /api/torre-de-control/fuga-ruteo:
//
// 1. Cliente (modoDios=false): scope su empresa (ctx.empresaId).
//    Response: shape "cliente" (una sola `empresa`).
// 2. Shipro global (modoDios=true, sin filtroEmpresa): todas las empresas.
//    Response: shape "shipro" con `empresas[]` + `agregado`.
// 3. Shipro filtrado (modoDios=true, con filtroEmpresa=N): empresa específica.
//    Response: shape "shipro" con 1 empresa en el array + agregado sobre esa.
//
// READ-ONLY — el helper no muta nada (ni saldo, ni movimientos). Solo
// findMany + groupBy sobre data ya persistida por los 9 writers de
// MovimientoFinanciero (dispatch + conciliación + admin + crons bloqueados).
//
// Parte del cierre de DEUDA 39 (métrica missing confirmada por drift sweep
// 2026-10-13). Cimiento del motor de reglas (DEUDA 186): regla
// "cliente con <N días proyectados → alerta de bloqueo inminente".
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularSaludFinanciera } from "@/lib/utils/salud-financiera";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filtroEmpresa = searchParams.get("filtroEmpresa");

    const ctx = resolverContext(request, filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const resultado = await calcularSaludFinanciera(ctx);

    return NextResponse.json(resultado);
  } catch (error) {
    console.error("[Torre/Panel] Error en salud-financiera:", error);
    const mensaje = error instanceof Error ? error.message : "Error calculando salud financiera";
    const status = mensaje === "Empresa no encontrada" ? 404 : 500;
    return NextResponse.json({ error: mensaje }, { status });
  }
}
