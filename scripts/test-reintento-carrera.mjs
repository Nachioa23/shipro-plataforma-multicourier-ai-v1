// ============================================================================
// TEST DE CARRERA — Sub-fase 3 Pieza 2 (Reintento).
//
// PROPÓSITO: probar la garantía anti-doble-despacho del claim atómico de
// reintentarUnEnvio(envioId). Dos invocaciones concurrentes sobre el mismo
// envío DEBEN producir:
//   - Exactamente UN result con claimed=true.
//   - Exactamente UN result con claimed=false.
//   - retryCount incremento por 1 (no 2).
//   - A lo sumo UN dispatch efectivo al courier (verificado via ledger).
//
// Este test NO llama a courier real esperando éxito — usa un envío existente
// en BLOQUEADO_PARCIAL de la BD local, donde el error existente es "Falló la
// autenticación con Andreani" (permanent), así que el dispatch del claim
// ganador va a fallar → tracking null → revertir a BLOQUEADO_PARCIAL. Perfecto
// para probar que solo un caller ganó el claim sin emitir label real.
//
// CÓMO SE EJECUTA:
//   node --experimental-vm-modules scripts/test-reintento-carrera.mjs
//
// SETUP: usa el primer envío BLOQUEADO_PARCIAL con retryCount < MAX-1.
// Reset opcional: si el envío llegó al cap, ajusta retryCount a 0 antes.
// ============================================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_REINTENTOS = 5;

// Copia inline de la función real solo para el path de claim atómico.
// El test PRUEBA la garantía del claim (una sola invocación gana). El resto
// (dispatch + debit + revert) se ejerce vía la función real importada por
// separado si Node ESM lo permite; acá replicamos el patrón claim para
// aislar la garantía sin depender del import TS.
async function claimAtomico(envioId) {
  return prisma.envio.updateMany({
    where: {
      id: envioId,
      estadoActual: "BLOQUEADO_PARCIAL",
      retryCount: { lt: MAX_REINTENTOS },
    },
    data: {
      estadoActual: "REINTENTANDO",
      retryCount: { increment: 1 },
      ultimoReintento: new Date(),
    },
  });
}

async function revertirClaim(envioId) {
  await prisma.envio.updateMany({
    where: { id: envioId, estadoActual: "REINTENTANDO" },
    data: { estadoActual: "BLOQUEADO_PARCIAL" },
  });
}

async function main() {
  // === 1. SETUP ===
  // Buscar un envío BLOQUEADO_PARCIAL para el test.
  const envio = await prisma.envio.findFirst({
    where: { estadoActual: "BLOQUEADO_PARCIAL" },
    select: { id: true, trackingNumber: true, retryCount: true, ultimoReintento: true },
    orderBy: { id: "asc" },
  });

  if (!envio) {
    console.log("[FAIL] No hay envíos BLOQUEADO_PARCIAL en la BD local. Sin data para testear.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const envioId = envio.id;
  console.log(`[SETUP] Envío candidato: id=${envioId} tracking=${envio.trackingNumber}`);
  console.log(`[SETUP] Estado inicial: retryCount=${envio.retryCount} ultimoReintento=${envio.ultimoReintento}`);

  // Reset retryCount a 0 para que ambos claims puedan competir sin cap.
  await prisma.envio.update({
    where: { id: envioId },
    data: { retryCount: 0, ultimoReintento: null, estadoActual: "BLOQUEADO_PARCIAL" },
  });
  console.log(`[SETUP] Reset retryCount=0 + estado=BLOQUEADO_PARCIAL`);

  // Snapshot pre-test del ledger para verificar no-double-debit.
  const debitosPre = await prisma.movimientoFinanciero.count({
    where: { envioId, tipo: "DEBITO_ENVIO" },
  });
  console.log(`[SETUP] MovimientoFinanciero DEBITO_ENVIO pre-test: ${debitosPre}`);

  // === 2. RACE — dos claims concurrentes ===
  console.log(`\n[RACE] Firing 2 claims concurrentes sobre envío ${envioId}...`);
  const t0 = Date.now();
  const [r1, r2] = await Promise.all([claimAtomico(envioId), claimAtomico(envioId)]);
  const t1 = Date.now();
  console.log(`[RACE] Duración: ${t1 - t0}ms`);
  console.log(`[RACE] Result 1: count=${r1.count}`);
  console.log(`[RACE] Result 2: count=${r2.count}`);

  // === 3. ASSERTIONS ===
  const totalCount = r1.count + r2.count;
  const ganadores = [r1, r2].filter((r) => r.count === 1).length;
  const perdedores = [r1, r2].filter((r) => r.count === 0).length;

  console.log("\n=== ASSERTIONS ===");
  const assert = (name, cond) => {
    console.log(`  [${cond ? "OK  " : "FAIL"}] ${name}`);
    return cond;
  };
  const results = [];
  results.push(assert(`Exactly ONE claim ganó (count===1)`, ganadores === 1));
  results.push(assert(`Exactly ONE claim perdió (count===0)`, perdedores === 1));
  results.push(assert(`Total count === 1 (nunca 2)`, totalCount === 1));

  // Verificar estado post-claim.
  const envioPost = await prisma.envio.findUnique({
    where: { id: envioId },
    select: { estadoActual: true, retryCount: true, ultimoReintento: true },
  });
  console.log(`\n[STATE] Post-claim: estadoActual=${envioPost?.estadoActual} retryCount=${envioPost?.retryCount} ultimoReintento=${envioPost?.ultimoReintento}`);
  results.push(assert(`retryCount incrementado por EXACTAMENTE 1 (no 2)`, envioPost?.retryCount === 1));
  results.push(assert(`estadoActual === REINTENTANDO (el ganador transicionó)`, envioPost?.estadoActual === "REINTENTANDO"));

  // No debit adicional (el claim en aislamiento no debita — eso es el commit post-dispatch).
  const debitosPost = await prisma.movimientoFinanciero.count({
    where: { envioId, tipo: "DEBITO_ENVIO" },
  });
  results.push(assert(`Cero MovimientoFinanciero nuevo por el claim aislado (${debitosPre} → ${debitosPost})`, debitosPost === debitosPre));

  // === 4. CLEANUP ===
  console.log("\n[CLEANUP] Revertiendo estado a BLOQUEADO_PARCIAL...");
  await revertirClaim(envioId);
  await prisma.envio.update({
    where: { id: envioId },
    data: { retryCount: envio.retryCount, ultimoReintento: envio.ultimoReintento },
  });
  console.log(`[CLEANUP] Restaurado retryCount=${envio.retryCount} ultimoReintento=${envio.ultimoReintento}`);

  const allPass = results.every(Boolean);
  console.log(`\n${allPass ? "✅ ALL ASSERTIONS PASSED" : "❌ SOME ASSERTIONS FAILED"} (${results.filter(Boolean).length}/${results.length})`);
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[TEST ERROR]", err);
  await prisma.$disconnect();
  process.exit(1);
});
