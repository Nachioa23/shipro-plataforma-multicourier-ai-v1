// ============================================================================
// CRON — Métricas de confiabilidad (DEUDA 186 PIEZA 2, 2026-10-21).
// ============================================================================
// Puebla MetricaConfiabilidad con % on-time end-to-end + Delivery Estimation
// Accuracy (gap promesa-vs-real avg/P50/P90) por (courier, provincia, ventana).
// Espejo del cron metricas-sla pero mide COSAS DISTINTAS — ver DEUDA 186 §5.bis:
//
//   - metricas-sla          → avg(fechaColecta→fechaEntrega) = VELOCIDAD courier
//   - metricas-confiabilidad → % on-time end-to-end (fechaImpresion→fechaEntrega
//                              vs slaPromesaHs) = CONFIABILIDAD
//
// Coexisten (ambos corren diarios, 15 min de separación).
//
// Decisiones (ratificadas por Nacho, documentadas en §5.bis):
//   - 4 ventanas canónicas (90/180/270/360).
//   - On-time ESTRICTO: horasReales <= slaPromesaHs (sin margen de tolerancia).
//   - Granularidad = provincia (lo que ya hay en Envio.destino.provincia).
//     Refinará a zona fina cuando DEUDA 46 cierre (upsert full-replace soporta
//     cambios de granularidad).
//   - Umbral muestra = 30 (estándar industria para % confiable). Las filas con
//     muestra < 30 se guardan igual con muestraSuficiente=false — el helper
//     (PIEZA 3) decide si confía o cae al fallback.
//   - Provincia NORMALIZADA (toLowerCase+trim) para no fragmentar "Buenos Aires"/
//     "BUENOS AIRES" — corrige el bug conocido de metricas-sla (DEUDA 61).
//   - Filas global (esGlobal=true, provinciaDestino="") agregan todas las
//     provincias por courier/ventana para el fallback Nivel 3 del helper.
//
// MONEY-SAFE: read-only sobre Envio ENTREGADO (ya entregados, inmutables) +
// escribe SOLO en MetricaConfiabilidad (tabla nueva, nadie la lee para plata).
// Zero touch de Envio, MovimientoFinanciero, saldoActivo, FinanzasEnvio.
//
// Idempotente (upsert full-replace); re-ejecución no genera side effects más
// allá de refrescar `fechaActualizacion`.
//
// Pre-datos: las primeras semanas post-deploy, la mayoría de envíos entregados
// tendrán slaPromesaHs = NULL (pre-PIEZA 0) → se saltan → resultado 0 filas.
// Es el comportamiento esperado y correcto (sin leakage temporal). Nivel 4
// (fallback teórico) vive en el helper, no en esta tabla.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizarProvincia } from "@/lib/utils/promesa-calibrada";

export const runtime = "nodejs";
export const maxDuration = 60;

const VENTANAS_CANONICAS = [90, 180, 270, 360] as const;
const UMBRAL_MUESTRA = 30;

// Percentil genérico sobre un array de números. p ∈ [0, 1]. Devuelve 0 si
// vacío (caller debería evitar llamar con vacío, pero defensivo).
function calcularPercentil(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const ordenados = [...arr].sort((a, b) => a - b);
  const indice = Math.floor(ordenados.length * p);
  return ordenados[Math.min(indice, ordenados.length - 1)];
}

interface AgregadoGrupo {
  courierId: number;
  provinciaNorm: string; // normalizada (lowercase+trim); "" para global y zona Flex
  // DEUDA 186 Flex PIEZA 2 — zona ML cuando el grupo es "por zona Flex".
  // null en grupos por provincia / global (mantiene comportamiento original).
  zoneIdMl?: string | null;
  muestra: number;
  cumplieron: number;
  gaps: number[];
}

export async function GET() {
  const resumen = {
    ok: true as boolean,
    ventanas: [] as Array<{
      ventanaDias: number;
      enviosAnalizados: number;
      combinacionesPorProvincia: number;
      combinacionesGlobal: number;
      combinacionesPorZonaFlex: number; // DEUDA 186 Flex PIEZA 2
      filasUpserted: number;
    }>,
    totalFilasUpserted: 0,
  };

  try {
    for (const ventanaDias of VENTANAS_CANONICAS) {
      const desde = new Date();
      desde.setDate(desde.getDate() - ventanaDias);

      // 1. Query: entregados en ventana con promesa persistida.
      const envios = await prisma.envio.findMany({
        where: {
          estadoActual: "ENTREGADO",
          fechaEntrega: { not: null },
          fechaImpresion: { gte: desde },
          slaPromesaHs: { not: null },
        },
        select: {
          courierId: true,
          slaPromesaHs: true,
          fechaImpresion: true,
          fechaEntrega: true,
          // DEUDA 186 Flex PIEZA 2 — zona ML snapshot (PIEZA 1); null en envíos
          // no-Flex. Alimenta el tercer agregador porZonaFlex.
          zoneIdMl: true,
          destino: { select: { provincia: true } },
        },
      });

      // 2. Agrega en memoria. Tres mapas: por provincia + global por courier +
      // por zona Flex (DEUDA 186 Flex PIEZA 2). Un envío Flex (zoneIdMl != null)
      // cuenta en LAS 3 agregaciones — son vistas distintas del mismo dato.
      const porProvincia = new Map<string, AgregadoGrupo>(); // key: "courierId|provinciaNorm"
      const porGlobal = new Map<number, AgregadoGrupo>();    // key: courierId
      const porZonaFlex = new Map<string, AgregadoGrupo>();  // key: "courierId|zoneIdMl"

      for (const e of envios) {
        if (!e.fechaEntrega || !e.slaPromesaHs) continue;
        const provNorm = normalizarProvincia(e.destino?.provincia);
        if (!provNorm) continue; // sin provincia: no agregamos (no granular). Igual entra al global.

        const horasReales = (e.fechaEntrega.getTime() - e.fechaImpresion.getTime()) / (1000 * 60 * 60);
        const cumplio = horasReales <= e.slaPromesaHs;
        const gap = horasReales - e.slaPromesaHs;

        // Agregado por provincia.
        const keyProv = `${e.courierId}|${provNorm}`;
        let grp = porProvincia.get(keyProv);
        if (!grp) {
          grp = { courierId: e.courierId, provinciaNorm: provNorm, muestra: 0, cumplieron: 0, gaps: [] };
          porProvincia.set(keyProv, grp);
        }
        grp.muestra++;
        if (cumplio) grp.cumplieron++;
        grp.gaps.push(gap);

        // Agregado global (todas las provincias del courier).
        let glb = porGlobal.get(e.courierId);
        if (!glb) {
          glb = { courierId: e.courierId, provinciaNorm: "", muestra: 0, cumplieron: 0, gaps: [] };
          porGlobal.set(e.courierId, glb);
        }
        glb.muestra++;
        if (cumplio) glb.cumplieron++;
        glb.gaps.push(gap);

        // Agregado por zona Flex (solo envíos con zoneIdMl persistido — PIEZA 1).
        if (e.zoneIdMl) {
          const keyZona = `${e.courierId}|${e.zoneIdMl}`;
          let zna = porZonaFlex.get(keyZona);
          if (!zna) {
            zna = { courierId: e.courierId, provinciaNorm: "", zoneIdMl: e.zoneIdMl, muestra: 0, cumplieron: 0, gaps: [] };
            porZonaFlex.set(keyZona, zna);
          }
          zna.muestra++;
          if (cumplio) zna.cumplieron++;
          zna.gaps.push(gap);
        }
      }

      // Envíos sin provincia también cuentan en el global + en su zona Flex si
      // tienen zoneIdMl — recorremos otra vez solo para esos (ya saltamos el
      // mapa de provincia en el loop de arriba por continue).
      for (const e of envios) {
        if (!e.fechaEntrega || !e.slaPromesaHs) continue;
        const provNorm = normalizarProvincia(e.destino?.provincia);
        if (provNorm) continue; // ya se contabilizó en el loop de arriba (en el global y por provincia).

        const horasReales = (e.fechaEntrega.getTime() - e.fechaImpresion.getTime()) / (1000 * 60 * 60);
        const cumplio = horasReales <= e.slaPromesaHs;
        const gap = horasReales - e.slaPromesaHs;

        let glb = porGlobal.get(e.courierId);
        if (!glb) {
          glb = { courierId: e.courierId, provinciaNorm: "", muestra: 0, cumplieron: 0, gaps: [] };
          porGlobal.set(e.courierId, glb);
        }
        glb.muestra++;
        if (cumplio) glb.cumplieron++;
        glb.gaps.push(gap);

        // Zona Flex: igual que arriba, también aplica a envíos sin provincia.
        if (e.zoneIdMl) {
          const keyZona = `${e.courierId}|${e.zoneIdMl}`;
          let zna = porZonaFlex.get(keyZona);
          if (!zna) {
            zna = { courierId: e.courierId, provinciaNorm: "", zoneIdMl: e.zoneIdMl, muestra: 0, cumplieron: 0, gaps: [] };
            porZonaFlex.set(keyZona, zna);
          }
          zna.muestra++;
          if (cumplio) zna.cumplieron++;
          zna.gaps.push(gap);
        }
      }

      // 3. Upsert por grupo (por-provincia + global).
      let filasUpserted = 0;

      // DEUDA 186 Flex PIEZA 2 — el upsertGrupo ahora recibe {esGlobal, zoneIdMl}
      // porque el @@unique de MetricaConfiabilidad se amplió a (courierId,
      // provincia, esGlobal, ventana, zoneIdMl). Los grupos provincia/global
      // pasan zoneIdMl:null explícito; el grupo zona Flex pasa el zoneIdMl real.
      const upsertGrupo = async (
        grupo: AgregadoGrupo,
        tipo: { esGlobal: boolean; zoneIdMl: string | null },
      ): Promise<void> => {
        const porcentajeOnTime = (grupo.cumplieron / grupo.muestra) * 100;
        const sumGap = grupo.gaps.reduce((a, b) => a + b, 0);
        const gapPromedio = sumGap / grupo.muestra;
        const gapP50 = calcularPercentil(grupo.gaps, 0.5);
        const gapP90 = calcularPercentil(grupo.gaps, 0.9);
        const muestraSuficiente = grupo.muestra >= UMBRAL_MUESTRA;

        // Provincia: "" en global y zona Flex (la zona ES la granularidad; no
        // mezclar con provincia). Las filas provincia tienen provincia != "".
        const provincia = tipo.esGlobal || tipo.zoneIdMl != null ? "" : grupo.provinciaNorm;

        // Upsert manual (findFirst + update|create) porque Prisma tipea el
        // zoneIdMl del compound unique como `string` strict aunque el schema
        // lo declare nullable. Pasar null explícito al where del findUnique
        // da error de tipos; findFirst sí acepta null directo.
        const existente = await prisma.metricaConfiabilidad.findFirst({
          where: {
            courierId: grupo.courierId,
            provinciaDestino: provincia,
            esGlobal: tipo.esGlobal,
            ventanaDias,
            zoneIdMl: tipo.zoneIdMl, // null para provincia/global, string para zona Flex
          },
          select: { id: true },
        });
        const dataComun = {
          muestra: grupo.muestra,
          cumplieron: grupo.cumplieron,
          porcentajeOnTime: porcentajeOnTime.toFixed(2),
          gapPromedioHs: gapPromedio.toFixed(2),
          gapP50Hs: gapP50.toFixed(2),
          gapP90Hs: gapP90.toFixed(2),
          muestraSuficiente,
        };
        if (existente) {
          await prisma.metricaConfiabilidad.update({
            where: { id: existente.id },
            data: dataComun,
          });
        } else {
          await prisma.metricaConfiabilidad.create({
            data: {
              courierId: grupo.courierId,
              provinciaDestino: provincia,
              esGlobal: tipo.esGlobal,
              ventanaDias,
              zoneIdMl: tipo.zoneIdMl,
              ...dataComun,
            },
          });
        }
        filasUpserted++;
      };

      for (const grp of porProvincia.values()) {
        await upsertGrupo(grp, { esGlobal: false, zoneIdMl: null });
      }
      for (const glb of porGlobal.values()) {
        await upsertGrupo(glb, { esGlobal: true, zoneIdMl: null });
      }
      for (const zna of porZonaFlex.values()) {
        // zoneIdMl != null (se setea al crear el grupo); esGlobal=false
        // (la zona ES la granularidad, no es un global cross-provincia).
        await upsertGrupo(zna, { esGlobal: false, zoneIdMl: zna.zoneIdMl ?? null });
      }

      resumen.ventanas.push({
        ventanaDias,
        enviosAnalizados: envios.length,
        combinacionesPorProvincia: porProvincia.size,
        combinacionesGlobal: porGlobal.size,
        combinacionesPorZonaFlex: porZonaFlex.size,
        filasUpserted,
      });
      resumen.totalFilasUpserted += filasUpserted;
    }

    console.log(
      `[cron/metricas-confiabilidad] completo total=${resumen.totalFilasUpserted} ventanas=${JSON.stringify(resumen.ventanas)}`,
    );
    return NextResponse.json(resumen, { status: 200 });
  } catch (error) {
    console.error("[cron/metricas-confiabilidad] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
