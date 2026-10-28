-- EventoTracking.fechaOrigen — hora REAL del evento según la fuente (ML/courier),
-- distinta de `fecha` (hora de inserción en nuestra base). Para medir on-time con
-- precisión (resuelve el skew del cron). Aditivo, nullable, sin backfill.
-- Pedido Chat D (2026-10-28) — núcleo compartido para MEF + couriers a futuro.

ALTER TABLE "EventoTracking" ADD COLUMN "fechaOrigen" TIMESTAMP(3);
