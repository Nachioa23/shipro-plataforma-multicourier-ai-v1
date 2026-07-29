-- AlterTable
ALTER TABLE "LiquidacionMensual" ADD COLUMN     "numeroFacturaExterna" TEXT;

-- CreateIndex
CREATE INDEX "LiquidacionMensual_numeroFacturaExterna_idx" ON "LiquidacionMensual"("numeroFacturaExterna");
