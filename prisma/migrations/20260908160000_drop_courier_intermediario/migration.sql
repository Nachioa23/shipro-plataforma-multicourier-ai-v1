-- DropForeignKey
ALTER TABLE "CourierIntermediario" DROP CONSTRAINT "CourierIntermediario_courierId_fkey";

-- DropForeignKey
ALTER TABLE "CourierIntermediario" DROP CONSTRAINT "CourierIntermediario_propietarioCourierId_fkey";

-- DropTable
DROP TABLE "CourierIntermediario";
