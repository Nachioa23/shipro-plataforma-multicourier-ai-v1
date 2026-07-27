-- DropIndex
DROP INDEX "MovimientoFinanciero_liquidacionId_envioId_key";

-- AlterTable
ALTER TABLE "MovimientoFinanciero" ADD COLUMN     "conciliacionRunId" INTEGER;

-- CreateIndex
CREATE INDEX "MovimientoFinanciero_conciliacionRunId_idx" ON "MovimientoFinanciero"("conciliacionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoFinanciero_liquidacionId_envioId_tipo_key" ON "MovimientoFinanciero"("liquidacionId", "envioId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoFinanciero_conciliacionRunId_envioId_tipo_key" ON "MovimientoFinanciero"("conciliacionRunId", "envioId", "tipo");

-- AddForeignKey
ALTER TABLE "MovimientoFinanciero" ADD CONSTRAINT "MovimientoFinanciero_conciliacionRunId_fkey" FOREIGN KEY ("conciliacionRunId") REFERENCES "ConciliacionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
