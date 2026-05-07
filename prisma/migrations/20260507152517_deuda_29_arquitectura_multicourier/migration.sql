-- ==========================================================================
-- DEUDA 29 — Arquitectura Multicourier
-- Ver docs/ARQUITECTURA-MULTICOURIER.md
-- ==========================================================================

-- ETAPA 1 — Limpieza de couriers fantasma "Moova" (id=3) y "Javit" (id=4).
-- Verificación previa (2026-05-07): 0 envíos / nomencladores / metricasSLA /
-- encuestasNPS / SlaCourier los referencian. Solo había 2 filas inactivas en
-- CredencialCourier. Eliminar antes del schema reshape para evitar referencias
-- huérfanas en las tablas que se redefinen.
DELETE FROM "CredencialCourier" WHERE "nombreCourier" IN ('Moova', 'Javit');
DELETE FROM "Courier" WHERE "id" IN (3, 4);

-- ETAPA 2 — Migración pickup → mismo_courier.
-- Las 4 filas restantes de CredencialCourier (Andreani, Mocis × empresa 2)
-- tienen courierRecolector = "pickup". El schema reshape de abajo NO copia
-- el valor del courierRecolector legacy a la nueva columna modoFirstMile,
-- porque las columnas tienen nombres distintos. Como modoFirstMile tiene
-- DEFAULT 'mismo_courier', cada fila resultante hereda el valor correcto.
-- Este UPDATE queda como documentación explícita del mapeo intencional.
UPDATE "CredencialCourier" SET "courierRecolector" = 'mismo_courier' WHERE "courierRecolector" = 'pickup';

-- ETAPA 3 — Schema reshape (auto-generado por Prisma a partir del cambio en schema.prisma)

-- CreateTable
CREATE TABLE "SucursalCourier" (
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
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "eliminada" BOOLEAN NOT NULL DEFAULT false,
    "fechaUltimaConfirmacion" DATETIME,
    "metadatosJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SucursalCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DepositoSucursalPreferida" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "sucursalCourierId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepositoSucursalPreferida_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DepositoSucursalPreferida_sucursalCourierId_fkey" FOREIGN KEY ("sucursalCourierId") REFERENCES "SucursalCourier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TramoEnvio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "envioId" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "trackingExterno" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "estadoCrudoUltimo" TEXT,
    "sucursalOrigenId" INTEGER,
    "sucursalDestinoId" INTEGER,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaInicio" DATETIME,
    "fechaFin" DATETIME,
    "metadatosJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TramoEnvio_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TramoEnvio_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TramoEnvio_sucursalOrigenId_fkey" FOREIGN KEY ("sucursalOrigenId") REFERENCES "SucursalCourier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TramoEnvio_sucursalDestinoId_fkey" FOREIGN KEY ("sucursalDestinoId") REFERENCES "SucursalCourier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CotizacionSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "depositoOrigenId" INTEGER NOT NULL,
    "destinoSnapshotJson" TEXT NOT NULL,
    "paqueteSnapshotJson" TEXT NOT NULL,
    "opcionesSnapshotJson" TEXT NOT NULL,
    "usadaEnEnvioId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MetricaCourierLatencia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "operacion" TEXT NOT NULL,
    "latenciaMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "envioId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricaCourierLatencia_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HistoricoCotizaciones" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "cpOrigen" TEXT NOT NULL,
    "cpDestino" TEXT NOT NULL,
    "pesoKg" REAL NOT NULL,
    "precio" REAL NOT NULL,
    "servicio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "puedeEntregarDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "puedeEntregarSucursal" BOOLEAN NOT NULL DEFAULT false,
    "aceptaDropOff" BOOLEAN NOT NULL DEFAULT false,
    "tieneSucursales" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaCambioMercaderia" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaSoloRetiro" BOOLEAN NOT NULL DEFAULT false,
    "aceptaInversaDropOff" BOOLEAN NOT NULL DEFAULT false,
    "timeoutCotizacionMs" INTEGER NOT NULL DEFAULT 7000
);
INSERT INTO "new_Courier" ("activo", "contactoComercial", "emailSoporte", "id", "logoUrl", "nombre", "telefonoSoporte") SELECT "activo", "contactoComercial", "emailSoporte", "id", "logoUrl", "nombre", "telefonoSoporte" FROM "Courier";
DROP TABLE "Courier";
ALTER TABLE "new_Courier" RENAME TO "Courier";
CREATE UNIQUE INDEX "Courier_nombre_key" ON "Courier"("nombre");
CREATE TABLE "new_CredencialCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "nombreCourier" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "usaCredencialesPropias" BOOLEAN NOT NULL DEFAULT true,
    "credencialesJson" TEXT,
    "tipoCuenta" TEXT,
    "modoFirstMile" TEXT NOT NULL DEFAULT 'mismo_courier',
    "courierRecolectorId" INTEGER,
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
    "modeloAHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Empresa" ("activo", "apiKey", "apiKeyActiva", "apiKeyCreadaEn", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "nombre", "ordenamientoDefault", "saldoActivo") SELECT "activo", "apiKey", "apiKeyActiva", "apiKeyCreadaEn", "createdAt", "cuit", "id", "limiteDescubierto", "modalidadPago", "nombre", "ordenamientoDefault", "saldoActivo" FROM "Empresa";
DROP TABLE "Empresa";
ALTER TABLE "new_Empresa" RENAME TO "Empresa";
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");
CREATE UNIQUE INDEX "Empresa_apiKey_key" ON "Empresa"("apiKey");
CREATE TABLE "new_Envio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackingNumber" TEXT NOT NULL,
    "diasPrometidosCheckout" INTEGER,
    "numeroOrden" TEXT,
    "tipoOrigen" TEXT NOT NULL DEFAULT 'recoleccion_courier',
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
INSERT INTO "new_Envio" ("courierId", "depositoId", "destinoId", "diasPrometidosCheckout", "empresaId", "estadoActual", "estadoLiquidacion", "etiquetaUrl", "fechaColecta", "fechaEntrega", "fechaImpresion", "finanzasId", "fragil", "id", "liquidacionId", "manifiestoId", "modalidad", "numeroOrden", "ordenExternaId", "origenId", "pesoFacturado", "pesoReal", "pesoVolumetrico", "servicioId", "tipo", "trackingNumber") SELECT "courierId", "depositoId", "destinoId", "diasPrometidosCheckout", "empresaId", "estadoActual", "estadoLiquidacion", "etiquetaUrl", "fechaColecta", "fechaEntrega", "fechaImpresion", "finanzasId", "fragil", "id", "liquidacionId", "manifiestoId", "modalidad", "numeroOrden", "ordenExternaId", "origenId", "pesoFacturado", "pesoReal", "pesoVolumetrico", "servicioId", "tipo", "trackingNumber" FROM "Envio";
DROP TABLE "Envio";
ALTER TABLE "new_Envio" RENAME TO "Envio";
CREATE UNIQUE INDEX "Envio_trackingNumber_key" ON "Envio"("trackingNumber");
CREATE UNIQUE INDEX "Envio_ordenExternaId_key" ON "Envio"("ordenExternaId");
CREATE UNIQUE INDEX "Envio_finanzasId_key" ON "Envio"("finanzasId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SucursalCourier_courierId_idx" ON "SucursalCourier"("courierId");

-- CreateIndex
CREATE INDEX "SucursalCourier_latitud_longitud_idx" ON "SucursalCourier"("latitud", "longitud");

-- CreateIndex
CREATE INDEX "SucursalCourier_courierId_codigoPostal_idx" ON "SucursalCourier"("courierId", "codigoPostal");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalCourier_courierId_idExterno_key" ON "SucursalCourier"("courierId", "idExterno");

-- CreateIndex
CREATE UNIQUE INDEX "DepositoSucursalPreferida_depositoId_courierId_key" ON "DepositoSucursalPreferida"("depositoId", "courierId");

-- CreateIndex
CREATE INDEX "TramoEnvio_envioId_idx" ON "TramoEnvio"("envioId");

-- CreateIndex
CREATE INDEX "TramoEnvio_trackingExterno_idx" ON "TramoEnvio"("trackingExterno");

-- CreateIndex
CREATE INDEX "TramoEnvio_estadoActual_idx" ON "TramoEnvio"("estadoActual");

-- CreateIndex
CREATE UNIQUE INDEX "TramoEnvio_envioId_orden_key" ON "TramoEnvio"("envioId", "orden");

-- CreateIndex
CREATE INDEX "MetricaCourierLatencia_courierId_operacion_idx" ON "MetricaCourierLatencia"("courierId", "operacion");

-- CreateIndex
CREATE INDEX "MetricaCourierLatencia_createdAt_idx" ON "MetricaCourierLatencia"("createdAt");

-- CreateIndex
CREATE INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_idx" ON "HistoricoCotizaciones"("courierId", "cpOrigen", "cpDestino");

-- CreateIndex
CREATE INDEX "HistoricoCotizaciones_createdAt_idx" ON "HistoricoCotizaciones"("createdAt");

