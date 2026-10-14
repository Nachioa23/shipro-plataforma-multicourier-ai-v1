-- =============================================================================
-- DEUDA 186 Fase 2 (2026-10-14) — AuditoriaReglaRuteo
--
-- Modelo nuevo dedicado al audit log de cambios de reglas de ruteo. Separado
-- de AuditoriaConfiguracion (money-crítica) para no mezclar scopes:
--   - empresaId NULLABLE: cubre plantillas maestras admin (null) + reglas
--     per-empresa cliente (empresaId concreto). AuditoriaConfiguracion exige
--     empresaId NOT NULL por diseño y no podía recibir cambios de plantillas.
--   - reglaRuteoId NULLABLE: tras un DELETE, el id queda como registro
--     histórico aunque la regla ya no exista.
--
-- CREATE TABLE puro, cero cambio a tablas existentes. Writes best-effort desde
-- los endpoints de reglas; audit nunca rompe la operación.
-- =============================================================================

-- CreateTable
CREATE TABLE "AuditoriaReglaRuteo" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmail" TEXT,
    "rolUsuario" TEXT,
    "ipOrigen" TEXT,
    "empresaId" INTEGER,
    "reglaRuteoId" INTEGER,
    "accion" TEXT NOT NULL,
    "campo" TEXT,
    "valorAnterior" TEXT,
    "valorNuevo" TEXT,
    "motivo" TEXT,

    CONSTRAINT "AuditoriaReglaRuteo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditoriaReglaRuteo_empresaId_fecha_idx" ON "AuditoriaReglaRuteo"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "AuditoriaReglaRuteo_reglaRuteoId_fecha_idx" ON "AuditoriaReglaRuteo"("reglaRuteoId", "fecha");
