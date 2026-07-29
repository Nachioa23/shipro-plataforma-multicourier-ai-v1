-- DropForeignKey
ALTER TABLE "MovimientoFinanciero" DROP CONSTRAINT "MovimientoFinanciero_liquidacionId_fkey";

-- DropIndex (the @@unique)
DROP INDEX "MovimientoFinanciero_liquidacionId_envioId_tipo_key";

-- DropIndex (the @@index)
DROP INDEX "MovimientoFinanciero_liquidacionId_idx";

-- AlterTable
ALTER TABLE "MovimientoFinanciero" DROP COLUMN "liquidacionId";
