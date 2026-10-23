-- DEUDA 186 Flex PIEZA 4 (2026-10-23) — metas de on-time por zona Flex.
--
-- Aditiva pura:
--   - Empresa.metaOnTimeFlexPct NOT NULL DEFAULT 97.00 (meta ML). Rows
--     existentes se agregan con el default — zero data migration.
--   - AsignacionCourierZonaFlex.metaOnTimeFlexPct NULLABLE (override opcional
--     per-zona). Rows existentes con null = usan la de Empresa.
--
-- La precedencia zona→empresa vive en el helper lib/utils/meta-flex.ts para
-- que UI (Chat D) y scoring usen la misma regla.

ALTER TABLE "Empresa"
    ADD COLUMN "metaOnTimeFlexPct" DECIMAL(5,2) NOT NULL DEFAULT 97.00;

ALTER TABLE "AsignacionCourierZonaFlex"
    ADD COLUMN "metaOnTimeFlexPct" DECIMAL(5,2);
