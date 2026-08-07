-- CreateTable
CREATE TABLE "EnvioBulto" (
    "id" SERIAL NOT NULL,
    "envioId" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "pesoKg" DOUBLE PRECISION NOT NULL,
    "largoCm" DOUBLE PRECISION,
    "anchoCm" DOUBLE PRECISION,
    "altoCm" DOUBLE PRECISION,
    "valorDeclarado" DECIMAL(12,2),
    "trackingExterno" TEXT,
    "etiquetaUrl" TEXT,
    "numeroBulto" TEXT,
    "totalizador" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "estadoCrudoUltimo" TEXT,
    "pesoAforadoCourier" DOUBLE PRECISION,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioBulto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvioBulto_envioId_idx" ON "EnvioBulto"("envioId");

-- CreateIndex
CREATE INDEX "EnvioBulto_trackingExterno_idx" ON "EnvioBulto"("trackingExterno");

-- CreateIndex
CREATE INDEX "EnvioBulto_estadoActual_idx" ON "EnvioBulto"("estadoActual");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioBulto_envioId_orden_key" ON "EnvioBulto"("envioId", "orden");

-- AddForeignKey
ALTER TABLE "EnvioBulto" ADD CONSTRAINT "EnvioBulto_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

