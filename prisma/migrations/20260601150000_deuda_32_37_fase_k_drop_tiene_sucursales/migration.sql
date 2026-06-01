-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Courier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "emailSoporte" TEXT,
    "telefonoSoporte" TEXT,
    "contactoComercial" TEXT,
    "logoUrl" TEXT,
    "puedeRecogerDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "puedeConsolidar" BOOLEAN NOT NULL DEFAULT false,
    "cpDepositoConsolidador" TEXT,
    "cpDepositoConsolidadorCalle" TEXT,
    "cpDepositoConsolidadorNumero" TEXT,
    "cpDepositoConsolidadorCp" TEXT,
    "cpDepositoConsolidadorLocalidad" TEXT,
    "cpDepositoConsolidadorProvincia" TEXT,
    "puedeEntregarDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "puedeEntregarSucursal" BOOLEAN NOT NULL DEFAULT false,
    "aceptaDropOff" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaCambioMercaderia" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaSoloRetiro" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaDropOff" BOOLEAN NOT NULL DEFAULT false,
    "timeoutCotizacionMs" INTEGER NOT NULL DEFAULT 7000
);
INSERT INTO "new_Courier" ("aceptaDropOff", "aceptaInversaCambioMercaderia", "aceptaInversaDropOff", "aceptaInversaSoloRetiro", "activo", "contactoComercial", "cpDepositoConsolidador", "cpDepositoConsolidadorCalle", "cpDepositoConsolidadorCp", "cpDepositoConsolidadorLocalidad", "cpDepositoConsolidadorNumero", "cpDepositoConsolidadorProvincia", "emailSoporte", "id", "logoUrl", "nombre", "puedeConsolidar", "puedeEntregarDomicilio", "puedeEntregarSucursal", "puedeRecogerDomicilio", "telefonoSoporte", "timeoutCotizacionMs") SELECT "aceptaDropOff", "aceptaInversaCambioMercaderia", "aceptaInversaDropOff", "aceptaInversaSoloRetiro", "activo", "contactoComercial", "cpDepositoConsolidador", "cpDepositoConsolidadorCalle", "cpDepositoConsolidadorCp", "cpDepositoConsolidadorLocalidad", "cpDepositoConsolidadorNumero", "cpDepositoConsolidadorProvincia", "emailSoporte", "id", "logoUrl", "nombre", "puedeConsolidar", "puedeEntregarDomicilio", "puedeEntregarSucursal", "puedeRecogerDomicilio", "telefonoSoporte", "timeoutCotizacionMs" FROM "Courier";
DROP TABLE "Courier";
ALTER TABLE "new_Courier" RENAME TO "Courier";
CREATE UNIQUE INDEX "Courier_nombre_key" ON "Courier"("nombre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

