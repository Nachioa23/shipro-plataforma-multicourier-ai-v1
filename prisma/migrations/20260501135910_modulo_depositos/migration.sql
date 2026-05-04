-- CreateTable
CREATE TABLE "Deposito" (
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
    "horarios" TEXT NOT NULL,
    "observaciones" TEXT,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deposito_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Envio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackingNumber" TEXT NOT NULL,
    "trackingFirstMile" TEXT,
    "diasPrometidosCheckout" INTEGER,
    "numeroOrden" TEXT,
    "etiquetaUrl" TEXT,
    "pesoReal" REAL NOT NULL,
    "pesoVolumetrico" REAL,
    "pesoFacturado" REAL,
    "fragil" BOOLEAN NOT NULL DEFAULT false,
    "tipo" TEXT,
    "modalidad" TEXT NOT NULL DEFAULT 'Estándar',
    "servicioId" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'IMPRESO',
    "estadoLiquidacion" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "liquidacionId" INTEGER,
    "fechaImpresion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaColecta" DATETIME,
    "fechaEntrega" DATETIME,
    "empresaId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "origenId" INTEGER,
    "depositoId" INTEGER,
    "destinoId" INTEGER,
    "ordenExternaId" INTEGER,
    "finanzasId" INTEGER,
    "manifiestoId" INTEGER,
    CONSTRAINT "Envio_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionMensual" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Direccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "Direccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_ordenExternaId_fkey" FOREIGN KEY ("ordenExternaId") REFERENCES "OrdenExterna" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_finanzasId_fkey" FOREIGN KEY ("finanzasId") REFERENCES "FinanzasEnvio" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_manifiestoId_fkey" FOREIGN KEY ("manifiestoId") REFERENCES "Manifiesto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Envio" ("courierId", "destinoId", "diasPrometidosCheckout", "empresaId", "estadoActual", "estadoLiquidacion", "etiquetaUrl", "fechaColecta", "fechaEntrega", "fechaImpresion", "finanzasId", "fragil", "id", "liquidacionId", "manifiestoId", "modalidad", "numeroOrden", "ordenExternaId", "origenId", "pesoFacturado", "pesoReal", "pesoVolumetrico", "servicioId", "tipo", "trackingFirstMile", "trackingNumber") SELECT "courierId", "destinoId", "diasPrometidosCheckout", "empresaId", "estadoActual", "estadoLiquidacion", "etiquetaUrl", "fechaColecta", "fechaEntrega", "fechaImpresion", "finanzasId", "fragil", "id", "liquidacionId", "manifiestoId", "modalidad", "numeroOrden", "ordenExternaId", "origenId", "pesoFacturado", "pesoReal", "pesoVolumetrico", "servicioId", "tipo", "trackingFirstMile", "trackingNumber" FROM "Envio";
DROP TABLE "Envio";
ALTER TABLE "new_Envio" RENAME TO "Envio";
CREATE UNIQUE INDEX "Envio_trackingNumber_key" ON "Envio"("trackingNumber");
CREATE UNIQUE INDEX "Envio_ordenExternaId_key" ON "Envio"("ordenExternaId");
CREATE UNIQUE INDEX "Envio_finanzasId_key" ON "Envio"("finanzasId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Deposito_empresaId_idx" ON "Deposito"("empresaId");
