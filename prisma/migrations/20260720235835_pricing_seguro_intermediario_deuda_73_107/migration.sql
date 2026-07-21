-- AlterTable
ALTER TABLE "CredencialCourier" ADD COLUMN     "descuentoClienteSobreTarifa" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "quiereSeguroCourier" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FinanzasEnvio" ADD COLUMN     "descuentoClienteAplicado" DECIMAL(12,2),
ADD COLUMN     "markupIntermediarioAplicado" DECIMAL(12,2),
ADD COLUMN     "precioProveedorReal" DECIMAL(12,2),
ADD COLUMN     "seguroAplicado" DECIMAL(12,2),
ADD COLUMN     "tarifaCourierBase" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "CourierIntermediario" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "nombreIntermediario" TEXT NOT NULL,
    "markupPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "seguroFijoIntermediarioConIva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tarifaIncluyeIvaIntermediario" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierIntermediario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierIntermediario_courierId_activo_idx" ON "CourierIntermediario"("courierId", "activo");

-- AddForeignKey
ALTER TABLE "CourierIntermediario" ADD CONSTRAINT "CourierIntermediario_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
