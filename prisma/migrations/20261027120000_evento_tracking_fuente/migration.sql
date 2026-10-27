-- DEUDA (pedido Chat D 2026-10-27) — EventoTracking.fuente — origen del dato.
--
-- Aditiva pura: 1 columna nullable. Zero cambio a datos existentes. Legacy
-- queda NULL (Nacho limpia la DB pre-primer-cliente; sin backfill).
--
-- Valores canónicos (string literal — enum informal controlado en app layer
-- vía lib/constants/fuente-evento.FUENTE_EVENTO):
--   "ML"       → dato de Mercado Libre (webhook/consulta). Sin writers hoy;
--                Chat D lo engancha en MEF.
--   "COURIER"  → dato de consultar al adapter del courier (cron rastreo + rastreo manual).
--   "SISTEMA"  → evento generado automáticamente por la NPMS (bloqueos,
--                destrabes, pendiente inicial, cancelaciones vía webhook plataforma).
--   "OPERADOR" → acción manual humana (cancelar, corregir, inversa, excepciones).

ALTER TABLE "EventoTracking" ADD COLUMN "fuente" TEXT;
