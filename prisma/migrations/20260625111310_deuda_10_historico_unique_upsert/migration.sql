-- DropIndex
DROP INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_modalidad_idx";

-- DropIndex
DROP INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_idx";

-- CreateIndex
CREATE UNIQUE INDEX "HistoricoCotizaciones_courierId_cpOrigen_cpDestino_pesoKg_modalidad_key" ON "HistoricoCotizaciones"("courierId", "cpOrigen", "cpDestino", "pesoKg", "modalidad");

