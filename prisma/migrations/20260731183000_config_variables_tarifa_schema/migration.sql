-- FASE 2 sub 1 (config variables tarifa): schema ADITIVO.
-- Autoría manual (NO generada por prisma migrate dev). Crea 3 tablas nuevas
-- (MarkupShiproVigencia + SmoCourier + AjusteMasivoFee) con sus FKs e índices.
-- No altera tablas existentes. Ver docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md.
-- Nada de este schema se lee todavía para pricing — el motor se conecta en
-- una sub-piece posterior.

-- ============================================================================
-- 1. MarkupShiproVigencia: markup Shipro GLOBAL con vigencias. UNA sola fila
--    activa a nivel plataforma (no hay FK, es global). CredencialCourier.
--    ajusteTarifaPorcentaje queda como gancho de override por empresa.
-- ============================================================================

-- CreateTable
CREATE TABLE "MarkupShiproVigencia" (
    "id" SERIAL NOT NULL,
    "valorPorcentaje" DECIMAL(12,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkupShiproVigencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkupShiproVigencia_activo_idx" ON "MarkupShiproVigencia"("activo");

-- ============================================================================
-- 2. SmoCourier: SMO por courier con vigencias (espejo de CourierIntermediario).
-- ============================================================================

-- CreateTable
CREATE TABLE "SmoCourier" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "valorNeto" DECIMAL(12,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmoCourier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmoCourier_courierId_activo_idx" ON "SmoCourier"("courierId", "activo");

-- AddForeignKey
ALTER TABLE "SmoCourier" ADD CONSTRAINT "SmoCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. AjusteMasivoFee: registro auditable de ajustes masivos porcentuales del
--    Fee sobre la cartera de OperacionFee (evento, no versión de valor).
--    Estilo ConciliacionRun. aplicadoPorId SetNull para no perder el registro
--    si el usuario admin es dado de baja.
-- ============================================================================

-- CreateTable
CREATE TABLE "AjusteMasivoFee" (
    "id" SERIAL NOT NULL,
    "porcentaje" DECIMAL(12,4) NOT NULL,
    "fechaAplicacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicadoPorId" INTEGER,
    "cantidadEmpresasAfectadas" INTEGER NOT NULL,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AjusteMasivoFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AjusteMasivoFee_fechaAplicacion_idx" ON "AjusteMasivoFee"("fechaAplicacion");

-- CreateIndex
CREATE INDEX "AjusteMasivoFee_aplicadoPorId_idx" ON "AjusteMasivoFee"("aplicadoPorId");

-- AddForeignKey
ALTER TABLE "AjusteMasivoFee" ADD CONSTRAINT "AjusteMasivoFee_aplicadoPorId_fkey" FOREIGN KEY ("aplicadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
