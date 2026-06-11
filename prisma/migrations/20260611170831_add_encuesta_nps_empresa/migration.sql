-- CreateTable
CREATE TABLE "EncuestaNPSEmpresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "score" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "satisfaccionPlataforma" INTEGER,
    "calidadSoporte" INTEGER,
    "fortaleza" TEXT,
    "sugerencia" TEXT,
    "periodo" TEXT NOT NULL,
    "fechaEnvio" DATETIME NOT NULL,
    "fechaVoto" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    CONSTRAINT "EncuestaNPSEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EncuestaNPSEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EncuestaNPSEmpresa_empresaId_periodo_idx" ON "EncuestaNPSEmpresa"("empresaId", "periodo");

-- CreateIndex
CREATE INDEX "EncuestaNPSEmpresa_periodo_idx" ON "EncuestaNPSEmpresa"("periodo");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaNPSEmpresa_usuarioId_periodo_key" ON "EncuestaNPSEmpresa"("usuarioId", "periodo");
