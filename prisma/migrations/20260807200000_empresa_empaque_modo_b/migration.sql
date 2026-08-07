-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "empaqueModoBActivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "empaqueModoBAltoCm" DOUBLE PRECISION,
ADD COLUMN     "empaqueModoBAnchoCm" DOUBLE PRECISION,
ADD COLUMN     "empaqueModoBLargoCm" DOUBLE PRECISION,
ADD COLUMN     "empaqueModoBPesoKg" DOUBLE PRECISION;

