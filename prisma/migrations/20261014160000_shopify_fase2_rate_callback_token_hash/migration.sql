-- =============================================================================
-- Shopify Fase 2 (2026-10-14) — TiendaShopify.rateCallbackTokenHash
--
-- Agrega campo String? @unique para la auth del endpoint de rates. HASH
-- (HMAC-SHA256 con APIKEY_HMAC_SECRET) del token opaco que viaja en la
-- callbackUrl del CarrierService Shopify. Patrón espejo de Empresa.apiKeyHash:
--   - Shopify no firma los rates callbacks ni manda el shop domain → el token
--     es la ÚNICA auth del endpoint.
--   - Vida larga (mientras la tienda esté instalada) + reusado en cada quote
--     del buyer → encaja en patrón "API KEY" del proyecto (hash, no plano).
--   - El plain NUNCA se persiste; solo Shopify lo guarda en el callback_url.
--     Rotación = nuevo plain + re-registrar CarrierService.
--
-- Chat B pidió originalmente campo plano; Núcleo flaggeó que no sigue el
-- patrón dominante para auth de vida larga; Chat B aceptó hashear. Reusa
-- hashApiKey del helper lib/utils/apikey-hash.ts (es agnóstico del prefijo).
--
-- ADD COLUMN + CREATE UNIQUE INDEX puro, cero cambio a tablas existentes
-- (TiendaShopify ni siquiera está deployada aún: tabla vacía en prod).
-- =============================================================================

-- AlterTable
ALTER TABLE "TiendaShopify" ADD COLUMN "rateCallbackTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TiendaShopify_rateCallbackTokenHash_key" ON "TiendaShopify"("rateCallbackTokenHash");
