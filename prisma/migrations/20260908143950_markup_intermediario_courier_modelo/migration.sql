-- CreateTable
CREATE TABLE "MarkupIntermediarioCourier" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "valorPorcentaje" DECIMAL(12,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkupIntermediarioCourier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkupIntermediarioCourier_courierId_activo_idx" ON "MarkupIntermediarioCourier"("courierId", "activo");

-- AddForeignKey
ALTER TABLE "MarkupIntermediarioCourier" ADD CONSTRAINT "MarkupIntermediarioCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
