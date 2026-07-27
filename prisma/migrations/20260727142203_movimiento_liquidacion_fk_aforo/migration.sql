-- AlterTable
ALTER TABLE "MovimientoFinanciero" ADD COLUMN     "liquidacionId" INTEGER;

-- CreateIndex
CREATE INDEX "MovimientoFinanciero_liquidacionId_idx" ON "MovimientoFinanciero"("liquidacionId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoFinanciero_liquidacionId_envioId_key" ON "MovimientoFinanciero"("liquidacionId", "envioId");

-- AddForeignKey
ALTER TABLE "MovimientoFinanciero" ADD CONSTRAINT "MovimientoFinanciero_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionMensual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

