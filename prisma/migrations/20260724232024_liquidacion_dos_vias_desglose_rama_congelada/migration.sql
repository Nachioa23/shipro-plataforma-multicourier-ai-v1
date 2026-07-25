-- CreateEnum
CREATE TYPE "EstadoLiquidacion" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'LIQUIDADO', 'OBSERVADO', 'ANULADO', 'NO_APLICA');

-- CreateEnum
CREATE TYPE "TipoLiquidacion" AS ENUM ('FEE', 'LOGISTICA');

-- AlterTable
ALTER TABLE "FinanzasEnvio" ADD COLUMN     "estadoLiquidacionFee" "EstadoLiquidacion" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "estadoLiquidacionLogistica" "EstadoLiquidacion" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "fechaDevolucionLogistica" TIMESTAMP(3),
ADD COLUMN     "feeNetoFacturado" DECIMAL(12,2),
ADD COLUMN     "ivaFacturado" DECIMAL(12,2),
ADD COLUMN     "liquidacionFeeId" INTEGER,
ADD COLUMN     "liquidacionLogisticaId" INTEGER,
ADD COLUMN     "logisticaDevuelta" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logisticaNetaFacturada" DECIMAL(12,2),
ADD COLUMN     "periodoLogistica" TEXT,
ADD COLUMN     "ramaCongelada" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LiquidacionMensual" ADD COLUMN     "tipo" "TipoLiquidacion" NOT NULL DEFAULT 'LOGISTICA';

-- CreateIndex
CREATE INDEX "Envio_empresaId_fechaImpresion_idx" ON "Envio"("empresaId", "fechaImpresion");

-- CreateIndex
CREATE INDEX "FinanzasEnvio_estadoLiquidacionLogistica_logisticaDevuelta_idx" ON "FinanzasEnvio"("estadoLiquidacionLogistica", "logisticaDevuelta");

-- CreateIndex
CREATE INDEX "FinanzasEnvio_periodoLogistica_idx" ON "FinanzasEnvio"("periodoLogistica");

-- CreateIndex
CREATE INDEX "FinanzasEnvio_facturaCourierRef_idx" ON "FinanzasEnvio"("facturaCourierRef");

-- CreateIndex
CREATE INDEX "MovimientoFinanciero_empresaId_fecha_idx" ON "MovimientoFinanciero"("empresaId", "fecha");

-- AddForeignKey
ALTER TABLE "FinanzasEnvio" ADD CONSTRAINT "FinanzasEnvio_liquidacionFeeId_fkey" FOREIGN KEY ("liquidacionFeeId") REFERENCES "LiquidacionMensual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanzasEnvio" ADD CONSTRAINT "FinanzasEnvio_liquidacionLogisticaId_fkey" FOREIGN KEY ("liquidacionLogisticaId") REFERENCES "LiquidacionMensual"("id") ON DELETE SET NULL ON UPDATE CASCADE;
