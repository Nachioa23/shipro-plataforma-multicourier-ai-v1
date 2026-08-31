-- DEUDA 160 (2026-08-31): drop 4 campos fantasma sin uso vivo.
-- Ver DEUDAS.md — DEUDA 160 avance 1: recon confirmó 0 readers/writers app-code.
-- porcentajePrecioFactura: ghost total (solo schema decl).
-- seguroFijoIntermediarioConIva + tarifaIncluyeIvaIntermediario: solo seed writes,
--   sin readers. Ghost DEFINITIVO (Nacho confirmó: intermediary fixed markup N/A permanente).
-- tarifaPlanaRespaldo: legacy DEUDA 132 Paso 5a, reemplazado por tarifaPlanaRespaldoCourier.

-- AlterTable
ALTER TABLE "CourierIntermediario" DROP COLUMN "seguroFijoIntermediarioConIva",
DROP COLUMN "tarifaIncluyeIvaIntermediario";

-- AlterTable
ALTER TABLE "CredencialCourier" DROP COLUMN "tarifaPlanaRespaldo";

-- AlterTable
ALTER TABLE "FinanzasEnvio" DROP COLUMN "porcentajePrecioFactura";
