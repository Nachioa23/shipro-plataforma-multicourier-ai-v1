-- CreateEnum
CREATE TYPE "PlataformaConexion" AS ENUM ('TIENDANUBE', 'WOOCOMMERCE', 'VTEX', 'MAGENTO', 'PRESTASHOP', 'SHOPIFY', 'MERCADOLIBRE', 'API_REST');

-- CreateEnum
CREATE TYPE "MecanismoConexion" AS ENUM ('API_KEY', 'OAUTH');

-- CreateEnum
CREATE TYPE "EstadoConexion" AS ENUM ('ACTIVA', 'PENDIENTE', 'REVOCADA');

-- CreateTable
CREATE TABLE "Conexion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "plataforma" "PlataformaConexion" NOT NULL,
    "mecanismo" "MecanismoConexion" NOT NULL,
    "estado" "EstadoConexion" NOT NULL DEFAULT 'PENDIENTE',
    "referenciaExterna" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conexion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conexion_empresaId_idx" ON "Conexion"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Conexion_empresaId_plataforma_key" ON "Conexion"("empresaId", "plataforma");

-- AddForeignKey
ALTER TABLE "Conexion" ADD CONSTRAINT "Conexion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
