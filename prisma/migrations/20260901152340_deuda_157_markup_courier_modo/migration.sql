-- DEUDA 157 markup unificado Pieza 1 (2026-09-01): agrega el enum + campo `modo` a
-- MarkupCourier. HEREDA = sigue global MarkupShiproVigencia; PROPIO = valorPorcentaje
-- fijo (permite 0%). Existing rows heredan `modo=HEREDA` via el DEFAULT — cero cambio
-- de precio (matchean el global vigente igual que antes). Aditiva pura: cero drops,
-- cero alter de otras columnas. El motor NO lo lee todavía (Pieza 3 lo conecta).

-- CreateEnum
CREATE TYPE "MarkupCourierModo" AS ENUM ('HEREDA', 'PROPIO');

-- AlterTable
ALTER TABLE "MarkupCourier" ADD COLUMN     "modo" "MarkupCourierModo" NOT NULL DEFAULT 'HEREDA';
