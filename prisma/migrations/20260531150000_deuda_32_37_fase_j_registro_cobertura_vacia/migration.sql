-- CreateTable
CREATE TABLE "RegistroCoberturaVacia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpDestino" TEXT NOT NULL,
    "pesoKg" REAL NOT NULL,
    "largoCm" REAL,
    "anchoCm" REAL,
    "altoCm" REAL,
    "origen" TEXT,
    "empresaId" INTEGER,
    CONSTRAINT "RegistroCoberturaVacia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RegistroCoberturaVacia_fecha_idx" ON "RegistroCoberturaVacia"("fecha");

-- CreateIndex
CREATE INDEX "RegistroCoberturaVacia_cpDestino_idx" ON "RegistroCoberturaVacia"("cpDestino");

