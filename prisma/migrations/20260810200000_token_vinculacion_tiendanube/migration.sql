-- CreateTable
CREATE TABLE "TokenVinculacionTiendanube" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenVinculacionTiendanube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenVinculacionTiendanube_token_key" ON "TokenVinculacionTiendanube"("token");

-- CreateIndex
CREATE INDEX "TokenVinculacionTiendanube_empresaId_idx" ON "TokenVinculacionTiendanube"("empresaId");

-- AddForeignKey
ALTER TABLE "TokenVinculacionTiendanube" ADD CONSTRAINT "TokenVinculacionTiendanube_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

