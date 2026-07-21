-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "smoActivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smoPrecioAlClienteConIva" DECIMAL(12,2) NOT NULL DEFAULT 0;
