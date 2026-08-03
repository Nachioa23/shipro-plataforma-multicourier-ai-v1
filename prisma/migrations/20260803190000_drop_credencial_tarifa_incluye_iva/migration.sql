-- DEUDA 123 mov 3 (2026-08-03): drop de la columna huérfana
-- CredencialCourier.tarifaIncluyeIva.
--
-- El flag ahora vive en el adapter (ICourierIntegrator.tarifaApiIncluyeIva —
-- movement 1, commit 88abb30) y el motor lo lee desde ahí en cotización y en
-- el fallback de crear.ts (movement 2, commit 48d2067). La conciliación sigue
-- usando su propia bandera Excel-declared (tarifaExcelIncluyeIva), que es
-- independiente y no depende de esta columna.
--
-- Destructiva: pierde el valor por-credencial. Aceptable porque el flag había
-- degenerado a "una copia por-empresa de la propiedad del adapter" — y el
-- default true producía UNDERCHARGE de ~17% en credenciales creadas fuera del
-- seed (mordió en el deploy FASE 2, 2026-08-03).
--
-- Aplicar primero a LOCAL. En prod se aplica con `prisma migrate deploy`
-- DESPUÉS de haber deployado el código de movements 1+2.

-- AlterTable
ALTER TABLE "CredencialCourier" DROP COLUMN "tarifaIncluyeIva";
