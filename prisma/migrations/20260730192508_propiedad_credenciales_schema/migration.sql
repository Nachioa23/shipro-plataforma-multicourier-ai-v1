-- FASE 2 pieza 1: propiedad de credenciales + markup por dueño (Forma 2).
-- Autoría manual (NO generada por prisma migrate dev). El paso 4-a-4-d altera
-- CourierIntermediario dropeando la columna legacy `nombreIntermediario` y
-- agregando `propietarioCourierId` como FK — con backfill controlado antes del
-- ALTER NOT NULL para no romper filas existentes.

-- CreateEnum
CREATE TYPE "PropietarioTipo" AS ENUM ('CLIENTE', 'SHIPRO', 'COURIER');

-- ============================================================================
-- 1. CredencialCourier: agregar los campos de propiedad (nullable) + FK + índice.
-- ============================================================================

-- AlterTable
ALTER TABLE "CredencialCourier" ADD COLUMN     "propietarioTipo" "PropietarioTipo",
ADD COLUMN     "propietarioCourierId" INTEGER;

-- CreateIndex
CREATE INDEX "CredencialCourier_propietarioCourierId_idx" ON "CredencialCourier"("propietarioCourierId");

-- AddForeignKey
ALTER TABLE "CredencialCourier" ADD CONSTRAINT "CredencialCourier_propietarioCourierId_fkey" FOREIGN KEY ("propietarioCourierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 2. CourierIntermediario: reemplazar `nombreIntermediario` (String) por
--    `propietarioCourierId` (FK a Courier). Backfill controlado antes del NOT NULL.
-- ============================================================================

-- AlterTable: agregar propietarioCourierId como nullable primero
ALTER TABLE "CourierIntermediario" ADD COLUMN     "propietarioCourierId" INTEGER;

-- Backfill: match por nombre exacto contra Courier.nombre
UPDATE "CourierIntermediario" ci
   SET "propietarioCourierId" = c.id
  FROM "Courier" c
 WHERE c.nombre = ci."nombreIntermediario";

-- Sanity: fail-loud si alguna fila no se pudo resolver (nombre huérfano en Courier)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CourierIntermediario" WHERE "propietarioCourierId" IS NULL) THEN
    RAISE EXCEPTION 'FASE2 pieza 1: CourierIntermediario tiene filas con nombreIntermediario sin match en Courier.nombre — resolver manualmente antes de aplicar esta migración';
  END IF;
END $$;

-- Ahora sí: NOT NULL
ALTER TABLE "CourierIntermediario" ALTER COLUMN "propietarioCourierId" SET NOT NULL;

-- DropColumn legacy
ALTER TABLE "CourierIntermediario" DROP COLUMN "nombreIntermediario";

-- CreateIndex (nuevo eje owner)
CREATE INDEX "CourierIntermediario_propietarioCourierId_activo_idx" ON "CourierIntermediario"("propietarioCourierId", "activo");

-- AddForeignKey
ALTER TABLE "CourierIntermediario" ADD CONSTRAINT "CourierIntermediario_propietarioCourierId_fkey" FOREIGN KEY ("propietarioCourierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
