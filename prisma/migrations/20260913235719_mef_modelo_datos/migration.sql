-- CreateTable
CREATE TABLE "CuentaMercadoLibre" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "mlUserId" INTEGER NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiraEn" TIMESTAMP(3),
    "nickname" TEXT,
    "scope" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'activa',
    "vinculadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desvinculadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaMercadoLibre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenVinculacionMercadoLibre" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenVinculacionMercadoLibre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacionFlex" (
    "id" SERIAL NOT NULL,
    "notificacionId" TEXT NOT NULL,
    "mlUserId" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "shipmentId" TEXT,
    "empresaId" INTEGER,
    "attempts" INTEGER,
    "sent" TIMESTAMP(3),
    "received" TIMESTAMP(3),
    "payloadRaw" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'recibida',
    "recibidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacionFlex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CuentaMercadoLibre_empresaId_key" ON "CuentaMercadoLibre"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaMercadoLibre_mlUserId_key" ON "CuentaMercadoLibre"("mlUserId");

-- CreateIndex
CREATE INDEX "CuentaMercadoLibre_empresaId_idx" ON "CuentaMercadoLibre"("empresaId");

-- CreateIndex
CREATE INDEX "CuentaMercadoLibre_estado_idx" ON "CuentaMercadoLibre"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "TokenVinculacionMercadoLibre_token_key" ON "TokenVinculacionMercadoLibre"("token");

-- CreateIndex
CREATE INDEX "TokenVinculacionMercadoLibre_empresaId_idx" ON "TokenVinculacionMercadoLibre"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacionFlex_notificacionId_key" ON "NotificacionFlex"("notificacionId");

-- CreateIndex
CREATE INDEX "NotificacionFlex_shipmentId_idx" ON "NotificacionFlex"("shipmentId");

-- CreateIndex
CREATE INDEX "NotificacionFlex_estado_idx" ON "NotificacionFlex"("estado");

-- AddForeignKey
ALTER TABLE "CuentaMercadoLibre" ADD CONSTRAINT "CuentaMercadoLibre_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenVinculacionMercadoLibre" ADD CONSTRAINT "TokenVinculacionMercadoLibre_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacionFlex" ADD CONSTRAINT "NotificacionFlex_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
