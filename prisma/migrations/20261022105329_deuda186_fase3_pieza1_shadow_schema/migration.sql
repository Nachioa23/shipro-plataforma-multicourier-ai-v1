-- DEUDA 186 FASE 3 PIEZA 1 (2026-10-22) — schema del scoring en SOMBRA.
-- Aditiva pura: 1 tabla nueva + 5 columnas nuevas en Empresa (4 pesos con
-- DEFAULT + 1 flag con DEFAULT false) + 1 CHECK (pesos suman 1.00) + 3 índices
-- + FKs (Empresa cascade, Envio/Courier/ReglaRuteo SetNull). Zero touch de
-- datos existentes, zero DROP, zero rename, zero toque a cotizador/débito.
-- El scoring NO afecta la selección — es analytics puro.

-- 1. Tabla nueva MotorReglaShadowLog.
CREATE TABLE "MotorReglaShadowLog" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "provinciaDestino" TEXT NOT NULL,
    "tipoEntrega" TEXT NOT NULL,
    "winnerActualCourierId" INTEGER,
    "winnerShadowCourierId" INTEGER,
    "coinciden" BOOLEAN NOT NULL,
    "scoreActual" DECIMAL(6,4) NOT NULL,
    "scoreShadow" DECIMAL(6,4) NOT NULL,
    "deltaScore" DECIMAL(6,4) NOT NULL,
    "envioRealId" INTEGER,
    "precioActual" DECIMAL(12,2) NOT NULL,
    "precioShadow" DECIMAL(12,2) NOT NULL,
    "sobrecostoShadow" DECIMAL(12,2) NOT NULL,
    "pesosSnapshot" JSONB NOT NULL,
    "componentesSnapshot" JSONB NOT NULL,
    "reglaAplicadaId" INTEGER,
    "reglaAplicadaNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotorReglaShadowLog_pkey" PRIMARY KEY ("id")
);

-- Índices
-- - (empresaId, createdAt): recorrer el histórico de una empresa cronológicamente.
-- - (coinciden, createdAt): "% match" global/por período (counter principal del reporte).
-- - (provinciaDestino, createdAt): APORTE NACHO — análisis por zona para encendido parcial FASE 4.
CREATE INDEX "MotorReglaShadowLog_empresaId_createdAt_idx" ON "MotorReglaShadowLog"("empresaId", "createdAt");
CREATE INDEX "MotorReglaShadowLog_coinciden_createdAt_idx" ON "MotorReglaShadowLog"("coinciden", "createdAt");
CREATE INDEX "MotorReglaShadowLog_provinciaDestino_createdAt_idx" ON "MotorReglaShadowLog"("provinciaDestino", "createdAt");

-- FKs. Empresa: CASCADE (si borran la empresa, los logs se van con ella).
-- Envio / Courier / ReglaRuteo: SetNull (los logs sobreviven aunque se borre
-- la entidad referida; preservar histórico analítico).
ALTER TABLE "MotorReglaShadowLog" ADD CONSTRAINT "MotorReglaShadowLog_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MotorReglaShadowLog" ADD CONSTRAINT "MotorReglaShadowLog_winnerActualCourierId_fkey"
    FOREIGN KEY ("winnerActualCourierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MotorReglaShadowLog" ADD CONSTRAINT "MotorReglaShadowLog_winnerShadowCourierId_fkey"
    FOREIGN KEY ("winnerShadowCourierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MotorReglaShadowLog" ADD CONSTRAINT "MotorReglaShadowLog_envioRealId_fkey"
    FOREIGN KEY ("envioRealId") REFERENCES "Envio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MotorReglaShadowLog" ADD CONSTRAINT "MotorReglaShadowLog_reglaAplicadaId_fkey"
    FOREIGN KEY ("reglaAplicadaId") REFERENCES "ReglaRuteo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Columnas nuevas en Empresa: 4 pesos con DEFAULT + 1 flag con DEFAULT false.
-- Decimal(3,2) permite valores 0.00 - 9.99; en la práctica solo [0, 1]. Los
-- defaults (40/30/20/10) salen del blueprint §4.
ALTER TABLE "Empresa" ADD COLUMN "pesoCostoScoring" DECIMAL(3,2) NOT NULL DEFAULT 0.40;
ALTER TABLE "Empresa" ADD COLUMN "pesoSlaScoring" DECIMAL(3,2) NOT NULL DEFAULT 0.30;
ALTER TABLE "Empresa" ADD COLUMN "pesoVelocidadScoring" DECIMAL(3,2) NOT NULL DEFAULT 0.20;
ALTER TABLE "Empresa" ADD COLUMN "pesoCapacidadScoring" DECIMAL(3,2) NOT NULL DEFAULT 0.10;
ALTER TABLE "Empresa" ADD COLUMN "motorReglasShadow" BOOLEAN NOT NULL DEFAULT false;

-- CHECK: candado de pesos suman 1.00. Prisma no expresa CHECK nativo — va a
-- mano. Rows existentes se agregan con los defaults (40+30+20+10=100) → la
-- constraint se cumple automáticamente post-ADD COLUMN.
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_pesosScoring_suma_check"
    CHECK (
        "pesoCostoScoring" + "pesoSlaScoring" + "pesoVelocidadScoring" + "pesoCapacidadScoring" = 1.00
    );
