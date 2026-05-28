// =============================================================================
// Script: sincronizar-sucursales-andreani.ts
// =============================================================================
// Wrapper delgado sobre sincronizarCoberturaCourier (lib/sucursales/sync.ts).
// La logica del sync vive en la libreria — esta version es solo el entrypoint
// para correr a mano (npx tsx scripts/sincronizar-sucursales-andreani.ts).
//
// DEUDA 32+37 (Fase F): se extrajo la logica a una funcion reutilizable para
// que el boton manual del drawer admin-couriers y el endpoint cron compartan
// la misma implementacion probada.
// =============================================================================

import prisma from "@/lib/prisma";
import { sincronizarCoberturaCourier } from "@/lib/sucursales/sync";

async function main() {
  // Resolver el courierId de Andreani por nombre.
  const courier = await prisma.courier.findFirst({ where: { nombre: "Andreani" } });
  if (!courier) {
    console.error("[sync-andreani] FATAL: no se encontro el courier 'Andreani' en BD.");
    process.exit(1);
  }

  console.log(`[sync-andreani] Sincronizando courier id=${courier.id} (${courier.nombre})...`);
  const r = await sincronizarCoberturaCourier(courier.id);

  console.log("");
  console.log(`[sync-andreani] Resultado:`);
  console.log(`  aplica:         ${r.aplica}`);
  console.log(`  ok:             ${r.ok}`);
  console.log(`  procesadas:     ${r.procesadas}`);
  console.log(`  exitosas:       ${r.exitosas}`);
  console.log(`  errores:        ${r.errores}`);
  console.log(`  softDeleted:    ${r.softDeleted}`);
  console.log(`  tasaErrorPct:   ${r.tasaErrorPct.toFixed(1)}%`);
  console.log(`  duracionMs:     ${r.duracionMs}`);
  console.log(`  motivo:         ${r.motivo}`);

  // Mismo criterio de exit que el script original:
  //   exit 1 si tasa de error > 5% (ok=false), exit 0 si ok=true.
  process.exit(r.ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("[sync-andreani] FATAL no capturado:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
