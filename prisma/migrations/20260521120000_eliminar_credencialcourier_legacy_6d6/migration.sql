-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CredencialCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "nombreCourier" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "usaCredencialesPropias" BOOLEAN NOT NULL DEFAULT true,
    "credencialesJson" TEXT,
    "tipoCuenta" TEXT,
    "ofreceDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "ofreceSucursal" BOOLEAN NOT NULL DEFAULT true,
    "tarifaIncluyeIva" BOOLEAN NOT NULL DEFAULT true,
    "ajusteTarifaPorcentaje" REAL NOT NULL DEFAULT 0.0,
    "markupFijo" REAL NOT NULL DEFAULT 0.0,
    "fechaCaducidadPromo" DATETIME,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "serviciosActivos" TEXT,
    "ordenamientoDomicilio" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "ordenamientoSucursal" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "requiereSeguro" BOOLEAN NOT NULL DEFAULT false,
    "slaPromedioHs" INTEGER NOT NULL DEFAULT 48,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CredencialCourier_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CredencialCourier" ("activo", "ajusteTarifaPorcentaje", "createdAt", "credencialesJson", "empresaId", "fechaCaducidadPromo", "id", "markupFijo", "nombreCourier", "ofreceDomicilio", "ofreceSucursal", "ordenamientoDefault", "ordenamientoDomicilio", "ordenamientoSucursal", "requiereSeguro", "serviciosActivos", "slaPromedioHs", "tarifaIncluyeIva", "tipoCuenta", "updatedAt", "usaCredencialesPropias") SELECT "activo", "ajusteTarifaPorcentaje", "createdAt", "credencialesJson", "empresaId", "fechaCaducidadPromo", "id", "markupFijo", "nombreCourier", "ofreceDomicilio", "ofreceSucursal", "ordenamientoDefault", "ordenamientoDomicilio", "ordenamientoSucursal", "requiereSeguro", "serviciosActivos", "slaPromedioHs", "tarifaIncluyeIva", "tipoCuenta", "updatedAt", "usaCredencialesPropias" FROM "CredencialCourier";
DROP TABLE "CredencialCourier";
ALTER TABLE "new_CredencialCourier" RENAME TO "CredencialCourier";
CREATE UNIQUE INDEX "CredencialCourier_empresaId_nombreCourier_key" ON "CredencialCourier"("empresaId", "nombreCourier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

