-- CreateTable
CREATE TABLE "TokenSetupApiKey" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenSetupApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenSetupApiKey_token_key" ON "TokenSetupApiKey"("token");

-- CreateIndex
CREATE INDEX "TokenSetupApiKey_empresaId_idx" ON "TokenSetupApiKey"("empresaId");

-- AddForeignKey
ALTER TABLE "TokenSetupApiKey" ADD CONSTRAINT "TokenSetupApiKey_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
