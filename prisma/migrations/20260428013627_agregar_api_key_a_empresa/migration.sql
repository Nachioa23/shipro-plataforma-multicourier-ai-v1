-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Empresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "apiKey" TEXT,
    "apiKeyActiva" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyCreadaEn" DATETIME,
    "saldoActivo" REAL NOT NULL DEFAULT 0.0,
    "modalidadPago" TEXT NOT NULL DEFAULT 'POSTPAGO',
    "limiteDescubierto" REAL NOT NULL DEFAULT 0.0,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Empresa" ("activo", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "nombre", "ordenamientoDefault", "saldoActivo") SELECT "activo", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "nombre", "ordenamientoDefault", "saldoActivo" FROM "Empresa";
DROP TABLE "Empresa";
ALTER TABLE "new_Empresa" RENAME TO "Empresa";
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");
CREATE UNIQUE INDEX "Empresa_apiKey_key" ON "Empresa"("apiKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
