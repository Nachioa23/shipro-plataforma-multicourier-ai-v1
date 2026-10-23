// ============================================================================
// DEUDA 186 Flex PIEZA 4 (2026-10-23) — Helper único de precedencia de la meta
// on-time Flex. Decisión Chat D+Nacho: dos niveles con regla clara.
// ============================================================================
//
// REGLA DE PRECEDENCIA:
//   1. AsignacionCourierZonaFlex.metaOnTimeFlexPct (nullable) — si está
//      definido (no null) para esta `(empresaId, zoneIdMl)`, es la meta
//      efectiva. Override opcional per-zona.
//   2. Si falta (null o no hay asignación) → Empresa.metaOnTimeFlexPct
//      (NOT NULL default 97.00 = meta ML).
//   3. Fallback defensivo (nunca debería ocurrir en producción porque la
//      columna Empresa es NOT NULL + default): 97.0.
//
// POR QUÉ UN SOLO HELPER:
// La UI del Chat D (recomendación de courier por zona + alerta "zona bajo
// meta") y el scoring Flex (comparar porcentajeOnTime real vs meta) consumen
// AMBOS esta función. Centralizarlo garantiza que no diverjan — si la regla
// cambia (ej. agregar un tercer nivel per-cliente), se cambia en UN lugar.
//
// READ-ONLY: solo prisma.findUnique. Zero writes, zero touch de Envio/money/
// cotizador. Money-safe por naturaleza (analytics puro).
// ============================================================================

import prisma from "@/lib/prisma";

/**
 * Resuelve la meta on-time efectiva para una (empresa, zona Flex opcional).
 *
 * @param empresaId  Shipro empresa id.
 * @param zoneIdMl   Zona ML opcional. Si viene, se intenta el override
 *                   per-zona antes de caer a la meta de empresa.
 * @returns Porcentaje 0-100 (típicamente ~97.00). Siempre un número válido;
 *          el fallback defensivo 97.0 cubre el edge case donde la empresa
 *          no existiera (improbable en producción).
 */
export async function resolverMetaOnTimeFlex(
  empresaId: number,
  zoneIdMl?: string | null,
): Promise<number> {
  // (1) Override per-zona (si viene zoneIdMl + la asignación tiene meta no-null).
  if (zoneIdMl) {
    const asig = await prisma.asignacionCourierZonaFlex.findUnique({
      where: {
        empresaId_zoneIdMl: { empresaId, zoneIdMl },
      },
      select: { metaOnTimeFlexPct: true },
    });
    if (asig?.metaOnTimeFlexPct != null) {
      return asig.metaOnTimeFlexPct.toNumber();
    }
  }

  // (2) Meta de empresa (NOT NULL default 97.00).
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { metaOnTimeFlexPct: true },
  });

  // (3) Fallback defensivo — nunca debería activarse (columna NOT NULL +
  // Empresa casi siempre existe si llegamos acá). 97 = meta ML.
  return empresa?.metaOnTimeFlexPct?.toNumber() ?? 97.0;
}
