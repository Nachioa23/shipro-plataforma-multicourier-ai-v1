-- CreateTable
CREATE TABLE "SucursalCourierCp" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sucursalCourierId" INTEGER NOT NULL,
    "codigoPostal" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SucursalCourierCp_sucursalCourierId_fkey" FOREIGN KEY ("sucursalCourierId") REFERENCES "SucursalCourier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DepositoSucursalPreferida" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "sucursalCourierId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepositoSucursalPreferida_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoSucursalPreferida_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoSucursalPreferida_sucursalCourierId_fkey" FOREIGN KEY ("sucursalCourierId") REFERENCES "SucursalCourier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DepositoSucursalPreferida" ("courierId", "createdAt", "depositoId", "id", "sucursalCourierId", "updatedAt") SELECT "courierId", "createdAt", "depositoId", "id", "sucursalCourierId", "updatedAt" FROM "DepositoSucursalPreferida";
DROP TABLE "DepositoSucursalPreferida";
ALTER TABLE "new_DepositoSucursalPreferida" RENAME TO "DepositoSucursalPreferida";
CREATE INDEX "DepositoSucursalPreferida_courierId_idx" ON "DepositoSucursalPreferida"("courierId");
CREATE UNIQUE INDEX "DepositoSucursalPreferida_depositoId_courierId_key" ON "DepositoSucursalPreferida"("depositoId", "courierId");
CREATE TABLE "new_SucursalCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "idExterno" TEXT NOT NULL,
    "codigo" TEXT,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'sucursal_propia',
    "direccionCalle" TEXT,
    "direccionAltura" TEXT,
    "direccionPiso" TEXT,
    "direccionDpto" TEXT,
    "codigoPostal" TEXT NOT NULL,
    "localidad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'Argentina',
    "latitud" REAL,
    "longitud" REAL,
    "aceptaAdmision" BOOLEAN NOT NULL DEFAULT false,
    "aceptaEntrega" BOOLEAN NOT NULL DEFAULT false,
    "aceptaDevolucion" BOOLEAN NOT NULL DEFAULT false,
    "aceptaB2B" BOOLEAN NOT NULL DEFAULT false,
    "aceptaB2C" BOOLEAN NOT NULL DEFAULT true,
    "tieneBuzonInteligente" BOOLEAN NOT NULL DEFAULT false,
    "horariosJson" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "seHaceAtencionAlCliente" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "eliminada" BOOLEAN NOT NULL DEFAULT false,
    "fechaUltimaConfirmacion" DATETIME,
    "metadatosJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SucursalCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SucursalCourier" ("aceptaAdmision", "aceptaB2B", "aceptaB2C", "aceptaDevolucion", "aceptaEntrega", "activa", "codigo", "codigoPostal", "courierId", "createdAt", "direccionAltura", "direccionCalle", "direccionDpto", "direccionPiso", "eliminada", "email", "fechaUltimaConfirmacion", "horariosJson", "id", "idExterno", "latitud", "localidad", "longitud", "metadatosJson", "nombre", "pais", "provincia", "telefono", "tieneBuzonInteligente", "tipo", "updatedAt") SELECT "aceptaAdmision", "aceptaB2B", "aceptaB2C", "aceptaDevolucion", "aceptaEntrega", "activa", "codigo", "codigoPostal", "courierId", "createdAt", "direccionAltura", "direccionCalle", "direccionDpto", "direccionPiso", "eliminada", "email", "fechaUltimaConfirmacion", "horariosJson", "id", "idExterno", "latitud", "localidad", "longitud", "metadatosJson", "nombre", "pais", "provincia", "telefono", "tieneBuzonInteligente", "tipo", "updatedAt" FROM "SucursalCourier";
DROP TABLE "SucursalCourier";
ALTER TABLE "new_SucursalCourier" RENAME TO "SucursalCourier";
CREATE INDEX "SucursalCourier_courierId_idx" ON "SucursalCourier"("courierId");
CREATE INDEX "SucursalCourier_latitud_longitud_idx" ON "SucursalCourier"("latitud", "longitud");
CREATE INDEX "SucursalCourier_courierId_codigoPostal_idx" ON "SucursalCourier"("courierId", "codigoPostal");
CREATE UNIQUE INDEX "SucursalCourier_courierId_idExterno_key" ON "SucursalCourier"("courierId", "idExterno");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SucursalCourierCp_sucursalCourierId_idx" ON "SucursalCourierCp"("sucursalCourierId");

-- CreateIndex
CREATE INDEX "SucursalCourierCp_codigoPostal_idx" ON "SucursalCourierCp"("codigoPostal");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalCourierCp_sucursalCourierId_codigoPostal_key" ON "SucursalCourierCp"("sucursalCourierId", "codigoPostal");
