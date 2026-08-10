-- CreateTable
CREATE TABLE "TiendaTiendanube" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "accessToken" TEXT,
    "shippingCarrierId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'instalada',
    "instaladaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desinstaladaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiendaTiendanube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TiendaTiendanube_storeId_key" ON "TiendaTiendanube"("storeId");

-- CreateIndex
CREATE INDEX "TiendaTiendanube_empresaId_idx" ON "TiendaTiendanube"("empresaId");

-- CreateIndex
CREATE INDEX "TiendaTiendanube_estado_idx" ON "TiendaTiendanube"("estado");

-- AddForeignKey
ALTER TABLE "TiendaTiendanube" ADD CONSTRAINT "TiendaTiendanube_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

