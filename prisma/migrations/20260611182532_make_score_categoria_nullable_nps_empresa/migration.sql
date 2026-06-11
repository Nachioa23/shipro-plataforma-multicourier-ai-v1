-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EncuestaNPSEmpresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "score" INTEGER,
    "categoria" TEXT,
    "satisfaccionPlataforma" INTEGER,
    "calidadSoporte" INTEGER,
    "fortaleza" TEXT,
    "sugerencia" TEXT,
    "periodo" TEXT NOT NULL,
    "fechaEnvio" DATETIME NOT NULL,
    "fechaVoto" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tokenVoto" TEXT NOT NULL,
    CONSTRAINT "EncuestaNPSEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EncuestaNPSEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EncuestaNPSEmpresa" ("calidadSoporte", "categoria", "empresaId", "fechaEnvio", "fechaVoto", "fortaleza", "id", "periodo", "satisfaccionPlataforma", "score", "sugerencia", "tokenVoto", "usuarioId") SELECT "calidadSoporte", "categoria", "empresaId", "fechaEnvio", "fechaVoto", "fortaleza", "id", "periodo", "satisfaccionPlataforma", "score", "sugerencia", "tokenVoto", "usuarioId" FROM "EncuestaNPSEmpresa";
DROP TABLE "EncuestaNPSEmpresa";
ALTER TABLE "new_EncuestaNPSEmpresa" RENAME TO "EncuestaNPSEmpresa";
CREATE UNIQUE INDEX "EncuestaNPSEmpresa_tokenVoto_key" ON "EncuestaNPSEmpresa"("tokenVoto");
CREATE INDEX "EncuestaNPSEmpresa_empresaId_periodo_idx" ON "EncuestaNPSEmpresa"("empresaId", "periodo");
CREATE INDEX "EncuestaNPSEmpresa_periodo_idx" ON "EncuestaNPSEmpresa"("periodo");
CREATE UNIQUE INDEX "EncuestaNPSEmpresa_usuarioId_periodo_key" ON "EncuestaNPSEmpresa"("usuarioId", "periodo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
