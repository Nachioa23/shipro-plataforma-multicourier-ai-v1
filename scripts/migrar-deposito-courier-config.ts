// =============================================================================
// MIGRACIÓN DE DATOS: DepositoCourierConfig (DEUDA 29 Sub-fase 6.D.1)
// =============================================================================
//
// Genera filas iniciales en DepositoCourierConfig basadas en el estado actual
// de CredencialCourier × Deposito por empresa. La configuración operativa de
// First-Mile (modoFirstMile + courierRecolectorId) se replica desde la
// credencial empresa-level a cada par (depósito × courier) de esa empresa.
//
// Idempotente: usa upsert con el constraint único (depositoId, courierId).
// Re-ejecutar el script no duplica filas; solo actualiza modoFirstMile si
// cambió en la credencial origen.
//
// Procesamiento:
// - Solo credenciales con activo=true (las inactivas se ignoran).
// - Solo depósitos con eliminado=false (soft-deleted se ignoran).
// - Si nombreCourier de la credencial no resuelve a un Courier en BD,
//   log warning y skip esa credencial (no aborta el script).
//
// Uso: npx tsx scripts/migrar-deposito-courier-config.ts
//
// Estado esperado post-ejecución (BD actual con 1 empresa Mowi):
//   2 credenciales activas × 2 depósitos = 4 filas insertadas en
//   DepositoCourierConfig, todas con modoFirstMile="mismo_courier" y
//   courierRecolectorId=null (estado actual de las credenciales).
// =============================================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[migrar-deposito-courier-config] Iniciando migración...");

  let totalEmpresas = 0;
  let totalCredencialesProcesadas = 0;
  let totalCredencialesSkipped = 0;
  let totalFilasInsertadas = 0;
  let totalFilasActualizadas = 0;
  let totalErrores = 0;

  try {
    // Obtener todas las empresas que tienen credenciales activas Y depósitos activos.
    const empresas = await prisma.empresa.findMany({
      where: {
        credenciales: {
          some: { activo: true },
        },
        depositos: {
          some: { eliminado: false },
        },
      },
      include: {
        credenciales: {
          where: { activo: true },
        },
        depositos: {
          where: { eliminado: false },
        },
      },
    });

    console.log(`[migrar-deposito-courier-config] Empresas a procesar: ${empresas.length}`);

    for (const empresa of empresas) {
      totalEmpresas++;
      console.log(`\n[empresa ${empresa.id}] ${empresa.nombre} (${empresa.credenciales.length} credenciales activas, ${empresa.depositos.length} depósitos activos)`);

      for (const credencial of empresa.credenciales) {
        // Resolver el courierId real desde el nombreCourier.
        const courier = await prisma.courier.findFirst({
          where: { nombre: credencial.nombreCourier },
        });

        if (!courier) {
          console.warn(`  [SKIP] Credencial ${credencial.id} apunta a courier "${credencial.nombreCourier}" que no existe en BD. Ignorando.`);
          totalCredencialesSkipped++;
          continue;
        }

        totalCredencialesProcesadas++;

        // Para cada depósito de la empresa, hacer upsert en DepositoCourierConfig.
        for (const deposito of empresa.depositos) {
          try {
            const result = await prisma.depositoCourierConfig.upsert({
              where: {
                depositoId_courierId: {
                  depositoId: deposito.id,
                  courierId: courier.id,
                },
              },
              update: {
                modoFirstMile: credencial.modoFirstMile,
                courierRecolectorId: credencial.courierRecolectorId,
              },
              create: {
                depositoId: deposito.id,
                courierId: courier.id,
                modoFirstMile: credencial.modoFirstMile,
                courierRecolectorId: credencial.courierRecolectorId,
              },
            });

            // Detección heurística de insert vs update por createdAt vs updatedAt.
            const esNueva =
              Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 100;
            if (esNueva) {
              totalFilasInsertadas++;
              console.log(`  [INSERT] depósito=${deposito.id} (${deposito.nombre}) courier=${courier.id} (${courier.nombre}) modo=${credencial.modoFirstMile}`);
            } else {
              totalFilasActualizadas++;
              console.log(`  [UPDATE] depósito=${deposito.id} (${deposito.nombre}) courier=${courier.id} (${courier.nombre}) modo=${credencial.modoFirstMile}`);
            }
          } catch (e) {
            totalErrores++;
            console.error(`  [ERROR] depósito=${deposito.id} courier=${courier.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }

    console.log("\n[migrar-deposito-courier-config] ============================");
    console.log(`[migrar-deposito-courier-config] Resumen final:`);
    console.log(`  Empresas procesadas:       ${totalEmpresas}`);
    console.log(`  Credenciales procesadas:   ${totalCredencialesProcesadas}`);
    console.log(`  Credenciales saltadas:     ${totalCredencialesSkipped}`);
    console.log(`  Filas insertadas:          ${totalFilasInsertadas}`);
    console.log(`  Filas actualizadas:        ${totalFilasActualizadas}`);
    console.log(`  Errores:                   ${totalErrores}`);
    console.log("[migrar-deposito-courier-config] ============================");

    if (totalErrores > 0) {
      console.warn(`[migrar-deposito-courier-config] Completado con ${totalErrores} errores. Revisar logs.`);
      process.exit(0); // exit 0 con warnings (no fatal)
    } else {
      console.log("[migrar-deposito-courier-config] ✅ Completado sin errores.");
      process.exit(0);
    }
  } catch (e) {
    console.error("[migrar-deposito-courier-config] FATAL:", e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
