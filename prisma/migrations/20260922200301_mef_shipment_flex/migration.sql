-- CreateTable
CREATE TABLE "ShipmentFlex" (
    "id" SERIAL NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "empresaId" INTEGER,
    "mlUserId" BIGINT NOT NULL,
    "cpDestino" TEXT,
    "estadoShipment" TEXT,
    "payloadRaw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentFlex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentFlex_shipmentId_key" ON "ShipmentFlex"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentFlex_empresaId_idx" ON "ShipmentFlex"("empresaId");

-- CreateIndex
CREATE INDEX "ShipmentFlex_cpDestino_idx" ON "ShipmentFlex"("cpDestino");

-- CreateIndex
CREATE INDEX "ShipmentFlex_mlUserId_idx" ON "ShipmentFlex"("mlUserId");

-- AddForeignKey
ALTER TABLE "ShipmentFlex" ADD CONSTRAINT "ShipmentFlex_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
