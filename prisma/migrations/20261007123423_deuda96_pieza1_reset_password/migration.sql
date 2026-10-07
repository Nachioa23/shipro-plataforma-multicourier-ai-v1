-- =============================================================================
-- DEUDA 96 PIEZA 1 (2026-10-08) — Flujo de recuperación de contraseña:
-- modelos aditivos (TokenResetPassword single-use + IntentoResetPassword
-- rate-limit en BD). Cero drop, cero alter destructivo.
--
-- Modelos:
--   1. TokenResetPassword — token single-use por usuario, TTL 2h, consumible
--      vía updateMany(where usadoEn=null) atómico. Patrón clon de
--      TokenSetupApiKey (DEUDA 150) adaptado per-usuario (usuarios shipro con
--      empresaId=null también deben poder resetear).
--   2. IntentoResetPassword — una fila por POST a /api/auth/forgot-password.
--      El endpoint cuenta filas recientes para rate-limit por email (1/60s) y
--      por IP (10/5min). Decisión Nacho: en BD, no in-memory (robusto cross-
--      process + rolling restart). Cron de limpieza futuro (barre >24h).
-- =============================================================================

-- CreateTable
CREATE TABLE "TokenResetPassword" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "ipOrigen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenResetPassword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentoResetPassword" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentoResetPassword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenResetPassword_token_key" ON "TokenResetPassword"("token");

-- CreateIndex
CREATE INDEX "TokenResetPassword_usuarioId_idx" ON "TokenResetPassword"("usuarioId");

-- CreateIndex
CREATE INDEX "IntentoResetPassword_email_createdAt_idx" ON "IntentoResetPassword"("email", "createdAt");

-- CreateIndex
CREATE INDEX "IntentoResetPassword_ip_createdAt_idx" ON "IntentoResetPassword"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "TokenResetPassword" ADD CONSTRAINT "TokenResetPassword_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
