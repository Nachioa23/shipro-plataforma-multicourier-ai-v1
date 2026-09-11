-- AlterTable
ALTER TABLE "Envio" ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimoReintento" TIMESTAMP(3);
