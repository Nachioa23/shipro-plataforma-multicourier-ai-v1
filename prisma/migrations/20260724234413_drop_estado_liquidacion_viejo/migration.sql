-- DropForeignKey
ALTER TABLE "Envio" DROP CONSTRAINT "Envio_liquidacionId_fkey";

-- AlterTable
ALTER TABLE "Envio" DROP COLUMN "estadoLiquidacion",
DROP COLUMN "liquidacionId";

