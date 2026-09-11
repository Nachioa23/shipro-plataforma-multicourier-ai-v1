// ============================================================================
// CRON — REINTENTO AUTOMÁTICO DE DESPACHO (Sub-fase 3 Pieza 3, 2026-09-11)
//
// Driver del retry: encuentra envíos en BLOQUEADO_PARCIAL cuyo errorTramo es
// TRANSIENT (timeout / connection reset / red inestable) y llama a
// `reintentarUnEnvio(envioId)` (Pieza 2, race-safe) para cada uno.
//
// Delegación pura: este cron NO tiene lógica de claim / dispatch / débito —
// todo eso lo hace `reintentarUnEnvio` de forma atómica y race-verificada
// (test 6/6 passed en Pieza 2). Este endpoint solo:
//   1. Encuentra candidatos (Prisma where + `esReintentable` in-memory).
//   2. Itera y llama a `reintentarUnEnvio(id)` con try/catch por envío.
//   3. Agrega una summary { procesados, claimed, despachados, fallidos,
//      rendidos, errores } para logging/monitoring.
//
// GIVE-UP: envíos con `retryCount >= MAX_REINTENTOS` NO se retryean —
// `esReintentable` los excluye automáticamente. Quedan en BLOQUEADO_PARCIAL
// para resolución manual del operator. Esta corrida los cuenta como "rendidos"
// (informativo — no dispara ningún side effect nuevo).
//
// CONCURRENCIA: si el cron se dispara dos veces solapado, `reintentarUnEnvio`
// hace un `updateMany` atómico como claim (Postgres serializa) — solo un
// caller gana, los demás abortan sin dispatch. Sin lock extra en el cron.
//
// AUTH: `proxy.ts:111` valida `Authorization: Bearer ${CRON_SECRET}` para todo
// `/api/cron/*`. Este handler no re-verifica.
//
// BATCH CAP: `LOTE_MAXIMO = 50` para acotar la latencia del run (~50 dispatches
// serializados ≈ 50 × latencia courier). Corrida futura levanta lo restante.
//
// ORDEN: FIFO por `ultimoReintento asc` (nulls primero — nunca reintentados
// van al frente). Fairness: los envíos más viejos se procesan antes.
//
// SCOPE — SOLO ORCHESTRACIÓN:
//   - Este endpoint no está wireado en el crontab del server aún (Pieza 4).
//   - Los TODOs de `crear.ts:944` + `dispatch.ts:558-560` documentan la obra.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { esReintentable, filtroReintentablesPrisma, MAX_REINTENTOS } from "@/lib/envios/reintentable";
import { reintentarUnEnvio, type ReintentoResult } from "@/lib/envios/reintentar-envio";

const LOTE_MAXIMO = 50;

export async function GET(_request: Request) {
  try {
    // 1. Encontrar candidatos vía Prisma (state + retryCount cap).
    //    El transient-error filter se aplica in-memory (esFalloTransitorio
    //    lee `errorTramo` del último EventoTracking — Prisma no puede
    //    filtrar via regex portable).
    const candidatosCrudos = await prisma.envio.findMany({
      where: filtroReintentablesPrisma(),
      select: {
        id: true,
        trackingNumber: true,
        estadoActual: true,
        retryCount: true,
        eventos: {
          where: { estado: "BLOQUEADO_PARCIAL" },
          orderBy: { fecha: "desc" },
          take: 1,
          select: { observacion: true },
        },
      },
      orderBy: [{ ultimoReintento: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: LOTE_MAXIMO,
    });

    // 2. Filtrar in-memory con `esReintentable` (usa el errorTramo del último evento).
    const candidatos = candidatosCrudos.filter((e) => {
      const errorTramo = e.eventos[0]?.observacion ?? null;
      return esReintentable({
        estadoActual: e.estadoActual,
        retryCount: e.retryCount,
        errorTramo,
      });
    });

    // 3. Contar los "rendidos" en esta pasada — envíos que llegaron al cap.
    //    Query separada porque los `>= MAX_REINTENTOS` no vienen en el filtro.
    //    Es solo informativo — no dispara side effects.
    const rendidos = await prisma.envio.count({
      where: {
        estadoActual: "BLOQUEADO_PARCIAL",
        retryCount: { gte: MAX_REINTENTOS },
      },
    });

    // 4. Iterar candidatos, delegar a `reintentarUnEnvio`. try/catch por envío
    //    para que uno con exception no aborte el batch.
    let claimed = 0;
    let despachados = 0;
    let fallidos = 0;
    let errores = 0;
    const detalles: ReintentoResult[] = [];

    for (const c of candidatos) {
      try {
        const res = await reintentarUnEnvio(c.id);
        detalles.push(res);
        if (res.claimed) claimed++;
        if (res.dispatched) despachados++;
        if (res.claimed && !res.dispatched) fallidos++;
      } catch (err: any) {
        // Excepción inesperada de reintentarUnEnvio (no debería pasar — la
        // función tiene su propio try/catch interno, pero defense-in-depth).
        errores++;
        console.error(
          `[cron/reintentar-despachos] excepción no manejada para envío ${c.id}:`,
          err?.message || err,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      procesados: candidatos.length,
      claimed,
      despachados,
      fallidos,
      rendidos,
      errores,
      loteMaximo: LOTE_MAXIMO,
      maxReintentos: MAX_REINTENTOS,
      detalles,
    });
  } catch (err: any) {
    console.error("[cron/reintentar-despachos] error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error interno en el cron de reintento" },
      { status: 500 },
    );
  }
}
