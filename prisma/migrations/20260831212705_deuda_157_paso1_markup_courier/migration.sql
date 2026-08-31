-- DEUDA 157 Paso 1 (2026-08-31): crea MarkupCourier (markup Shipro general por
-- courier, mirror de SmoCourier). Un % por courier, igual para todos los clientes.
-- Aditiva pura: CREATE TABLE + INDEX + FK. Cero cambios en tablas existentes.
-- El motor NO lo lee todavía — aislamiento del motor (Paso 2 lo conecta).

-- CreateTable
CREATE TABLE "MarkupCourier" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "valorPorcentaje" DECIMAL(12,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkupCourier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkupCourier_courierId_activo_idx" ON "MarkupCourier"("courierId", "activo");

-- AddForeignKey
ALTER TABLE "MarkupCourier" ADD CONSTRAINT "MarkupCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
