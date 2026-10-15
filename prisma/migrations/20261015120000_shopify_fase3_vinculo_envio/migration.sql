-- =============================================================================
-- Shopify Fase 3 (2026-10-15) — vínculo Shopify en Envio + estado del push
--
-- 7 columnas aditivas nullable en Envio + FK a TiendaShopify + 1 índice de
-- idempotencia. Mismo mold que los campos tiendanube*/mercadolibre* ya en
-- Envio. Branch 1 confirmado (sin FulfillmentService) + opción (b) sin tabla
-- EtiquetaShopify (relación 1:1 Envío ↔ fulfillment push; mayoría de campos
-- de EtiquetaTiendanube no aplican a Shopify que no hostea PDF).
--
-- CAMPOS DE VÍNCULO (3) — los pasa Chat B en CrearEnvioInput, pure-plumbing:
--   shopifyOrderId, shopifyFulfillmentOrderId, tiendaShopifyId (+ FK).
--
-- CAMPOS DE ESTADO DEL PUSH (4) — Chat B los escribe post-crearEnvio:
--   shopifyFulfillmentPushEstado, shopifyFulfillmentId,
--   shopifyFulfillmentPushError, shopifyFulfillmentPushedAt.
--
-- ÍNDICE: @@index([shopifyFulfillmentOrderId]) mirror de los índices
-- @@index([tiendanubeFulfillmentOrderId]) + @@index([mercadolibreShipmentId]).
--
-- MONEY-SAFE: pure plumbing, zero touch al bloque de débito de crearEnvio
-- (crear.ts:1281-1298). Cero cambio a columnas existentes, cero DROP, cero
-- ALTER destructivo.
-- =============================================================================

-- AlterTable
ALTER TABLE "Envio" ADD COLUMN "shopifyOrderId" TEXT;
ALTER TABLE "Envio" ADD COLUMN "shopifyFulfillmentOrderId" TEXT;
ALTER TABLE "Envio" ADD COLUMN "tiendaShopifyId" INTEGER;
ALTER TABLE "Envio" ADD COLUMN "shopifyFulfillmentPushEstado" TEXT;
ALTER TABLE "Envio" ADD COLUMN "shopifyFulfillmentId" TEXT;
ALTER TABLE "Envio" ADD COLUMN "shopifyFulfillmentPushError" TEXT;
ALTER TABLE "Envio" ADD COLUMN "shopifyFulfillmentPushedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Envio_shopifyFulfillmentOrderId_idx" ON "Envio"("shopifyFulfillmentOrderId");

-- AddForeignKey
ALTER TABLE "Envio" ADD CONSTRAINT "Envio_tiendaShopifyId_fkey" FOREIGN KEY ("tiendaShopifyId") REFERENCES "TiendaShopify"("id") ON DELETE SET NULL ON UPDATE CASCADE;
