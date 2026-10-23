-- DEUDA 186 Flex PIEZA 2 (2026-10-23) — extensión de MetricaConfiabilidad por
-- zona Flex. El cron agrega un tercer grupo (porZonaFlex) cuando el envío
-- tiene Envio.zoneIdMl (persistido por PIEZA 1).
--
-- Aditiva pura:
--   - 1 columna nullable en MetricaConfiabilidad.
--   - Recreación del @@unique con zoneIdMl añadido. Las filas provincia/global
--     existentes (zoneIdMl=NULL) siguen cumpliendo el unique ampliado — Postgres
--     trata NULL como distinto en unique, así que no hay conflicto.
--   - Zero cambio a datos, zero DROP de columnas, zero touch del cron/crear.ts
--     a nivel schema.
--
-- Coexistencia:
--   - Filas por provincia (zoneIdMl=NULL, esGlobal=false): sin cambios.
--   - Filas global del courier (zoneIdMl=NULL, esGlobal=true, provinciaDestino=""): sin cambios.
--   - Filas Flex zona (zoneIdMl != NULL, esGlobal=false, provinciaDestino=""): dimensión nueva.

-- 1. Columna nueva nullable.
ALTER TABLE "MetricaConfiabilidad" ADD COLUMN "zoneIdMl" TEXT;

-- 2. Recrear el unique con zoneIdMl añadido.
-- Postgres truncó el nombre del índice original a 63 caracteres (es el nombre
-- real en la DB, ver `pg_indexes WHERE tablename='MetricaConfiabilidad'`).
DROP INDEX IF EXISTS "MetricaConfiabilidad_courierId_provinciaDestino_esGlobal_ventan";
-- Nombre del unique viejo tal como Prisma lo generó originalmente (fallback por
-- si Postgres NO lo truncó en algún runtime; DROP IF EXISTS evita error).
DROP INDEX IF EXISTS "MetricaConfiabilidad_courierId_provinciaDestino_esGlobal_ventanaDias_key";

CREATE UNIQUE INDEX "MetricaConfiabilidad_courierId_provinciaDestino_esGlobal_ve_key"
    ON "MetricaConfiabilidad"("courierId", "provinciaDestino", "esGlobal", "ventanaDias", "zoneIdMl");
