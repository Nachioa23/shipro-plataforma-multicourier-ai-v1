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
    "suspendida" BOOLEAN NOT NULL DEFAULT false,
    "fechaSuspension" DATETIME,
    "fechaReactivacion" DATETIME,
    "direccionFiscalCalle" TEXT,
    "direccionFiscalAltura" TEXT,
    "direccionFiscalCP" TEXT,
    "direccionFiscalLocalidad" TEXT,
    "direccionFiscalProvincia" TEXT,
    "notasInternas" TEXT,
    "onboardingCompletado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Empresa" ("activo", "apiKeyActiva", "apiKeyCreadaEn", "apiKeyHash", "apiKeyUltimos4", "createdAt", "cuit", "fechaReactivacion", "fechaSuspension", "id", "limiteDescubierto", "modalidadPago", "modeloAHabilitado", "nombre", "ordenamientoDefault", "saldoActivo", "suspendida") SELECT "activo", "apiKeyActiva", "apiKeyCreadaEn", "apiKeyHash", "apiKeyUltimos4", "createdAt", "cuit", "fechaReactivacion", "fechaSuspension", "id", "limiteDescubierto", "modalidadPago", "modeloAHabilitado", "nombre", "ordenamientoDefault", "saldoActivo", "suspendida" FROM "Empresa";
DROP TABLE "Empresa";
ALTER TABLE "new_Empresa" RENAME TO "Empresa";
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");
CREATE UNIQUE INDEX "Empresa_apiKeyHash_key" ON "Empresa"("apiKeyHash");
CREATE TABLE "new_Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'operador_cliente',
    "telefono" TEXT,
    "passwordTemporal" BOOLEAN NOT NULL DEFAULT false,
    "empresaId" INTEGER,
    CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Usuario" ("email", "empresaId", "id", "nombre", "password", "rol") SELECT "email", "empresaId", "id", "nombre", "password", "rol" FROM "Usuario";
DROP TABLE "Usuario";
ALTER TABLE "new_Usuario" RENAME TO "Usuario";
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
