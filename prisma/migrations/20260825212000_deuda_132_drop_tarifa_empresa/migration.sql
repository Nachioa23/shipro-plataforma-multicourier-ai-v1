-- DEUDA 132 Paso 5a: drop de Empresa.tarifaPlanaRespaldo. Reemplazado por
-- CredencialCourier.tarifaPlanaRespaldoCourier (per-courier). Los readers se
-- re-cablearon en el mismo commit; no hay backfill (NPMS sin clientes reales).
ALTER TABLE "Empresa" DROP COLUMN "tarifaPlanaRespaldo";
