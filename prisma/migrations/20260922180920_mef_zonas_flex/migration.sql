-- AlterTable
ALTER TABLE "CuentaMercadoLibre" ADD COLUMN     "flexConfigurado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flexCutOffTime" TEXT,
ADD COLUMN     "flexDailyCapacity" INTEGER;

-- CreateTable
CREATE TABLE "CuentaMercadoLibreZona" (
    "id" SERIAL NOT NULL,
    "cuentaMercadoLibreId" INTEGER NOT NULL,
    "zoneIdMl" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaMercadoLibreZona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaMercadoLibreZonaCp" (
    "id" SERIAL NOT NULL,
    "zonaId" INTEGER NOT NULL,
    "codigoPostal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaMercadoLibreZonaCp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CuentaMercadoLibreZona_cuentaMercadoLibreId_idx" ON "CuentaMercadoLibreZona"("cuentaMercadoLibreId");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaMercadoLibreZona_cuentaMercadoLibreId_zoneIdMl_key" ON "CuentaMercadoLibreZona"("cuentaMercadoLibreId", "zoneIdMl");

-- CreateIndex
CREATE INDEX "CuentaMercadoLibreZonaCp_zonaId_idx" ON "CuentaMercadoLibreZonaCp"("zonaId");

-- CreateIndex
CREATE INDEX "CuentaMercadoLibreZonaCp_codigoPostal_idx" ON "CuentaMercadoLibreZonaCp"("codigoPostal");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaMercadoLibreZonaCp_zonaId_codigoPostal_key" ON "CuentaMercadoLibreZonaCp"("zonaId", "codigoPostal");

-- AddForeignKey
ALTER TABLE "CuentaMercadoLibreZona" ADD CONSTRAINT "CuentaMercadoLibreZona_cuentaMercadoLibreId_fkey" FOREIGN KEY ("cuentaMercadoLibreId") REFERENCES "CuentaMercadoLibre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaMercadoLibreZonaCp" ADD CONSTRAINT "CuentaMercadoLibreZonaCp_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "CuentaMercadoLibreZona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
