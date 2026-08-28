-- CreateEnum
CREATE TYPE "DescuentoClienteModo" AS ENUM ('MONTO', 'PORCENTAJE');

-- AlterTable
ALTER TABLE "CredencialCourier" ADD COLUMN     "descuentoClienteModo" "DescuentoClienteModo" NOT NULL DEFAULT 'MONTO',
ADD COLUMN     "descuentoClientePorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 0;
