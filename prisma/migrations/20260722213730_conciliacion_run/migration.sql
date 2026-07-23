-- CreateTable
CREATE TABLE "ConciliacionRun" (
    "id" SERIAL NOT NULL,
    "referenciaFactura" TEXT NOT NULL,
    "ivaDeclarado" TEXT NOT NULL,
    "cantidadEnvios" INTEGER NOT NULL,
    "usuarioEmail" TEXT,
    "snapshot" JSONB NOT NULL,
    "revertida" BOOLEAN NOT NULL DEFAULT false,
    "fechaReversion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConciliacionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConciliacionRun_referenciaFactura_idx" ON "ConciliacionRun"("referenciaFactura");

-- CreateIndex
CREATE INDEX "ConciliacionRun_createdAt_idx" ON "ConciliacionRun"("createdAt");
