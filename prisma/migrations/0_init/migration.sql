-- CreateTable
CREATE TABLE "Empresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "saldoActivo" REAL NOT NULL DEFAULT 0.0,
    "modalidadPago" TEXT NOT NULL DEFAULT 'POSTPAGO',
    "limiteDescubierto" REAL NOT NULL DEFAULT 0.0,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'operador_cliente',
    "empresaId" INTEGER NOT NULL,
    CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "emailSoporte" TEXT,
    "telefonoSoporte" TEXT,
    "contactoComercial" TEXT,
    "logoUrl" TEXT
);

-- CreateTable
CREATE TABLE "CredencialCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "nombreCourier" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "usaCredencialesPropias" BOOLEAN NOT NULL DEFAULT true,
    "credencialesJson" TEXT,
    "courierRecolector" TEXT NOT NULL DEFAULT 'mismo_courier',
    "ofreceDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "ofreceSucursal" BOOLEAN NOT NULL DEFAULT true,
    "tarifaIncluyeIva" BOOLEAN NOT NULL DEFAULT true,
    "ajusteTarifaPorcentaje" REAL NOT NULL DEFAULT 0.0,
    "markupFijo" REAL NOT NULL DEFAULT 0.0,
    "fechaCaducidadPromo" DATETIME,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "serviciosActivos" TEXT,
    "tipoAlcance" TEXT NOT NULL DEFAULT 'NACIONAL',
    "provinciasCobertura" TEXT,
    "localidadesActivas" TEXT,
    "ordenamientoDomicilio" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "ordenamientoSucursal" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "requiereSeguro" BOOLEAN NOT NULL DEFAULT false,
    "slaPromedioHs" INTEGER NOT NULL DEFAULT 48,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CredencialCourier_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Direccion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT,
    "documento" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "cp" TEXT NOT NULL,
    "calle" TEXT,
    "altura" TEXT,
    "piso" TEXT,
    "dpto" TEXT,
    "localidad" TEXT,
    "provincia" TEXT,
    "pais" TEXT NOT NULL DEFAULT 'Argentina',
    "observacion" TEXT
);

-- CreateTable
CREATE TABLE "OrdenExterna" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "canal" TEXT,
    "idTienda" TEXT,
    "ordenId" TEXT,
    "referencia" TEXT,
    "mercadolibreShipmentId" TEXT
);

-- CreateTable
CREATE TABLE "FinanzasEnvio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "precioMostrado" REAL,
    "precioFactura" REAL,
    "porcentajePrecioFactura" REAL,
    "valorDeclarado" REAL,
    "precioProveedor" REAL,
    "costoCourierEsperado" REAL,
    "costoCourierFacturado" REAL,
    "estadoAuditoria" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "facturaCourierRef" TEXT,
    "pesoCobrado" REAL,
    "pesoAforado" REAL,
    "costoAforo" REAL,
    "fugaFinanciera" REAL DEFAULT 0.0,
    "courierSugerido" TEXT,
    "servicioSugerido" TEXT
);

-- CreateTable
CREATE TABLE "MovimientoFinanciero" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "saldoPosterior" REAL NOT NULL,
    "referencia" TEXT,
    "descripcion" TEXT,
    "envioId" INTEGER,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoFinanciero_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoFinanciero_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiquidacionMensual" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "montoTotal" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EMITIDA',
    "excelProformaUrl" TEXT,
    "facturaXubioUrl" TEXT,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiquidacionMensual_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Envio" (
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
    "destinoId" INTEGER,
    "ordenExternaId" INTEGER,
    "finanzasId" INTEGER,
    "manifiestoId" INTEGER,
    CONSTRAINT "Envio_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionMensual" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Direccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "Direccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_ordenExternaId_fkey" FOREIGN KEY ("ordenExternaId") REFERENCES "OrdenExterna" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_finanzasId_fkey" FOREIGN KEY ("finanzasId") REFERENCES "FinanzasEnvio" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_manifiestoId_fkey" FOREIGN KEY ("manifiestoId") REFERENCES "Manifiesto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventoTracking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "estado" TEXT NOT NULL,
    "observacion" TEXT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "envioId" INTEGER NOT NULL,
    CONSTRAINT "EventoTracking_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Nomenclador" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "estadoCrudo" TEXT NOT NULL,
    "codigoApi" TEXT,
    "estadoShipro" TEXT,
    "courierId" INTEGER NOT NULL,
    CONSTRAINT "Nomenclador_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketSoporte" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "observacion" TEXT,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" DATETIME,
    "envioId" INTEGER NOT NULL,
    CONSTRAINT "TicketSoporte_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditoriaSoporte" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accion" TEXT NOT NULL,
    "detalle" TEXT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmail" TEXT,
    "ticketId" INTEGER NOT NULL,
    CONSTRAINT "AuditoriaSoporte_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TicketSoporte" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditoriaCheckout" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tienda" TEXT NOT NULL,
    "comprador" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "direccionCruda" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "problemas" TEXT,
    "calle" TEXT,
    "altura" TEXT,
    "piso" TEXT,
    "dpto" TEXT,
    "cp" TEXT,
    "localidad" TEXT,
    "provincia" TEXT,
    "entrecalles" TEXT,
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Provincia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Localidad" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "provinciaId" INTEGER NOT NULL,
    CONSTRAINT "Localidad_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodigoPostal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Manifiesto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "numeroCorrelativo" INTEGER NOT NULL,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courier" TEXT NOT NULL,
    "cantidadPaquetes" INTEGER NOT NULL,
    "pdfUrl" TEXT,
    "empresaId" INTEGER NOT NULL,
    CONSTRAINT "Manifiesto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EncuestaNPS" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "score" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "comentario" TEXT,
    "experienciaEntrega" TEXT,
    "satisfaccionProducto" INTEGER,
    "probabilidadRecompra" INTEGER,
    "sugerenciaMejora" TEXT,
    "slaCumplido" BOOLEAN,
    "cpDestino" TEXT,
    "provincia" TEXT,
    "modalidad" TEXT,
    "envioId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "fechaVoto" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EncuestaNPS_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EncuestaNPS_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EncuestaNPS_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReglaRuteo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER,
    "nombre" TEXT NOT NULL,
    "prioridad" INTEGER NOT NULL,
    "condicionVariable" TEXT NOT NULL,
    "condicionOperador" TEXT NOT NULL,
    "condicionValor1" REAL,
    "condicionValor2" REAL,
    "accionTipo" TEXT NOT NULL,
    "accionValor" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "fechaCreacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaActualizacion" DATETIME NOT NULL,
    CONSTRAINT "ReglaRuteo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetricaSLA" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "provinciaDestino" TEXT NOT NULL,
    "slaPromedioHs" INTEGER NOT NULL,
    "muestraEnvios" INTEGER NOT NULL,
    "fechaActualizacion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricaSLA_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feriado" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "SlaCourier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courierId" INTEGER NOT NULL,
    "zonaNombre" TEXT NOT NULL,
    "diasPactados" INTEGER NOT NULL,
    CONSTRAINT "SlaCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_CodigoPostalToLocalidad" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_CodigoPostalToLocalidad_A_fkey" FOREIGN KEY ("A") REFERENCES "CodigoPostal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_CodigoPostalToLocalidad_B_fkey" FOREIGN KEY ("B") REFERENCES "Localidad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_nombre_key" ON "Courier"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "CredencialCourier_empresaId_nombreCourier_key" ON "CredencialCourier"("empresaId", "nombreCourier");

-- CreateIndex
CREATE UNIQUE INDEX "Envio_trackingNumber_key" ON "Envio"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Envio_ordenExternaId_key" ON "Envio"("ordenExternaId");

-- CreateIndex
CREATE UNIQUE INDEX "Envio_finanzasId_key" ON "Envio"("finanzasId");

-- CreateIndex
CREATE UNIQUE INDEX "Nomenclador_courierId_estadoCrudo_key" ON "Nomenclador"("courierId", "estadoCrudo");

-- CreateIndex
CREATE UNIQUE INDEX "Provincia_nombre_key" ON "Provincia"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoPostal_codigo_key" ON "CodigoPostal"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaNPS_envioId_key" ON "EncuestaNPS"("envioId");

-- CreateIndex
CREATE UNIQUE INDEX "MetricaSLA_courierId_provinciaDestino_key" ON "MetricaSLA"("courierId", "provinciaDestino");

-- CreateIndex
CREATE UNIQUE INDEX "Feriado_fecha_key" ON "Feriado"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "SlaCourier_courierId_zonaNombre_key" ON "SlaCourier"("courierId", "zonaNombre");

-- CreateIndex
CREATE UNIQUE INDEX "_CodigoPostalToLocalidad_AB_unique" ON "_CodigoPostalToLocalidad"("A", "B");

-- CreateIndex
CREATE INDEX "_CodigoPostalToLocalidad_B_index" ON "_CodigoPostalToLocalidad"("B");

