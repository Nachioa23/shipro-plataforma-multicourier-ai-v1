// ============================================================================
// TORRE DE CONTROL — METRICA 12 "Mapa SLA (Real)"
//
// Endpoint dedicado que migra Card 12 fuera del legacy /api/metricas.
// Reusa lib/utils/sla.ts. Auth modoDios. Scope global.
//
// Decisiones (director 2026-06-11):
// - Opcion A elegida: migracion pura, sin corregir bugs preservados.
// - Ventana 90 dias (consistente con otras metricas).
// - 3 bugs documentados en DEUDA 61.
// ============================================================================

import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { calcularMapaSLA } from "@/lib/utils/sla";

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json(
        { error: "Acceso solo para roles Shipro." },
        { status: 403 }
      );
    }

    const resultado = await calcularMapaSLA(90);

    return NextResponse.json(resultado);
  } catch (error: any) {
    console.error("[Torre de Control] Error en mapa-sla:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Mapa SLA" },
      { status: 500 }
    );
  }
}
