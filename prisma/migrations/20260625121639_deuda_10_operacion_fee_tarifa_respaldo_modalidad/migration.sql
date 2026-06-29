-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN "tarifaPlanaRespaldo" REAL;

-- AlterTable
ALTER TABLE "HistoricoCotizaciones" ADD COLUMN "modalidad" TEXT;

-- CreateTable
CREATE TABLE "OperacionFee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'FIJO',
    "valor" REAL NOT NULL,
    "vigenteDesde" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" DATETIME,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OperacionFee_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OperacionFee_empresaId_activo_idx" ON "OperacionFee"("empresaId", "activo");

-- CreateIndex
CREATE INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_modalidad_idx" ON "HistoricoCotizaciones"("courierId", "cpOrigen", "cpDestino", "modalidad");
