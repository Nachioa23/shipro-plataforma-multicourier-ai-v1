-- AlterTable
ALTER TABLE "EtiquetaTiendanube" ADD COLUMN     "cancelacionEstado" TEXT,
ADD COLUMN     "cancelacionReasonCode" TEXT,
ADD COLUMN     "cancelacionReasonMessage" TEXT,
ADD COLUMN     "cancelacionResueltaEn" TIMESTAMP(3);

