-- =============================================================================
-- DEUDA 185 ETAPA 1 — Modelo contacto compartido + ContactoEmpresa (acceso por
-- empresa) + tipo discriminador CONTACTO/SNAPSHOT_ORIGEN + índice único parcial
-- de email para contactos. Aditiva, cero drop.
--
-- Orden declarado y money-safe:
--   1. CreateEnum DireccionTipo.
--   2. AlterTable Direccion ADD tipo (default CONTACTO) + actualizadoEn (default NOW()).
--   3. CreateTable ContactoEmpresa + indexes + FKs.
--   4. BACKFILL tipo — filas usadas SOLO como origen (y nunca como destino) → SNAPSHOT_ORIGEN;
--      el resto queda en CONTACTO (default).
--   5. BACKFILL ContactoEmpresa — una fila (empresaId, direccionId) por cada tupla con al
--      menos un envío de destino.
--   6. CreateIndex PARTIAL UNIQUE sobre Direccion.email WHERE tipo='CONTACTO' AND email IS NOT NULL
--      — Prisma no expresa unique parcial nativo; se agrega acá a mano. Va AL FINAL para
--      validar contra tipos ya correctos del backfill.
--
-- Verificado prod via diagnóstico (2026-10-06): 42 filas Direccion totales, 37 sin email
-- (origen snapshots), 5 con email todas únicas → cero duplicados → cero dedup necesario.
-- =============================================================================

-- CreateEnum
CREATE TYPE "DireccionTipo" AS ENUM ('CONTACTO', 'SNAPSHOT_ORIGEN');

-- AlterTable
-- DEUDA 185 ETAPA 1: tipo default CONTACTO para que las filas existentes queden
-- como contactos y pasen al backfill del paso 4. actualizadoEn con default NOW()
-- (Prisma gen omite default porque es @updatedAt, pero las 34 filas existentes
-- necesitan un valor inicial válido — se hidrata con NOW() y luego el trigger
-- de @updatedAt lo mantiene actualizado en cada write).
ALTER TABLE "Direccion"
  ADD COLUMN "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "tipo" "DireccionTipo" NOT NULL DEFAULT 'CONTACTO';

-- CreateTable
CREATE TABLE "ContactoEmpresa" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "direccionId" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactoEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactoEmpresa_empresaId_idx" ON "ContactoEmpresa"("empresaId");

-- CreateIndex
CREATE INDEX "ContactoEmpresa_direccionId_idx" ON "ContactoEmpresa"("direccionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactoEmpresa_empresaId_direccionId_key" ON "ContactoEmpresa"("empresaId", "direccionId");

-- AddForeignKey
ALTER TABLE "ContactoEmpresa" ADD CONSTRAINT "ContactoEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactoEmpresa" ADD CONSTRAINT "ContactoEmpresa_direccionId_fkey" FOREIGN KEY ("direccionId") REFERENCES "Direccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- BACKFILL (DEUDA 185 ETAPA 1)
-- =============================================================================

-- 4. tipo=SNAPSHOT_ORIGEN para TODA fila que NO sea destino de algún envío.
--    Cubre dos casos:
--      (a) Rows usadas como Envio.origenId (snapshots de depósito al crear envío).
--      (b) Rows ORPHAN sin ningún Envio.origenId/destinoId que las referencie
--          (data stale de pruebas; en prod no deberían existir, pero defensivo).
--    Rows usadas como Envio.destinoId (y las que son ambos) PERMANECEN CONTACTO
--    (default). El caso "ambos" es teóricamente posible pero improbable (un
--    comprador cuya Direccion coincidió con un depósito-origen) — queda como
--    contacto compartido, shape más conservador; si en el futuro aparece y
--    rompe el unique parcial, la migración falla ruidosamente antes del índice.
UPDATE "Direccion"
SET "tipo" = 'SNAPSHOT_ORIGEN'
WHERE "id" NOT IN (SELECT DISTINCT "destinoId" FROM "Envio" WHERE "destinoId" IS NOT NULL);

-- 5. ContactoEmpresa: una fila por cada (empresa, direccion) con al menos un envío
--    de destino. ON CONFLICT NO-OP defensivo (el @@unique ya evita duplicados).
INSERT INTO "ContactoEmpresa" ("empresaId", "direccionId", "creadoEn")
SELECT DISTINCT e."empresaId", e."destinoId", NOW()
FROM "Envio" e
WHERE e."destinoId" IS NOT NULL AND e."empresaId" IS NOT NULL
ON CONFLICT ("empresaId", "direccionId") DO NOTHING;

-- =============================================================================
-- 6. PARTIAL UNIQUE INDEX — email único SOLO entre CONTACTOs (origen snapshots
--    pueden repetir deposito.contactoEmail entre envíos). Prisma no expresa
--    unique parcial nativamente; se agrega a mano acá. VA AL FINAL para que
--    los tipos ya estén correctamente seteados por el backfill del paso 4.
-- =============================================================================
CREATE UNIQUE INDEX "Direccion_email_contacto_key"
  ON "Direccion"("email")
  WHERE "tipo" = 'CONTACTO' AND "email" IS NOT NULL;
