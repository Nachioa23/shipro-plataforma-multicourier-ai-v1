-- =============================================================================
-- DEUDA 26 (BLOQUE 2 quick wins, 2026-06-03): limpieza Provincia basura.
-- =============================================================================
-- Contexto: el seed inicial cargo prisma/data/codigos.csv con 20 entradas
-- basura en Provincia, causadas por filas del CSV con comas decimales sin
-- escapar (ej: "RUTA 8 KILOMETRO 19,500 AL 22" se parseaba como localidad
-- "RUTA 8 KILOMETRO 19" + provincia "500 AL 22"). El parser de csv-parser
-- considera estas filas validas sintacticamente — solo el contenido es
-- incorrecto.
--
-- Decision del director (2026-06-03, sesion del 03 de junio):
--   - BORRAR las 20 provincias basura + sus 27 localidades dependientes
--     (via Cascade FK).
--   - Costo: ~10-15 CPs rurales (rutas/kilometros sin localidad humana real)
--     dejan de tener autocompletar. Aceptable porque no impacta usabilidad
--     normal de la mayoria de compradores.
--   - Esos ~15 CPs quedan registrados como deuda residual (DEUDA 40 — recuperar
--     CPs rurales perdidos por parse CSV). No urgente.
--
-- Defensa para el futuro: en el mismo BLOQUE se modifica prisma/seed.ts para
-- validar nombreProvincia contra PROVINCIAS_AR via normalizarProvincia()
-- antes del upsert. Si el seed se vuelve a correr (otro entorno, dev fresh
-- install), las 20 garbage rows NO entran porque el filtro las rechaza.
--
-- Estado esperado post-migration:
--   - Provincia: 44 -> 24 rows (las 24 provincias argentinas reales).
--   - Localidad: 19,201 -> 19,174 rows (-27 por Cascade).
-- =============================================================================

-- Borrar las 20 provincias basura. Cascade FK elimina automaticamente las
-- 27 localidades dependientes.
DELETE FROM "Provincia" WHERE "id" IN (
    4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 16, 17, 18, 19, 23, 32, 37, 39
);
