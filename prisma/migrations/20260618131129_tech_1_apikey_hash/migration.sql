/*
  Warnings:

  - You are about to drop the column `apiKey` on the `Empresa` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Empresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyHash" TEXT,
    "apiKeyUltimos4" TEXT,
    "apiKeyActiva" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyCreadaEn" DATETIME,
    "saldoActivo" REAL NOT NULL DEFAULT 0.0,
    "modalidadPago" TEXT NOT NULL DEFAULT 'POSTPAGO',
    "limiteDescubierto" REAL NOT NULL DEFAULT 0.0,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "modeloAHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Empresa" ("activo", "apiKeyActiva", "apiKeyCreadaEn", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "modeloAHabilitado", "nombre", "ordenamientoDefault", "saldoActivo") SELECT "activo", "apiKeyActiva", "apiKeyCreadaEn", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "modeloAHabilitado", "nombre", "ordenamientoDefault", "saldoActivo" FROM "Empresa";
DROP TABLE "Empresa";
ALTER TABLE "new_Empresa" RENAME TO "Empresa";
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");
CREATE UNIQUE INDEX "Empresa_apiKeyHash_key" ON "Empresa"("apiKeyHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
