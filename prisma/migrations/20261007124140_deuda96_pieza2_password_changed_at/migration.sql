-- =============================================================================
-- DEUDA 96 PIEZA 2 (2026-10-08) — Invalidación de sesión al cambiar contraseña.
--
-- Agrega Usuario.passwordChangedAt (nullable). Nullable + sin default es
-- INTENCIONAL: usuarios existentes pre-Pieza-2 quedan en null → el jwt callback
-- NO aplica corte → sus sesiones activas siguen válidas hasta su expiry natural
-- (8h). Safe para los usuarios actuales.
--
-- A partir de este deploy, cada password-writer setea passwordChangedAt=NOW().
-- La próxima vez que ese usuario cambie clave, su passwordChangedAt pasa a
-- tener valor y las sesiones viejas de ANTES de ese cambio quedan invalidadas.
-- =============================================================================

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
