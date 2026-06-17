// ============================================================================
// HELPER UTILITY — Lista Couriers (lookup nombres por IDs)
//
// Phase 4.f.c (cleanup global, 2026-06-16). Helper utility creado desde cero.
// Centraliza el lookup de nombres de couriers a partir de una lista de IDs.
//
// SEMANTICA: utility function obtenerNombresCouriers que recibe courierIds[]
// y retorna [{ id, nombre }] para esos couriers.
//
// USO TIPICO: combinado con calcularKPIsHeroAnalitica del helper hermano
// kpis-hero.ts. Ese helper retorna courierIds derivados de enviosData; este
// helper hace el lookup separado para mantener Single Responsibility.
//
// Helper minimo (sin scope-aware logic) — el filtro de empresa ya ocurrio
// upstream al construir courierIds. Este helper solo hace el lookup id->nombre.
//
// Decisiones de producto (director 2026-06-16):
// D1 - Helper utility separado de kpis-hero.ts. Single Responsibility:
//      kpis-hero = analitica, lista-couriers = lookup utility.
// D2 - Sin scope-aware logic en este helper. El filtro de empresa ya se
//      aplico al construir courierIds upstream (typically en kpis-hero.ts
//      vía enviosData scope-aware).
// D3 - Retorna [] si courierIds esta vacio (early return, evita query
//      innecesaria con where: { id: { in: [] } }).
//
// REUSABLE: este helper puede ser consumido por cualquier endpoint que
// necesite hacer un lookup de nombres de couriers a partir de IDs (Phase 3
// puede beneficiarse para metricas adicionales).
// ============================================================================

import prisma from "@/lib/prisma";

export interface CourierInfo {
  id: number;
  nombre: string;
}

export async function obtenerNombresCouriers(
  courierIds: number[]
): Promise<CourierInfo[]> {
  if (courierIds.length === 0) {
    return [];
  }

  const couriers = await prisma.courier.findMany({
    where: { id: { in: courierIds } },
    select: { id: true, nombre: true },
  });

  return couriers;
}
