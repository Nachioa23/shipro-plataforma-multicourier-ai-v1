-- CreateTable
CREATE TABLE "Empresa" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyHash" TEXT,
    "apiKeyUltimos4" TEXT,
    "apiKeyActiva" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyCreadaEn" TIMESTAMP(3),
    "saldoActivo" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "modalidadPago" TEXT NOT NULL DEFAULT 'POSTPAGO',
    "limiteDescubierto" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "modeloAHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "suspendida" BOOLEAN NOT NULL DEFAULT false,
    "fechaSuspension" TIMESTAMP(3),
    "fechaReactivacion" TIMESTAMP(3),
    "direccionFiscalCalle" TEXT,
    "direccionFiscalAltura" TEXT,
    "direccionFiscalCP" TEXT,
    "direccionFiscalLocalidad" TEXT,
    "direccionFiscalProvincia" TEXT,
    "notasInternas" TEXT,
    "onboardingCompletado" BOOLEAN NOT NULL DEFAULT false,
    "tarifaPlanaRespaldo" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposito" (
    "id" SERIAL NOT NULL,
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
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "ultimaGeocodificacion" TIMESTAMP(3),
    "horarios" TEXT NOT NULL,
    "observaciones" TEXT,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "courierRecolectorId" INTEGER,

    CONSTRAINT "Deposito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'operador_cliente',
    "telefono" TEXT,
    "passwordTemporal" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "empresaId" INTEGER,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" SERIAL NOT NULL,
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
    "timeoutCotizacionMs" INTEGER NOT NULL DEFAULT 7000,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioCourier" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "codigoServicio" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "ordenVisual" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "capacidadTecnicaMapeada" TEXT,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaActualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredencialCourier" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombreCourier" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "usaCredencialesPropias" BOOLEAN NOT NULL DEFAULT true,
    "credencialesJson" TEXT,
    "tipoCuenta" TEXT,
    "ofreceDomicilio" BOOLEAN NOT NULL DEFAULT true,
    "ofreceSucursal" BOOLEAN NOT NULL DEFAULT true,
    "tarifaIncluyeIva" BOOLEAN NOT NULL DEFAULT true,
    "ajusteTarifaPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "markupFijo" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "fechaCaducidadPromo" TIMESTAMP(3),
    "ordenamientoDefault" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "serviciosActivos" TEXT,
    "ordenamientoDomicilio" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "ordenamientoSucursal" TEXT NOT NULL DEFAULT 'PRECIO_ASC',
    "requiereSeguro" BOOLEAN NOT NULL DEFAULT false,
    "slaPromedioHs" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredencialCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Direccion" (
    "id" SERIAL NOT NULL,
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
    "observacion" TEXT,

    CONSTRAINT "Direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenExterna" (
    "id" SERIAL NOT NULL,
    "canal" TEXT,
    "idTienda" TEXT,
    "ordenId" TEXT,
    "referencia" TEXT,
    "mercadolibreShipmentId" TEXT,

    CONSTRAINT "OrdenExterna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanzasEnvio" (
    "id" SERIAL NOT NULL,
    "precioMostrado" DOUBLE PRECISION,
    "precioFactura" DOUBLE PRECISION,
    "porcentajePrecioFactura" DOUBLE PRECISION,
    "valorDeclarado" DOUBLE PRECISION,
    "precioProveedor" DOUBLE PRECISION,
    "costoCourierEsperado" DOUBLE PRECISION,
    "costoCourierFacturado" DOUBLE PRECISION,
    "estadoAuditoria" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "facturaCourierRef" TEXT,
    "pesoCobrado" DOUBLE PRECISION,
    "pesoAforado" DOUBLE PRECISION,
    "costoAforo" DOUBLE PRECISION,
    "fugaFinanciera" DOUBLE PRECISION DEFAULT 0.0,
    "courierSugerido" TEXT,
    "servicioSugerido" TEXT,

    CONSTRAINT "FinanzasEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoFinanciero" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "saldoPosterior" DOUBLE PRECISION NOT NULL,
    "referencia" TEXT,
    "descripcion" TEXT,
    "envioId" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoFinanciero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionMensual" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "montoTotal" DOUBLE PRECISION NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EMITIDA',
    "excelProformaUrl" TEXT,
    "facturaXubioUrl" TEXT,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidacionMensual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envio" (
    "id" SERIAL NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "diasPrometidosCheckout" INTEGER,
    "numeroOrden" TEXT,
    "tipoOrigen" TEXT NOT NULL DEFAULT 'recoleccion_courier',
    "etiquetaUrl" TEXT,
    "pesoReal" DOUBLE PRECISION NOT NULL,
    "pesoVolumetrico" DOUBLE PRECISION,
    "pesoFacturado" DOUBLE PRECISION,
    "fragil" BOOLEAN NOT NULL DEFAULT false,
    "tipo" TEXT,
    "modalidad" TEXT NOT NULL DEFAULT 'Estándar',
    "servicioId" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'IMPRESO',
    "estadoLiquidacion" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "liquidacionId" INTEGER,
    "fechaImpresion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaColecta" TIMESTAMP(3),
    "fechaEntrega" TIMESTAMP(3),
    "fechaUltimoRastreo" TIMESTAMP(3),
    "empresaId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "origenId" INTEGER,
    "depositoId" INTEGER,
    "destinoId" INTEGER,
    "ordenExternaId" INTEGER,
    "finanzasId" INTEGER,
    "manifiestoId" INTEGER,

    CONSTRAINT "Envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoTracking" (
    "id" SERIAL NOT NULL,
    "estado" TEXT NOT NULL,
    "estadoCrudoOriginal" TEXT,
    "observacion" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "envioId" INTEGER NOT NULL,

    CONSTRAINT "EventoTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nomenclador" (
    "id" SERIAL NOT NULL,
    "estadoCrudo" TEXT NOT NULL,
    "codigoApi" TEXT,
    "estadoShipro" TEXT,
    "courierId" INTEGER NOT NULL,

    CONSTRAINT "Nomenclador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSoporte" (
    "id" SERIAL NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "observacion" TEXT,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" TIMESTAMP(3),
    "envioId" INTEGER NOT NULL,

    CONSTRAINT "TicketSoporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditoriaSoporte" (
    "id" SERIAL NOT NULL,
    "accion" TEXT NOT NULL,
    "detalle" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmail" TEXT,
    "ticketId" INTEGER NOT NULL,

    CONSTRAINT "AuditoriaSoporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditoriaConfiguracion" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmail" TEXT,
    "rolUsuario" TEXT,
    "ipOrigen" TEXT,
    "empresaId" INTEGER NOT NULL,
    "courierId" INTEGER,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNuevo" TEXT,
    "motivo" TEXT,

    CONSTRAINT "AuditoriaConfiguracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditoriaCheckout" (
    "id" SERIAL NOT NULL,
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
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditoriaCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provincia" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Provincia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Localidad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "provinciaId" INTEGER NOT NULL,

    CONSTRAINT "Localidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoPostal" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,

    CONSTRAINT "CodigoPostal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manifiesto" (
    "id" SERIAL NOT NULL,
    "numeroCorrelativo" INTEGER NOT NULL,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courier" TEXT NOT NULL,
    "cantidadPaquetes" INTEGER NOT NULL,
    "pdfUrl" TEXT,
    "empresaId" INTEGER NOT NULL,

    CONSTRAINT "Manifiesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncuestaNPS" (
    "id" SERIAL NOT NULL,
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
    "fechaVoto" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncuestaNPS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncuestaNPSEmpresa" (
    "id" SERIAL NOT NULL,
    "score" INTEGER,
    "categoria" TEXT,
    "satisfaccionPlataforma" INTEGER,
    "calidadSoporte" INTEGER,
    "fortaleza" TEXT,
    "sugerencia" TEXT,
    "periodo" TEXT NOT NULL,
    "fechaEnvio" TIMESTAMP(3) NOT NULL,
    "fechaVoto" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tokenVoto" TEXT NOT NULL,

    CONSTRAINT "EncuestaNPSEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReglaRuteo" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER,
    "nombre" TEXT NOT NULL,
    "prioridad" INTEGER NOT NULL,
    "condicionVariable" TEXT NOT NULL,
    "condicionOperador" TEXT NOT NULL,
    "condicionValor1" DOUBLE PRECISION,
    "condicionValor2" DOUBLE PRECISION,
    "accionTipo" TEXT NOT NULL,
    "accionValor" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaActualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReglaRuteo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricaSLA" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "provinciaDestino" TEXT NOT NULL,
    "slaPromedioHs" INTEGER NOT NULL,
    "muestraEnvios" INTEGER NOT NULL,
    "fechaActualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricaSLA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feriado" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Feriado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaCourier" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "zonaNombre" TEXT NOT NULL,
    "diasPactados" INTEGER NOT NULL,

    CONSTRAINT "SlaCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SucursalCourier" (
    "id" SERIAL NOT NULL,
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
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
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
    "fechaUltimaConfirmacion" TIMESTAMP(3),
    "metadatosJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SucursalCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositoSucursalPreferida" (
    "id" SERIAL NOT NULL,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "sucursalCourierId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositoSucursalPreferida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositoCourierConfig" (
    "id" SERIAL NOT NULL,
    "depositoId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "dropOffCliente" BOOLEAN NOT NULL DEFAULT false,
    "recogeViaConsolidador" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositoCourierConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramoEnvio" (
    "id" SERIAL NOT NULL,
    "envioId" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "trackingExterno" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "estadoCrudoUltimo" TEXT,
    "sucursalOrigenId" INTEGER,
    "sucursalDestinoId" INTEGER,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "metadatosJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TramoEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotizacionSnapshot" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "depositoOrigenId" INTEGER NOT NULL,
    "destinoSnapshotJson" TEXT NOT NULL,
    "paqueteSnapshotJson" TEXT NOT NULL,
    "opcionesSnapshotJson" TEXT NOT NULL,
    "usadaEnEnvioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotizacionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricaCourierLatencia" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "operacion" TEXT NOT NULL,
    "latenciaMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "envioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricaCourierLatencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoCotizaciones" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "cpOrigen" TEXT NOT NULL,
    "cpDestino" TEXT NOT NULL,
    "pesoKg" DOUBLE PRECISION NOT NULL,
    "precio" DOUBLE PRECISION NOT NULL,
    "servicio" TEXT,
    "modalidad" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoCotizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacionFee" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'FIJO',
    "valor" DOUBLE PRECISION NOT NULL,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacionFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SucursalCourierCp" (
    "id" SERIAL NOT NULL,
    "sucursalCourierId" INTEGER NOT NULL,
    "codigoPostal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SucursalCourierCp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroCoberturaVacia" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpDestino" TEXT NOT NULL,
    "pesoKg" DOUBLE PRECISION NOT NULL,
    "largoCm" DOUBLE PRECISION,
    "anchoCm" DOUBLE PRECISION,
    "altoCm" DOUBLE PRECISION,
    "origen" TEXT,
    "empresaId" INTEGER,

    CONSTRAINT "RegistroCoberturaVacia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CodigoPostalToLocalidad" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_apiKeyHash_key" ON "Empresa"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Deposito_empresaId_idx" ON "Deposito"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_nombre_key" ON "Courier"("nombre");

-- CreateIndex
CREATE INDEX "ServicioCourier_courierId_activo_idx" ON "ServicioCourier"("courierId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioCourier_courierId_codigoServicio_key" ON "ServicioCourier"("courierId", "codigoServicio");

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
CREATE INDEX "AuditoriaConfiguracion_empresaId_fecha_idx" ON "AuditoriaConfiguracion"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "AuditoriaConfiguracion_courierId_fecha_idx" ON "AuditoriaConfiguracion"("courierId", "fecha");

-- CreateIndex
CREATE INDEX "AuditoriaConfiguracion_campo_fecha_idx" ON "AuditoriaConfiguracion"("campo", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Provincia_nombre_key" ON "Provincia"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoPostal_codigo_key" ON "CodigoPostal"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaNPS_envioId_key" ON "EncuestaNPS"("envioId");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaNPSEmpresa_tokenVoto_key" ON "EncuestaNPSEmpresa"("tokenVoto");

-- CreateIndex
CREATE INDEX "EncuestaNPSEmpresa_empresaId_periodo_idx" ON "EncuestaNPSEmpresa"("empresaId", "periodo");

-- CreateIndex
CREATE INDEX "EncuestaNPSEmpresa_periodo_idx" ON "EncuestaNPSEmpresa"("periodo");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaNPSEmpresa_usuarioId_periodo_key" ON "EncuestaNPSEmpresa"("usuarioId", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "MetricaSLA_courierId_provinciaDestino_key" ON "MetricaSLA"("courierId", "provinciaDestino");

-- CreateIndex
CREATE UNIQUE INDEX "Feriado_fecha_key" ON "Feriado"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "SlaCourier_courierId_zonaNombre_key" ON "SlaCourier"("courierId", "zonaNombre");

-- CreateIndex
CREATE INDEX "SucursalCourier_courierId_idx" ON "SucursalCourier"("courierId");

-- CreateIndex
CREATE INDEX "SucursalCourier_latitud_longitud_idx" ON "SucursalCourier"("latitud", "longitud");

-- CreateIndex
CREATE INDEX "SucursalCourier_courierId_codigoPostal_idx" ON "SucursalCourier"("courierId", "codigoPostal");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalCourier_courierId_idExterno_key" ON "SucursalCourier"("courierId", "idExterno");

-- CreateIndex
CREATE INDEX "DepositoSucursalPreferida_courierId_idx" ON "DepositoSucursalPreferida"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositoSucursalPreferida_depositoId_courierId_key" ON "DepositoSucursalPreferida"("depositoId", "courierId");

-- CreateIndex
CREATE INDEX "DepositoCourierConfig_courierId_idx" ON "DepositoCourierConfig"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositoCourierConfig_depositoId_courierId_key" ON "DepositoCourierConfig"("depositoId", "courierId");

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
CREATE INDEX "HistoricoCotizaciones_createdAt_idx" ON "HistoricoCotizaciones"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_pesoKg_m_key" ON "HistoricoCotizaciones"("courierId", "cpOrigen", "cpDestino", "pesoKg", "modalidad");

-- CreateIndex
CREATE INDEX "OperacionFee_empresaId_activo_idx" ON "OperacionFee"("empresaId", "activo");

-- CreateIndex
CREATE INDEX "SucursalCourierCp_sucursalCourierId_idx" ON "SucursalCourierCp"("sucursalCourierId");

-- CreateIndex
CREATE INDEX "SucursalCourierCp_codigoPostal_idx" ON "SucursalCourierCp"("codigoPostal");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalCourierCp_sucursalCourierId_codigoPostal_key" ON "SucursalCourierCp"("sucursalCourierId", "codigoPostal");

-- CreateIndex
CREATE INDEX "RegistroCoberturaVacia_fecha_idx" ON "RegistroCoberturaVacia"("fecha");

-- CreateIndex
CREATE INDEX "RegistroCoberturaVacia_cpDestino_idx" ON "RegistroCoberturaVacia"("cpDestino");

-- CreateIndex
CREATE UNIQUE INDEX "_CodigoPostalToLocalidad_AB_unique" ON "_CodigoPostalToLocalidad"("A", "B");

-- CreateIndex
CREATE INDEX "_CodigoPostalToLocalidad_B_index" ON "_CodigoPostalToLocalidad"("B");

-- AddForeignKey
ALTER TABLE "Deposito" ADD CONSTRAINT "Deposito_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposito" ADD CONSTRAINT "Deposito_courierRecolectorId_fkey" FOREIGN KEY ("courierRecolectorId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioCourier" ADD CONSTRAINT "ServicioCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredencialCourier" ADD CONSTRAINT "CredencialCourier_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFinanciero" ADD CONSTRAINT "MovimientoFinanciero_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFinanciero" ADD CONSTRAINT "MovimientoFinanciero_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionMensual" ADD CONSTRAINT "LiquidacionMensual_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionMensual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Direccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "Direccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_ordenExternaId_fkey" FOREIGN KEY ("ordenExternaId") REFERENCES "OrdenExterna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_finanzasId_fkey" FOREIGN KEY ("finanzasId") REFERENCES "FinanzasEnvio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_manifiestoId_fkey" FOREIGN KEY ("manifiestoId") REFERENCES "Manifiesto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTracking" ADD CONSTRAINT "EventoTracking_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nomenclador" ADD CONSTRAINT "Nomenclador_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSoporte" ADD CONSTRAINT "TicketSoporte_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditoriaSoporte" ADD CONSTRAINT "AuditoriaSoporte_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TicketSoporte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditoriaConfiguracion" ADD CONSTRAINT "AuditoriaConfiguracion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditoriaConfiguracion" ADD CONSTRAINT "AuditoriaConfiguracion_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localidad" ADD CONSTRAINT "Localidad_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifiesto" ADD CONSTRAINT "Manifiesto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaNPS" ADD CONSTRAINT "EncuestaNPS_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaNPS" ADD CONSTRAINT "EncuestaNPS_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaNPS" ADD CONSTRAINT "EncuestaNPS_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaNPSEmpresa" ADD CONSTRAINT "EncuestaNPSEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaNPSEmpresa" ADD CONSTRAINT "EncuestaNPSEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaRuteo" ADD CONSTRAINT "ReglaRuteo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricaSLA" ADD CONSTRAINT "MetricaSLA_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaCourier" ADD CONSTRAINT "SlaCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SucursalCourier" ADD CONSTRAINT "SucursalCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositoSucursalPreferida" ADD CONSTRAINT "DepositoSucursalPreferida_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositoSucursalPreferida" ADD CONSTRAINT "DepositoSucursalPreferida_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositoSucursalPreferida" ADD CONSTRAINT "DepositoSucursalPreferida_sucursalCourierId_fkey" FOREIGN KEY ("sucursalCourierId") REFERENCES "SucursalCourier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositoCourierConfig" ADD CONSTRAINT "DepositoCourierConfig_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositoCourierConfig" ADD CONSTRAINT "DepositoCourierConfig_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramoEnvio" ADD CONSTRAINT "TramoEnvio_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramoEnvio" ADD CONSTRAINT "TramoEnvio_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramoEnvio" ADD CONSTRAINT "TramoEnvio_sucursalOrigenId_fkey" FOREIGN KEY ("sucursalOrigenId") REFERENCES "SucursalCourier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramoEnvio" ADD CONSTRAINT "TramoEnvio_sucursalDestinoId_fkey" FOREIGN KEY ("sucursalDestinoId") REFERENCES "SucursalCourier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricaCourierLatencia" ADD CONSTRAINT "MetricaCourierLatencia_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionFee" ADD CONSTRAINT "OperacionFee_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SucursalCourierCp" ADD CONSTRAINT "SucursalCourierCp_sucursalCourierId_fkey" FOREIGN KEY ("sucursalCourierId") REFERENCES "SucursalCourier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroCoberturaVacia" ADD CONSTRAINT "RegistroCoberturaVacia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CodigoPostalToLocalidad" ADD CONSTRAINT "_CodigoPostalToLocalidad_A_fkey" FOREIGN KEY ("A") REFERENCES "CodigoPostal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CodigoPostalToLocalidad" ADD CONSTRAINT "_CodigoPostalToLocalidad_B_fkey" FOREIGN KEY ("B") REFERENCES "Localidad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
