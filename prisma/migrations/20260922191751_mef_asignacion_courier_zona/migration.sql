-- CreateTable
CREATE TABLE "AsignacionCourierZonaFlex" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "zoneIdMl" TEXT NOT NULL,
    "courierId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsignacionCourierZonaFlex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsignacionCourierZonaFlex_courierId_idx" ON "AsignacionCourierZonaFlex"("courierId");

-- CreateIndex
CREATE INDEX "AsignacionCourierZonaFlex_empresaId_idx" ON "AsignacionCourierZonaFlex"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "AsignacionCourierZonaFlex_empresaId_zoneIdMl_key" ON "AsignacionCourierZonaFlex"("empresaId", "zoneIdMl");

-- AddForeignKey
ALTER TABLE "AsignacionCourierZonaFlex" ADD CONSTRAINT "AsignacionCourierZonaFlex_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionCourierZonaFlex" ADD CONSTRAINT "AsignacionCourierZonaFlex_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
