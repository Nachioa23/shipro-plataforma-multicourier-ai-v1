-- Shopify tokens expirantes (app pública, 2026-10-21)
-- La app pasó de custom (token permanente) a pública ("Shipro Flow Clientes").
-- Shopify exige tokens offline expirantes + refresh para apps públicas nuevas
-- (confirmado oficial + 403 reproducido en prod).
-- Aditiva pura: 3 columnas nullable. Zero cambio a datos existentes. Instalaciones
-- custom legacy quedan con NULL en los 3 campos (token permanente, no aplica el
-- flujo refresh — el flag null/not-null distingue los dos regímenes).

ALTER TABLE "TiendaShopify" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "TiendaShopify" ADD COLUMN "accessTokenExpira" TIMESTAMP(3);
ALTER TABLE "TiendaShopify" ADD COLUMN "refreshTokenExpira" TIMESTAMP(3);
