-- ==========================================================================
-- DEUDA 29 Sub-fase 1.D — Capacidades iniciales de couriers
-- Ver docs/ARQUITECTURA-MULTICOURIER.md sección 6.1
-- ==========================================================================
-- Migration data-only: NO modifica schema, solo aplica los valores de capacidad
-- conocidos para los 2 couriers reales en BD (Andreani id=1, Moci's id=2).
-- Sin esto, ambos quedan con los defaults conservadores del schema (la mayoría
-- false, timeoutCotizacionMs=7000), que no reflejan la realidad operativa.
--
-- Las 3 capacidades de logística inversa de Andreani quedan SIN UPDATE explícito
-- (default false del schema). Razón: el documento de arquitectura las marca
-- como "?" pendientes de confirmar con docs oficiales. Un UPDATE explícito a
-- false afirmaría "Andreani NO acepta inversa", lo cual puede ser incorrecto.
-- Se completarán cuando se integre Andreani como adapter refactorizado en
-- Sub-fase 2 (DEUDA 29).

-- Andreani (id=1)
UPDATE "Courier" SET
  "puedeRecogerDomicilio" = true,
  "puedeConsolidar" = false,
  "puedeEntregarDomicilio" = true,
  "puedeEntregarSucursal" = true,
  "aceptaDropOff" = true,
  "tieneSucursales" = true,
  "timeoutCotizacionMs" = 7000
WHERE "id" = 1;

-- Mocis (id=2)
-- Mocis NO ofrece logística inversa formal (es last-mile zonal AMBA con
-- consolidación), así que las 3 capacidades de inversa se afirman como false
-- explícitamente.
UPDATE "Courier" SET
  "puedeRecogerDomicilio" = true,
  "puedeConsolidar" = true,
  "puedeEntregarDomicilio" = true,
  "puedeEntregarSucursal" = false,
  "aceptaDropOff" = false,
  "tieneSucursales" = false,
  "aceptaInversaCambioMercaderia" = false,
  "aceptaInversaSoloRetiro" = false,
  "aceptaInversaDropOff" = false,
  "timeoutCotizacionMs" = 3000
WHERE "id" = 2;
