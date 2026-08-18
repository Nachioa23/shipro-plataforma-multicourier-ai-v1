-- AlterTable
ALTER TABLE "Envio" ADD COLUMN     "tiendanubeFulfillmentOrderId" TEXT,
ADD COLUMN     "tiendanubeStoreId" INTEGER;

-- CreateTable
CREATE TABLE "EtiquetaTiendanube" (
    "id" SERIAL NOT NULL,
    "envioId" INTEGER NOT NULL,
    "tiendaTiendanubeId" INTEGER NOT NULL,
    "labelId" TEXT NOT NULL,
    "fulfillmentOrderId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'STARTED',
    "esProvisoria" BOOLEAN NOT NULL DEFAULT false,
    "documentoUrl" TEXT,
    "trackingAsociado" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtiquetaTiendanube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EtiquetaTiendanube_labelId_key" ON "EtiquetaTiendanube"("labelId");

-- CreateIndex
CREATE INDEX "EtiquetaTiendanube_envioId_idx" ON "EtiquetaTiendanube"("envioId");

-- CreateIndex
CREATE INDEX "EtiquetaTiendanube_fulfillmentOrderId_idx" ON "EtiquetaTiendanube"("fulfillmentOrderId");

-- CreateIndex
CREATE INDEX "EtiquetaTiendanube_tiendaTiendanubeId_idx" ON "EtiquetaTiendanube"("tiendaTiendanubeId");

-- CreateIndex
CREATE INDEX "Envio_tiendanubeFulfillmentOrderId_idx" ON "Envio"("tiendanubeFulfillmentOrderId");

-- AddForeignKey
ALTER TABLE "EtiquetaTiendanube" ADD CONSTRAINT "EtiquetaTiendanube_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtiquetaTiendanube" ADD CONSTRAINT "EtiquetaTiendanube_tiendaTiendanubeId_fkey" FOREIGN KEY ("tiendaTiendanubeId") REFERENCES "TiendaTiendanube"("id") ON DELETE CASCADE ON UPDATE CASCADE;
