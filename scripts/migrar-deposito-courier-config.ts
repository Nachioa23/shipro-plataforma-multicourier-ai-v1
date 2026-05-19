// =============================================================================
// MIGRACIÓN DE DATOS: DepositoCourierConfig (DEUDA 29 Sub-fase 6.D RECTIFICADA)
// =============================================================================
//
// Crea filas en DepositoCourierConfig para cada par (depósito × courier_activo)
// de cada empresa. Las filas arrancan con dropOffCliente=false y
// recogeViaConsolidador=false (defaults neutros).
//
// Idempotente: usa upsert con el constraint único (depositoId, courierId).
// Re-ejecutar el script no duplica filas; si una fila ya existe, NO modifica
// los flags del cliente (solo actualiza updatedAt como side effect).
//
// Procesamiento:
// - Solo credenciales con activo=true (las inactivas se ignoran).
// - Solo depósitos con eliminado=false (soft-deleted se ignoran).
// - Si nombreCourier de la credencial no resuelve a un Courier en BD,
//   log warning y skip esa credencial (no aborta el script).
//
// CONTEXTO RECTIFICACIÓN (2026-05-19):
// El script anterior copiaba modoFirstMile + courierRecolectorId desde
// CredencialCourier a DepositoCourierConfig. Tras la rectificación del modelo
// (decisión #49), esos campos ya no viven en DepositoCourierConfig:
//   - modoFirstMile: pasó a ser deducido por el sistema
//   - courierRecolectorId: pasó a Deposito (1 sólo por depósito)
// Ahora el script solo asegura que cada par (depósito × courier_activo) tenga
// una fila inicial con defaults. La configuración explícita (dropOffCliente
// y recogeViaConsolidador) se hace después vía endpoint PUT /api/depositos/[id]/courier-configs.
//
// Uso: npx tsx scripts/migrar-deposito-courier-config.ts
// =============================================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[migrar-deposito-courier-config] Iniciando migración...");

  let totalEmpresas = 0;
  let totalCredencialesProcesadas = 0;
  let totalCredencialesSkipped = 0;
  let totalFilasInsertadas = 0;
  let totalFilasExistentes = 0;
  let totalErrores = 0;

  try {
    // Empresas con al menos 1 credencial activa Y al menos 1 depósito activo.
    const empresas = await prisma.empresa.findMany({
      where: {
        credenciales: { some: { activo: true } },
        depositos: { some: { eliminado: false } },
      },
      include: {
        credenciales: { where: { activo: true } },
        depositos: { where: { eliminado: false } },
      },
    });

    console.log(`[migrar-deposito-courier-config] Empresas a procesar: ${empresas.length}`);

    for (const empresa of empresas) {
      totalEmpresas++;
      console.log(`\n[empresa ${empresa.id}] ${empresa.nombre} (${empresa.credenciales.length} credenciales activas, ${empresa.depositos.length} depósitos activos)`);

      for (const credencial of empresa.credenciales) {
        const courier = await prisma.courier.findFirst({
          where: { nombre: credencial.nombreCourier },
        });

        if (!courier) {
          console.warn(`  [SKIP] Credencial ${credencial.id} apunta a courier "${credencial.nombreCourier}" que no existe en BD. Ignorando.`);
          totalCredencialesSkipped++;
          continue;
        }

        totalCredencialesProcesadas++;

        for (const deposito of empresa.depositos) {
          try {
            // Verificar si la fila ya existe ANTES de upsert
            // para distinguir entre INSERT real y "no-op" (no queremos modificar
            // dropOffCliente/recogeViaConsolidador si el cliente ya los configuró).
            const existente = await prisma.depositoCourierConfig.findUnique({
              where: {
                depositoId_courierId: {
                  depositoId: deposito.id,
                  courierId: courier.id,
                },
              },
            });

            if (existente) {
              totalFilasExistentes++;
              console.log(`  [EXISTE] depósito=${deposito.id} (${deposito.nombre}) courier=${courier.id} (${courier.nombre}) — sin cambios`);
              continue;
            }

            // Crear fila con defaults neutros.
            await prisma.depositoCourierConfig.create({
              data: {
                depositoId: deposito.id,
                courierId: courier.id,
                // dropOffCliente: false (default Prisma)
                // recogeViaConsolidador: false (default Prisma)
              },
            });

            totalFilasInsertadas++;
            console.log(`  [INSERT] depósito=${deposito.id} (${deposito.nombre}) courier=${courier.id} (${courier.nombre}) — defaults aplicados`);
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
    console.log(`  Filas insertadas (nuevas): ${totalFilasInsertadas}`);
    console.log(`  Filas ya existentes:       ${totalFilasExistentes}`);
    console.log(`  Errores:                   ${totalErrores}`);
    console.log("[migrar-deposito-courier-config] ============================");

    if (totalErrores > 0) {
      console.warn(`[migrar-deposito-courier-config] Completado con ${totalErrores} errores. Revisar logs.`);
      process.exit(0);
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
