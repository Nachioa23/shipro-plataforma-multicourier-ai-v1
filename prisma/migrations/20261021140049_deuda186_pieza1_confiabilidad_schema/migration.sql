-- DEUDA 186 PIEZA 1 (2026-10-21) — schema de la captura de confiabilidad.
-- Aditiva pura: 1 tabla nueva + 1 columna nueva con CHECK. Zero touch de datos,
-- zero DROP, zero rename, zero touch de MetricaSLA (coexisten — miden cosas
-- distintas: MetricaSLA = velocidad del courier; MetricaConfiabilidad = on-time
-- end-to-end).

-- 1. Nueva tabla MetricaConfiabilidad.
CREATE TABLE "MetricaConfiabilidad" (
    "id" SERIAL NOT NULL,
    "courierId" INTEGER NOT NULL,
    "provinciaDestino" TEXT NOT NULL,
    "esGlobal" BOOLEAN NOT NULL DEFAULT false,
    "ventanaDias" INTEGER NOT NULL,
    "muestra" INTEGER NOT NULL,
    "cumplieron" INTEGER NOT NULL,
    "porcentajeOnTime" DECIMAL(5,2) NOT NULL,
    "gapPromedioHs" DECIMAL(10,2) NOT NULL,
    "gapP50Hs" DECIMAL(10,2) NOT NULL,
    "gapP90Hs" DECIMAL(10,2) NOT NULL,
    "muestraSuficiente" BOOLEAN NOT NULL,
    "fechaActualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricaConfiabilidad_pkey" PRIMARY KEY ("id")
);

-- Unicidad por (courier, provincia, esGlobal, ventana): dos filas distintas por
-- combinación son imposibles (una real y una global comparten courier/provincia
-- vacía pero difieren en esGlobal).
CREATE UNIQUE INDEX "MetricaConfiabilidad_courierId_provinciaDestino_esGlobal_ventanaDias_key"
    ON "MetricaConfiabilidad"("courierId", "provinciaDestino", "esGlobal", "ventanaDias");

-- Index secundario para lookups por (courier, provincia) agregados cross-ventana.
CREATE INDEX "MetricaConfiabilidad_courierId_provinciaDestino_idx"
    ON "MetricaConfiabilidad"("courierId", "provinciaDestino");

-- FK a Courier con cascade (patrón MetricaSLA).
ALTER TABLE "MetricaConfiabilidad" ADD CONSTRAINT "MetricaConfiabilidad_courierId_fkey"
    FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Nueva columna Empresa.ventanaConfiabilidadDias con CHECK constraint.
-- Prisma no expresa CHECK nativo; va en el SQL de la migración a mano.
-- Valores canónicos: 90 (cuartil operativo), 180 (semestral — aísla picos
-- cortos), 270/360 (anual — aísla estacionalidad completa). El "reset
-- configurable" de Nacho.
ALTER TABLE "Empresa" ADD COLUMN "ventanaConfiabilidadDias" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_ventanaConfiabilidadDias_check"
    CHECK ("ventanaConfiabilidadDias" IN (90, 180, 270, 360));
