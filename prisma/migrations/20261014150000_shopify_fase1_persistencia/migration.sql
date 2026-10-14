-- =============================================================================
-- Shopify Fase 1 (2026-10-14) — persistencia per-plataforma
--
-- 2 tablas aditivas que espejan el patrón TiendaTiendanube +
-- TokenVinculacionTiendanube. Shape final consensuado Chat B + GN:
--   - Token offline permanente (Shopify no entrega refresh_token para apps
--     públicas), sin ganchos de rotación en Fase 1.
--   - shopDomain estable e inmutable (*.myshopify.com), @unique.
--   - carrierServiceId dentro del modelo pero null hasta Fase 2.
--   - currency / timezone / fulfillmentServiceId / scopes diferidos a fases
--     posteriores (no se agregan como columnas hasta tener el flow consumer).
--
-- CREATE TABLE puro + 2 FK + 3 índices. CERO ALTER a tablas existentes, CERO
-- toque al enum PlataformaConexion (SHOPIFY ya existía), CERO DROP. Writes
-- del Chat B (callback OAuth, cifrado con encryptSecret) son Fase 2+, no
-- parte de esta migración.
-- =============================================================================

-- CreateTable
CREATE TABLE "TiendaShopify" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT,
    "dominio" TEXT,
    "nombre" TEXT,
    "carrierServiceId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'instalada',
    "instaladaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desinstaladaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiendaShopify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenVinculacionShopify" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenVinculacionShopify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TiendaShopify_shopDomain_key" ON "TiendaShopify"("shopDomain");

-- CreateIndex
CREATE INDEX "TiendaShopify_empresaId_idx" ON "TiendaShopify"("empresaId");

-- CreateIndex
CREATE INDEX "TiendaShopify_estado_idx" ON "TiendaShopify"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "TokenVinculacionShopify_token_key" ON "TokenVinculacionShopify"("token");

-- CreateIndex
CREATE INDEX "TokenVinculacionShopify_empresaId_idx" ON "TokenVinculacionShopify"("empresaId");

-- AddForeignKey
ALTER TABLE "TiendaShopify" ADD CONSTRAINT "TiendaShopify_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenVinculacionShopify" ADD CONSTRAINT "TokenVinculacionShopify_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
