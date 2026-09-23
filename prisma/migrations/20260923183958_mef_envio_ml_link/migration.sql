-- AlterTable
ALTER TABLE "Envio" ADD COLUMN     "mercadolibreOrderId" TEXT,
ADD COLUMN     "mercadolibreShipmentId" TEXT;

-- CreateIndex
CREATE INDEX "Envio_mercadolibreShipmentId_idx" ON "Envio"("mercadolibreShipmentId");
