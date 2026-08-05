/*
  Warnings:

  - A unique constraint covering the columns `[empresaId,idempotencyKey]` on the table `Envio` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Envio" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Envio_empresaId_idempotencyKey_key" ON "Envio"("empresaId", "idempotencyKey");
