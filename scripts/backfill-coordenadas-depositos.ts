// ==========================================================================
// DEUDA 29 Sub-fase 2.B.0 — Backfill de coordenadas en Deposito.
//
// Uso: npx tsx --env-file=.env.local scripts/backfill-coordenadas-depositos.ts
//
// Nota: el flag --env-file=.env.local es requerido para que el script
// acceda a GOOGLE_MAPS_API_KEY. tsx no carga .env.local automáticamente
// como sí hace Next.js en runtime.
//
// Recorre los depósitos activos sin lat/lng, los geocodifica vía Google Maps
// (helper lib/geo/geocodificar-direccion.ts) y persiste las coordenadas +
// ultimaGeocodificacion. NO toca los que ya tienen coords ni los eliminados.
//
// Idempotente: correrlo N veces solo procesa depósitos que sigan sin coords.
// Geocoding falla → fila queda en null (degradación elegante).
//
// Exit codes:
//   0 si todos los procesados fueron exitosos, o si no había nada que hacer,
//     o si hubo fallidos parciales (degradación esperada).
//   1 si TODOS fallaron (señal de bug: API key inválida, Google caído, etc.).
// ==========================================================================

import { PrismaClient } from "@prisma/client";
import { geocodificarDireccion } from "../lib/geo/geocodificar-direccion";

const prisma = new PrismaClient();

async function main() {
  console.log("[backfill-coords] Buscando depósitos sin coordenadas...");

  const depositos = await prisma.deposito.findMany({
    where: {
      eliminado: false,
      OR: [
        { latitud: null },
        { longitud: null },
      ],
    },
    orderBy: { id: "asc" },
  });

  if (depositos.length === 0) {
    console.log("[backfill-coords] Nada que hacer: 0 depósitos activos sin coords.");
    process.exit(0);
  }

  console.log(`[backfill-coords] ${depositos.length} depósito(s) a procesar.`);
  console.log("");

  let exitosos = 0;
  let fallidos = 0;

  for (const d of depositos) {
    console.log(`[backfill-coords] Procesando id=${d.id} (${d.nombre}) — ${d.direccionCalle} ${d.direccionAltura}, ${d.localidad}, ${d.provincia}...`);

    const coords = await geocodificarDireccion({
      direccionCalle: d.direccionCalle,
      direccionAltura: d.direccionAltura,
      codigoPostal: d.codigoPostal,
      localidad: d.localidad,
      provincia: d.provincia,
      pais: d.pais,
    });

    if (coords) {
      await prisma.deposito.update({
        where: { id: d.id },
        data: {
          latitud: coords.latitud,
          longitud: coords.longitud,
          ultimaGeocodificacion: new Date(),
        },
      });
      console.log(`[backfill-coords] OK id=${d.id} → ${coords.latitud.toFixed(6)}, ${coords.longitud.toFixed(6)}`);
      exitosos++;
    } else {
      console.warn(`[backfill-coords] FALLÓ id=${d.id} (${d.nombre}) — queda sin coords. Ver logs [geo] arriba para la causa.`);
      fallidos++;
    }
  }

  console.log("");
  console.log("[backfill-coords] Resultado:");
  console.log(`  Procesados : ${depositos.length}`);
  console.log(`  Exitosos   : ${exitosos}`);
  console.log(`  Fallidos   : ${fallidos}`);

  // Caso 100% fallido = señal de bug (API key rota, Google caído, schema mal).
  // Resto: fallidos parciales son degradación esperada — exit 0.
  if (exitosos === 0 && fallidos > 0) {
    console.error(`[backfill-coords] FAIL: 0 exitosos de ${depositos.length}. Revisar GOOGLE_MAPS_API_KEY y conectividad.`);
    process.exit(1);
  }
  if (fallidos > 0) {
    console.warn(`[backfill-coords] WARNING: ${fallidos} depósito(s) sin coords. Revisar logs [geo] WARN/ERROR.`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error("[backfill-coords] FATAL no capturado:", e);
  process.exit(1);
});
