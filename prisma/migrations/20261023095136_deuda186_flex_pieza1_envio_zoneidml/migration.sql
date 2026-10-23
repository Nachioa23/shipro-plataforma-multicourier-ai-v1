-- DEUDA 186 Flex PIEZA 1 (2026-10-23) — snapshot inmutable de la zona ML al
-- crear el envío Flex.
--
-- Aditiva pura: 1 columna nullable en Envio + 1 índice parcial (solo filas
-- Flex, más eficiente — ~90% de envíos NO son Flex y quedarán con zoneIdMl
-- null; indexarlos sería desperdicio). Zero cambio a datos existentes, zero
-- DROP, zero touch del bloque financiero / crear.ts débito.
--
-- Las zonas del cliente ML cambian; calcular zona de envío viejo contra las
-- de hoy mediría MAL en silencio. Dato histórico inmutable (como la asignación
-- anclada y precioFactura congelado).

ALTER TABLE "Envio" ADD COLUMN "zoneIdMl" TEXT;

-- Índice parcial — Prisma no expresa índices parciales nativos, va a mano acá.
-- Compuesto (courierId, zoneIdMl) para la query del cron metricas-confiabilidad
-- (PIEZA 2 Flex) que va a agregar por (courierId, zoneIdMl).
CREATE INDEX "Envio_courierId_zoneIdMl_idx"
    ON "Envio"("courierId", "zoneIdMl")
    WHERE "zoneIdMl" IS NOT NULL;
