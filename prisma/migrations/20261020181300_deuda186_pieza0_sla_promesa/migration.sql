-- DEUDA 186 PIEZA 0 (mise en place, 2026-10-20)
-- Persistir la promesa cruda al crear envío, para medir on-time con granularidad fina.
-- Aditiva pura: 3 columnas nullable. Zero cambio a datos existentes.
-- Legacy pre-PIEZA 0 queda con NULL en los 3 campos (correcto, sin leakage temporal).

ALTER TABLE "Envio" ADD COLUMN "slaPromesaHs" INTEGER;
ALTER TABLE "Envio" ADD COLUMN "slaPromesaNivel" INTEGER;
ALTER TABLE "Envio" ADD COLUMN "slaPromesaMuestra" INTEGER;
