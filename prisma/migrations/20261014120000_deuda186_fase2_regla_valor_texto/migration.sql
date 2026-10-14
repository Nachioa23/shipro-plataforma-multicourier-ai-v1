-- =============================================================================
-- DEUDA 186 Fase 2 pieza 2 (2026-10-14) — ReglaRuteo.condicionValorTexto
--
-- Agrega columna String? nullable para el valor de condición de variables
-- categóricas/string (empezando por PROVINCIA_DESTINO que cierra DEUDA 99).
-- Variables numéricas (VALOR_CARRITO, PESO_PAQUETE) siguen con
-- condicionValor1/condicionValor2 — este campo NO reemplaza nada, es aditivo.
--
-- Nullable + sin default es INTENCIONAL: reglas existentes (todas numéricas al
-- 2026-10-14) quedan con condicionValorTexto=null → el guard del evaluador
-- (`regla.condicionValorTexto` en el if) corta antes de evaluar → no matchean
-- nada por esta vía (backward-compat total). El patrón se reusa a futuro para
-- otras variables categóricas (ZONA cuando DEUDA 46 cablee ZonaLogistica,
-- SKU_FLAG cuando el DTO acepte categorías, etc.).
-- =============================================================================

-- AlterTable
ALTER TABLE "ReglaRuteo" ADD COLUMN "condicionValorTexto" TEXT;
