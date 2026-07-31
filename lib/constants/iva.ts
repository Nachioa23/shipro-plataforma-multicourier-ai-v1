import { Prisma } from "@prisma/client";

// =============================================================================
// IVA — FUENTE ÚNICA para todo el codebase (paso 1 de la hygiene sub-piece de
// docs/DISENO-CONFIG-VARIABLES-TARIFA.md).
//
// Todos los módulos que apliquen o extraigan IVA (backend money math, cron,
// conciliación, liquidaciones, frontend Excel export) DEBEN importar desde
// acá. NO redeclarar `new Prisma.Decimal("1.21")` ni `const IVA = 1.21` en
// ningún otro lugar — desincronización silenciosa = riesgo de plata.
//
// Este archivo es SOLO consolidación: el valor sigue siendo el mismo (21%,
// tasa vigente en AR). Una futura sub-pieza reemplazará este literal por una
// lectura desde configuración editable; la consolidación de hoy hace que ese
// cambio sea trivial y no pueda dejar sitios rezagados.
// =============================================================================

/** Rate literal — punto único donde vive el número. */
const IVA_AR_LITERAL = "1.21";

/** Multiplicador para money math backend (Prisma.Decimal). */
export const IVA_AR_MULTIPLIER: Prisma.Decimal = new Prisma.Decimal(IVA_AR_LITERAL);

/**
 * Multiplicador como number (frontend / cálculos display en JS puro donde no
 * conviene arrastrar Prisma.Decimal por bundle-size). Derivado del mismo literal.
 */
export const IVA_AR_MULTIPLIER_NUM: number = Number(IVA_AR_LITERAL);
