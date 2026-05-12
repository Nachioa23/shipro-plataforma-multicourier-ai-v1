// ==========================================================================
// DEUDA 29 Sub-fase 2 — Commit 2.A
// Sincronización inicial de sucursales Andreani contra el endpoint público
// /v2/sucursales (sin auth).
//
// Uso: npx tsx scripts/sincronizar-sucursales-andreani.ts
//
// Filtro: canal === "B2C" AND datosAdicionales.seHaceAtencionAlCliente === true
//   - Decisión del director técnico (ver docs/SESIONES.md): captura puntos
//     físicamente accesibles al público B2C, incluyendo Centros de Distribución
//     con atención (ej. 10021 San Martín) que el filtro tipo="SUCURSAL" excluye.
//
// Idempotente: correrlo N veces no duplica datos.
// Soft-delete: sucursales que dejaron de aparecer en el API quedan eliminada=true,
//   activa=false. No se borran físicamente (FKs desde TramoEnvio y DSPreferida).
//
// LIMITACIÓN CONOCIDA:
// El endpoint público devuelve codigosPostalesAtendidos = null para ~15% de las
// sucursales elegibles (Microcentro, Belgrano, Tribunales, Once, San Isidro,
// Salta, Tucumán, Resistencia, Posadas, etc.). Estas sucursales se crean en BD
// con toda su info excepto la cobertura geográfica de CPs.
// TODO Sub-fase 5: completar con /v2/puntos-de-tercero autenticado para esas
// sucursales (requiere credenciales de contrato + lógica de fallback).
// ==========================================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANDREANI_URL = "https://apis.andreani.com/v2/sucursales";
const ANDREANI_COURIER_ID = 1; // Confirmado en commit 1.D

interface SucursalApiRaw {
  id: number;
  codigo?: string;
  numero?: string;
  descripcion?: string;
  canal?: string;
  direccion?: {
    calle?: string;
    numero?: string;
    provincia?: string;
    localidad?: string;
    region?: string;
    pais?: string;
    codigoPostal?: string;
  };
  coordenadas?: { latitud?: string; longitud?: string };
  horarioDeAtencion?: string;
  datosAdicionales?: {
    seHaceAtencionAlCliente?: boolean;
    tipo?: string;
    admiteEnvios?: boolean;
    entregaEnvios?: boolean;
    conBuzonInteligente?: boolean;
  };
  telefonos?: string[];
  codigosPostalesAtendidos?: string[];
}

async function main() {
  console.log("[sync-andreani] Descargando sucursales desde", ANDREANI_URL);

  // -----------------------------------------------------------------------
  // 1. Descargar y parsear el response. Cualquier falla acá → abort sin
  //    tocar la BD (FATAL, exit 1).
  // -----------------------------------------------------------------------
  let all: SucursalApiRaw[];
  try {
    const res = await fetch(ANDREANI_URL);
    if (!res.ok) {
      console.error(`[sync-andreani] FATAL: Andreani API devolvió HTTP ${res.status} ${res.statusText}.`);
      process.exit(1);
    }
    all = await res.json();
  } catch (e: any) {
    console.error(`[sync-andreani] FATAL: error de red o parseo JSON: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(all)) {
    console.error("[sync-andreani] FATAL: el response no es un array.");
    process.exit(1);
  }

  console.log(`[sync-andreani] Recibidas ${all.length} entradas totales.`);

  // -----------------------------------------------------------------------
  // 2. Aplicar el filtro acordado: canal B2C + atención al público.
  // -----------------------------------------------------------------------
  const elegibles = all.filter(
    s => s.canal === "B2C" && s.datosAdicionales?.seHaceAtencionAlCliente === true
  );
  console.log(`[sync-andreani] Elegibles para sync: ${elegibles.length}.`);

  if (elegibles.length === 0) {
    console.error("[sync-andreani] FATAL: 0 sucursales elegibles. Verificar el filtro o que la API devolvió data válida.");
    process.exit(1);
  }

  let nuevas = 0;
  let actualizadas = 0;
  let errores = 0;
  const idsExternosVistos: string[] = [];

  // -----------------------------------------------------------------------
  // 3. Por cada sucursal elegible: upsert en SucursalCourier + sync exacto
  //    de CPs en SucursalCourierCp.
  //    Errores individuales se loggean y NO abortan el loop.
  // -----------------------------------------------------------------------
  for (const suc of elegibles) {
    try {
      const idExterno = String(suc.id);
      idsExternosVistos.push(idExterno);

      const lat = parseFloat(suc.coordenadas?.latitud ?? "");
      const lng = parseFloat(suc.coordenadas?.longitud ?? "");
      const telCrudo = (suc.telefonos?.[0] || "").trim();

      // Detectar si la fila existía antes para contar nuevas vs. actualizadas
      // (comparar createdAt/updatedAt es frágil por precisión de timestamps).
      // 1 query extra por sucursal × ~200 sucursales — overhead despreciable.
      const existente = await prisma.sucursalCourier.findUnique({
        where: { courierId_idExterno: { courierId: ANDREANI_COURIER_ID, idExterno } },
        select: { id: true },
      });

      const data = {
        codigo: suc.codigo || null,
        nombre: suc.descripcion || "Sin nombre",
        tipo: "sucursal_propia",
        direccionCalle: suc.direccion?.calle || null,
        direccionAltura: suc.direccion?.numero || null,
        codigoPostal: suc.direccion?.codigoPostal || "",
        localidad: suc.direccion?.localidad || "",
        provincia: suc.direccion?.provincia || "",
        pais: suc.direccion?.pais || "Argentina",
        // parseFloat("") → NaN. isFinite descarta NaN, Infinity y -Infinity.
        latitud: isFinite(lat) ? lat : null,
        longitud: isFinite(lng) ? lng : null,
        aceptaAdmision: suc.datosAdicionales?.admiteEnvios ?? false,
        aceptaEntrega: suc.datosAdicionales?.entregaEnvios ?? false,
        // No viene del API público. Coherente con commit 1.D (no afirmamos
        // capacidades de inversa sin confirmación oficial).
        aceptaDevolucion: false,
        aceptaB2C: suc.canal === "B2C",
        aceptaB2B: suc.canal === "B2B",
        tieneBuzonInteligente: suc.datosAdicionales?.conBuzonInteligente ?? false,
        // Todas las elegibles pasaron el filtro `seHaceAtencionAlCliente === true`,
        // pero lo guardamos explícitamente para queries runtime sin re-sync.
        seHaceAtencionAlCliente: true,
        horariosJson: suc.horarioDeAtencion || null,
        telefono: telCrudo || null,
        email: null,
        fechaUltimaConfirmacion: new Date(),
        // Re-activamos si estaba soft-deleted en una corrida anterior con filtro
        // distinto y ahora vuelve a entrar.
        activa: true,
        eliminada: false,
      };

      const upserted = await prisma.sucursalCourier.upsert({
        where: { courierId_idExterno: { courierId: ANDREANI_COURIER_ID, idExterno } },
        create: { courierId: ANDREANI_COURIER_ID, idExterno, ...data },
        update: data,
      });

      if (existente) actualizadas++;
      else nuevas++;

      // -------------------------------------------------------------------
      // Sync exacto de CPs: borra TODOS los viejos y crea los nuevos en
      // una transacción atómica. Aceptable porque la tabla puente no tiene
      // valor histórico (no la referencian envíos pasados).
      // Deduplica por si el API devuelve un CP repetido en la misma sucursal
      // (rompería el unique compuesto si lo persistiéramos sin filtrar).
      // -------------------------------------------------------------------
      const cpsCrudos = suc.codigosPostalesAtendidos;
      const cpsNuevos: string[] = Array.isArray(cpsCrudos)
        ? Array.from(new Set(cpsCrudos.map(cp => String(cp).trim()).filter(Boolean)))
        : [];

      await prisma.$transaction([
        prisma.sucursalCourierCp.deleteMany({ where: { sucursalCourierId: upserted.id } }),
        ...(cpsNuevos.length > 0
          ? [prisma.sucursalCourierCp.createMany({
              data: cpsNuevos.map(cp => ({ sucursalCourierId: upserted.id, codigoPostal: cp })),
            })]
          : []),
      ]);
    } catch (e: any) {
      errores++;
      console.warn(`[sync-andreani] FALLÓ id=${suc.id} (${suc.codigo || "sin-codigo"}): ${e.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // 4. Soft-delete de huérfanas: sucursales en BD que no aparecen en el
  //    response actual. Mantienen FKs vivas, solo cambian activa/eliminada.
  // -----------------------------------------------------------------------
  const huerfanas = await prisma.sucursalCourier.updateMany({
    where: {
      courierId: ANDREANI_COURIER_ID,
      idExterno: { notIn: idsExternosVistos },
      eliminada: false,
    },
    data: { eliminada: true, activa: false },
  });

  // -----------------------------------------------------------------------
  // 5. Logging estructurado + exit code basado en tasa de error.
  // -----------------------------------------------------------------------
  console.log("");
  console.log("[sync-andreani] Resultado:");
  console.log(`  Procesadas elegibles : ${elegibles.length}`);
  console.log(`  Nuevas               : ${nuevas}`);
  console.log(`  Actualizadas         : ${actualizadas}`);
  console.log(`  Errores              : ${errores}`);
  console.log(`  Soft-deleted         : ${huerfanas.count}`);

  console.log("");
  console.log("[sync-andreani] NOTA: las sucursales sin CPs (codigosPostalesAtendidos null en el API público)");
  console.log("[sync-andreani] aparecerán en búsqueda por cercanía (lat/lng) pero NO en búsqueda inversa por CP.");
  console.log("[sync-andreani] TODO Sub-fase 5: completar con /v2/puntos-de-tercero autenticado para esas sucursales.");

  const tasaError = errores / elegibles.length;
  if (tasaError > 0.05) {
    console.error(`[sync-andreani] FAIL: tasa de error ${(tasaError * 100).toFixed(1)}% supera el umbral de 5%.`);
    process.exit(1);
  }
  if (errores > 0) {
    console.warn(`[sync-andreani] WARNING: ${errores} errores parciales (${(tasaError * 100).toFixed(1)}%, dentro del umbral del 5%).`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error("[sync-andreani] FATAL no capturado:", e);
  process.exit(1);
});
