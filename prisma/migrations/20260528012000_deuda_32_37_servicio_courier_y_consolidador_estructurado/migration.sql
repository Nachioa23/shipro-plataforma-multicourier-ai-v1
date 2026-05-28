-- AlterTable
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidadorCalle" TEXT;
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidadorCp" TEXT;
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidadorLocalidad" TEXT;
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidadorNumero" TEXT;
ALTER TABLE "Courier" ADD COLUMN "cpDepositoConsolidadorProvincia" TEXT;

-- CreateTable
CREATE TABLE "ServicioCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "codigoServicio" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "ordenVisual" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "capacidadTecnicaMapeada" TEXT,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaActualizacion" DATETIME NOT NULL,
    CONSTRAINT "ServicioCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServicioCourier_courierId_activo_idx" ON "ServicioCourier"("courierId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioCourier_courierId_codigoServicio_key" ON "ServicioCourier"("courierId", "codigoServicio");
