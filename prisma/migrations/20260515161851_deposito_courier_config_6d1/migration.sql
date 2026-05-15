-- AlterTable
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidador" TEXT;

-- CreateTable
CREATE TABLE "DepositoCourierConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "modoFirstMile" TEXT NOT NULL DEFAULT 'mismo_courier',
    "courierRecolectorId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepositoCourierConfig_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoCourierConfig_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoCourierConfig_courierRecolectorId_fkey" FOREIGN KEY ("courierRecolectorId") REFERENCES "Courier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DepositoCourierConfig_courierId_idx" ON "DepositoCourierConfig"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositoCourierConfig_depositoId_courierId_key" ON "DepositoCourierConfig"("depositoId", "courierId");
