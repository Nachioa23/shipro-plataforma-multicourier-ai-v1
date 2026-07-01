/*
  Warnings:

  - You are about to alter the column `markupFijo` on the `CredencialCourier` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `saldoActivo` on the `Empresa` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `limiteDescubierto` on the `Empresa` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `tarifaPlanaRespaldo` on the `Empresa` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `precioMostrado` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `precioFactura` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `valorDeclarado` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `precioProveedor` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `costoCourierEsperado` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `costoCourierFacturado` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `costoAforo` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `fugaFinanciera` on the `FinanzasEnvio` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `precio` on the `HistoricoCotizaciones` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `montoTotal` on the `LiquidacionMensual` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `monto` on the `MovimientoFinanciero` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `saldoPosterior` on the `MovimientoFinanciero` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `valor` on the `OperacionFee` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.

*/
-- AlterTable
ALTER TABLE "CredencialCourier" ALTER COLUMN "markupFijo" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Empresa" ALTER COLUMN "saldoActivo" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "limiteDescubierto" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "tarifaPlanaRespaldo" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "FinanzasEnvio" ALTER COLUMN "precioMostrado" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "precioFactura" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "valorDeclarado" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "precioProveedor" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "costoCourierEsperado" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "costoCourierFacturado" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "costoAforo" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "fugaFinanciera" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "HistoricoCotizaciones" ALTER COLUMN "precio" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "LiquidacionMensual" ALTER COLUMN "montoTotal" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "MovimientoFinanciero" ALTER COLUMN "monto" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "saldoPosterior" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "OperacionFee" ALTER COLUMN "valor" SET DATA TYPE DECIMAL(12,2);
