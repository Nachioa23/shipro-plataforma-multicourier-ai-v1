-- DEUDA 106 pieza 2 mov 2 (2026-08-04): token del comprador para corregir la
-- dirección de un envío RETENIDO. Aditivo: agrega 2 columnas nullable a Envio
-- y un índice único sobre correccionToken. NO destructivo — no toca datos
-- existentes; los envíos ya en BD nacen con ambos campos en NULL.
--
-- La bandera vive en Envio (no en tabla separada) porque hay a lo sumo UN
-- token activo por envío (1:1), el token muere cuando el envío sale de
-- RETENIDO, y @unique nullable permite muchos NULL bajo la constraint (cada
-- NULL cuenta como distinto en Postgres). Ver DEUDA 106 pieza 2 y schema
-- comment en prisma/schema.prisma.
--
-- Aplicar primero a LOCAL. En prod se aplica con `prisma migrate deploy`
-- DESPUÉS de haber deployado el código del movimiento 4 (validación).

-- AlterTable
ALTER TABLE "Envio" ADD COLUMN "correccionToken" TEXT;
ALTER TABLE "Envio" ADD COLUMN "correccionTokenExpira" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Envio_correccionToken_key" ON "Envio"("correccionToken");
