-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deposito" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "esPredeterminado" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "contactoNombre" TEXT NOT NULL,
    "contactoTelefono" TEXT NOT NULL,
    "contactoEmail" TEXT,
    "direccionCalle" TEXT NOT NULL,
    "direccionAltura" TEXT NOT NULL,
    "direccionPiso" TEXT,
    "direccionDpto" TEXT,
    "codigoPostal" TEXT NOT NULL,
    "localidad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'Argentina',
    "latitud" REAL,
    "longitud" REAL,
    "ultimaGeocodificacion" DATETIME,
    "horarios" TEXT NOT NULL,
    "observaciones" TEXT,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "courierRecolectorId" INTEGER,
    CONSTRAINT "Deposito_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deposito_courierRecolectorId_fkey" FOREIGN KEY ("courierRecolectorId") REFERENCES "Courier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Deposito" ("activo", "codigoPostal", "contactoEmail", "contactoNombre", "contactoTelefono", "createdAt", "direccionAltura", "direccionCalle", "direccionDpto", "direccionPiso", "eliminado", "empresaId", "esPredeterminado", "horarios", "id", "latitud", "localidad", "longitud", "nombre", "observaciones", "pais", "provincia", "ultimaGeocodificacion", "updatedAt") SELECT "activo", "codigoPostal", "contactoEmail", "contactoNombre", "contactoTelefono", "createdAt", "direccionAltura", "direccionCalle", "direccionDpto", "direccionPiso", "eliminado", "empresaId", "esPredeterminado", "horarios", "id", "latitud", "localidad", "longitud", "nombre", "observaciones", "pais", "provincia", "ultimaGeocodificacion", "updatedAt" FROM "Deposito";
DROP TABLE "Deposito";
ALTER TABLE "new_Deposito" RENAME TO "Deposito";
CREATE INDEX "Deposito_empresaId_idx" ON "Deposito"("empresaId");
CREATE TABLE "new_DepositoCourierConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "dropOffCliente" BOOLEAN NOT NULL DEFAULT false,
    "recogeViaConsolidador" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepositoCourierConfig_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoCourierConfig_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DepositoCourierConfig" ("courierId", "createdAt", "depositoId", "id", "updatedAt") SELECT "courierId", "createdAt", "depositoId", "id", "updatedAt" FROM "DepositoCourierConfig";
DROP TABLE "DepositoCourierConfig";
ALTER TABLE "new_DepositoCourierConfig" RENAME TO "DepositoCourierConfig";
CREATE INDEX "DepositoCourierConfig_courierId_idx" ON "DepositoCourierConfig"("courierId");
CREATE UNIQUE INDEX "DepositoCourierConfig_depositoId_courierId_key" ON "DepositoCourierConfig"("depositoId", "courierId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

