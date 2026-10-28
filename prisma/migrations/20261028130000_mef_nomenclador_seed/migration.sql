-- MEF Nomenclador seed (Chat D, 2026-10-28). Datos (no schema).
-- Registra la fuente MEF como un Courier VIRTUAL para satisfacer el FK
-- Nomenclador.courierId. activo=false + puedeRecogerDomicilio=false → no
-- aparece en cotizadores ni en ruteo. Única razón de existir: el FK para
-- centralizar los mapeos ML→canónico Shipro (los crudos "status[/substatus]"
-- del shipment body se guardan en EventoTracking.estadoCrudoOriginal y
-- se traducen al LEER vía Nomenclador — mismo patrón que los couriers
-- reales, pero con una SOLA fuente para TODOS los envíos Flex sin importar
-- qué courier físico los lleva).
--
-- Idempotente: ON CONFLICT DO NOTHING. Re-run safe. Si el admin resolvió
-- a mano algún mapeo que acá va en null, su valor queda intacto.

-- 1. Courier virtual "MEF".
INSERT INTO "Courier" ("nombre", "activo", "puedeRecogerDomicilio")
VALUES ('MEF', false, false)
ON CONFLICT ("nombre") DO NOTHING;

-- 2. Mapeos ML (status[/substatus]) → canónico Shipro. Los substatus de
--    not_delivered se desglosan: el "soft" (ausente/dirección/reprogramado)
--    cae a VISITA_FALLIDA; "returning_to_sender" a DEVUELTO_AL_REMITENTE;
--    los "hard" (daño/rechazo/pérdida) a INCIDENCIA.
INSERT INTO "Nomenclador" ("courierId", "estadoCrudo", "estadoShipro")
SELECT c.id, m."estadoCrudo", m."estadoShipro"
FROM "Courier" c
CROSS JOIN (VALUES
  ('ready_to_ship',                       'ETIQUETA_CREADA'),
  ('handling',                            'ETIQUETA_CREADA'),
  ('shipped',                             'EN_TRANSITO_A_DESTINO'),
  ('shipped/out_for_delivery',            'EN_DISTRIBUCION'),
  ('delivered',                           'ENTREGADO'),
  ('not_delivered/buyer_absent',          'VISITA_FALLIDA'),
  ('not_delivered/receiver_absent',       'VISITA_FALLIDA'),
  ('not_delivered/address_not_found',     'VISITA_FALLIDA'),
  ('not_delivered/reprogrammed',          'VISITA_FALLIDA'),
  ('not_delivered/returning_to_sender',   'DEVUELTO_AL_REMITENTE'),
  ('not_delivered/damaged',               'INCIDENCIA'),
  ('not_delivered/refused',               'INCIDENCIA'),
  ('not_delivered/lost',                  'INCIDENCIA'),
  ('cancelled',                           'CANCELADO')
) AS m("estadoCrudo", "estadoShipro")
WHERE c."nombre" = 'MEF'
ON CONFLICT ("courierId", "estadoCrudo") DO NOTHING;
