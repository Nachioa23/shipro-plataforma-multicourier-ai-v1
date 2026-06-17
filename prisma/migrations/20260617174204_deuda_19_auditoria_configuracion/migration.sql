-- CreateTable
CREATE TABLE "AuditoriaConfiguracion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmail" TEXT,
    "rolUsuario" TEXT,
    "ipOrigen" TEXT,
    "empresaId" INTEGER NOT NULL,
    "courierId" INTEGER,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNuevo" TEXT,
    "motivo" TEXT,
    CONSTRAINT "AuditoriaConfiguracion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditoriaConfiguracion_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AuditoriaConfiguracion_empresaId_fecha_idx" ON "AuditoriaConfiguracion"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "AuditoriaConfiguracion_courierId_fecha_idx" ON "AuditoriaConfiguracion"("courierId", "fecha");

-- CreateIndex
CREATE INDEX "AuditoriaConfiguracion_campo_fecha_idx" ON "AuditoriaConfiguracion"("campo", "fecha");
