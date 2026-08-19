-- AlterTable
ALTER TABLE "EtiquetaTiendanube" ADD COLUMN     "downloadToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EtiquetaTiendanube_downloadToken_key" ON "EtiquetaTiendanube"("downloadToken");

