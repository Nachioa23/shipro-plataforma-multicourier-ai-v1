import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, EstadoLiquidacion } from "@prisma/client";
import { evaluarSuspension, suspenderEmpresa, reactivarEmpresa } from "@/lib/utils/suspension-cuenta";

// ============================================================================
// POST /api/conciliacion/revertir — undo de una corrida de conciliación.
// Body: { runId: number }
//
// Restaura los 8 campos de FinanzasEnvio guardados en ConciliacionRun.snapshot
// (pesoAforado, costoCourierEsperado, costoCourierFacturado, estadoAuditoria,
// facturaCourierRef, costoAforo, periodoLogistica, estadoLiquidacionLogistica)
// a los valores previos a la corrida.
//
// PASO 2b (2026-07-27): además de restaurar los FinanzasEnvio, ahora reversa el
// dinero movido por la corrida (débitos prepago). Por cada DEBITO_AJUSTE_AFORO
// creado con conciliacionRunId=runId, crea un CREDITO_REVERSO_AFORO compensatorio
// (asiento inverso, NO delete/edit del original). El saldo vuelve al valor previo
// y la marca facturaCourierRef=null habilita re-importar la factura corregida.
//
// Guards:
//   1. run no existe → 404
//   2. run ya revertida → 409
//   3. algún envío del snapshot ya está en una LiquidacionMensual (vías nuevas
//      Fee/Logistica en LIQUIDADO) → 409. Racional: el mes ya cerró y una
//      reversión descuadraría el total emitido al cliente. Corregir con
//      ajuste, no con reversión de conciliación.
// ============================================================================

type SnapshotPrior = {
  pesoAforado: number | null;
  costoCourierEsperado: string | null;
  costoCourierFacturado: string | null;
  estadoAuditoria: string | null;
  facturaCourierRef: string | null;
  // costoAforo: 2026-07-27 la convención cambió de con-IVA a NETO (regla
  // plataforma: todo neto, IVA una vez en la proforma). Los snapshots viejos
  // que hayan capturado un costoAforo con-IVA (ninguno en test local; ver
  // check al fixear) restaurarían el valor con-IVA — inconsistente con el
  // nuevo writer. No hay migración porque data es de prueba y no hay corridas
  // previas con costoAforo > 0; se documenta acá el cambio de semántica.
  costoAforo: string | null;
  // STEP 1 (dos-vías-liquidación): capturamos también la vía logística porque
  // la conciliación la avanza de PENDIENTE → EN_PROCESO en Rama A. Nullable en
  // snapshots antiguos (pre-STEP-1); el restore hace fallback defensivo.
  periodoLogistica?: string | null;
  estadoLiquidacionLogistica?: EstadoLiquidacion | null;
  // PASO 2b: registro auditable de si la corrida creó un débito prepago
  // real-time para este envío. Puede ser null (postpago, sin aforo, o snapshot
  // pre-PASO-2b). La reversión primaria se hace por la FK conciliacionRunId
  // en MovimientoFinanciero, no por este campo — es solo trazabilidad.
  aforoDebitadoConIva?: string | null;
};

type SnapshotEntry = {
  finanzasEnvioId: number;
  prior: SnapshotPrior;
};

export async function POST(request: Request) {
  // Mismo gate de rol que POST /api/conciliacion (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { runId } = await request.json();
    if (typeof runId !== "number" || !Number.isInteger(runId) || runId <= 0) {
      return NextResponse.json({ error: "runId inválido: se espera un entero positivo." }, { status: 400 });
    }

    // Guard 1: run existe.
    const run = await prisma.conciliacionRun.findUnique({ where: { id: runId } });
    if (!run) {
      return NextResponse.json({ error: `Corrida no encontrada (runId=${runId}).` }, { status: 404 });
    }

    // Guard 2: no revertida antes.
    if (run.revertida) {
      return NextResponse.json(
        { error: `La corrida ${runId} ya fue revertida el ${run.fechaReversion?.toISOString()}. No se puede revertir dos veces.` },
        { status: 409 }
      );
    }

    // El snapshot se persiste como Json. En TS es unknown; validamos shape mínimo.
    const snapshot = run.snapshot as unknown as SnapshotEntry[];
    if (!Array.isArray(snapshot)) {
      return NextResponse.json(
        { error: `Snapshot de la corrida ${runId} tiene formato inválido.` },
        { status: 500 }
      );
    }

    // Guard 3: si algún envío del snapshot ya cerró en una LiquidacionMensual
    // (vía Fee o Logística), no se puede revertir sin descuadrar el mes emitido.
    const finanzasEnvioIds = snapshot.map(s => s.finanzasEnvioId);
    const enviosLiquidados = await prisma.envio.findMany({
      where: {
        finanzas: {
          id: { in: finanzasEnvioIds },
          OR: [
            { estadoLiquidacionFee: EstadoLiquidacion.LIQUIDADO },
            { estadoLiquidacionLogistica: EstadoLiquidacion.LIQUIDADO },
          ],
        },
      },
      select: { id: true, trackingNumber: true },
    });
    if (enviosLiquidados.length > 0) {
      return NextResponse.json(
        {
          error:
            `No se puede revertir la corrida ${runId}: ${enviosLiquidados.length} envío(s) ` +
            `del snapshot ya fueron cerrados en una LiquidacionMensual. El mes ya cerró y ` +
            `revertir descuadraría la liquidación emitida al cliente. Corregí con un ajuste, ` +
            `no con una reversión.`,
          enviosLiquidados: enviosLiquidados.length,
        },
        { status: 409 }
      );
    }

    // Restauración atómica: para cada entry, restaurar los 6 campos y marcar
    // el run como revertido dentro de la misma transacción.
    //
    // Iteramos en REVERSA (last → first) para el caso patológico de un mismo
    // tracking repetido dentro del Excel de la corrida original. Escenario:
    //   fila 1 (tracking T): snapshot=[valor ORIGINAL], write=DOBLE_COBRO/aforo/etc.
    //   fila 2 (tracking T): snapshot=[valor YA MODIFICADO por fila 1], write=DOBLE_COBRO
    // En orden natural, la última entry sobrescribiría a la primera y el envío
    // quedaría en el estado MODIFICADO. Al recorrer en reversa, la entry más
    // vieja (con el valor ORIGINAL) se aplica ÚLTIMA y por lo tanto gana.
    const resultado = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (let i = snapshot.length - 1; i >= 0; i--) {
        const entry = snapshot[i];
        await tx.finanzasEnvio.update({
          where: { id: entry.finanzasEnvioId },
          data: {
            pesoAforado: entry.prior.pesoAforado,
            costoCourierEsperado: entry.prior.costoCourierEsperado != null
              ? new Prisma.Decimal(entry.prior.costoCourierEsperado)
              : null,
            costoCourierFacturado: entry.prior.costoCourierFacturado != null
              ? new Prisma.Decimal(entry.prior.costoCourierFacturado)
              : null,
            // estadoAuditoria es non-nullable en el schema (default "PENDIENTE");
            // el fallback cubre snapshots viejos si alguna vez viniera null.
            estadoAuditoria: entry.prior.estadoAuditoria ?? "PENDIENTE",
            facturaCourierRef: entry.prior.facturaCourierRef,
            costoAforo: entry.prior.costoAforo != null
              ? new Prisma.Decimal(entry.prior.costoAforo)
              : null,
            // STEP 1 (dos-vías-liquidación): restaurar la vía logística.
            // Para snapshots antiguos (pre-STEP-1) los campos vienen undefined
            // → mantenemos lo que la fila tenga hoy (no lo pisamos).
            ...(entry.prior.periodoLogistica !== undefined
              ? { periodoLogistica: entry.prior.periodoLogistica }
              : {}),
            ...(entry.prior.estadoLiquidacionLogistica
              ? { estadoLiquidacionLogistica: entry.prior.estadoLiquidacionLogistica }
              : {}),
          },
        });
        count++;
      }

      // ============================================================
      // PASO 2b: reversión de dinero (asiento inverso — NO delete).
      // Buscamos todos los DEBITO_AJUSTE_AFORO creados por esta corrida
      // vía la FK conciliacionRunId, y por cada uno emitimos un
      // CREDITO_REVERSO_AFORO con monto positivo igual al débito.
      // Idempotencia: @@unique([conciliacionRunId, envioId, tipo]) →
      // el debit y su reverso coexisten (distinto tipo); una segunda
      // reversión chocaría en el índice único con el reverso existente.
      // (El guard "run.revertida" ya rechaza antes de llegar acá.)
      // ============================================================
      const debits = await tx.movimientoFinanciero.findMany({
        where: { conciliacionRunId: runId, tipo: "DEBITO_AJUSTE_AFORO" },
        orderBy: { id: "asc" },
      });

      // Agrupamos por empresa para armar el running balance secuencial por
      // empresa (un run puede tocar múltiples empresas si el Excel del courier
      // agregaba envíos de más de un cliente — no es el caso hoy, pero el
      // schema no lo prohíbe).
      const porEmpresa = new Map<number, typeof debits>();
      for (const d of debits) {
        const arr = porEmpresa.get(d.empresaId) ?? [];
        arr.push(d);
        porEmpresa.set(d.empresaId, arr);
      }

      const empresasReversadas = new Set<number>();
      for (const [empresaId, lista] of porEmpresa) {
        const empFresh = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: { saldoActivo: true },
        });
        if (!empFresh) throw new Error(`Empresa ${empresaId} no encontrada al reversar.`);
        let running: Prisma.Decimal = empFresh.saldoActivo;

        for (const d of lista) {
          const montoPositivo = d.monto.neg(); // monto original era negativo
          running = running.add(montoPositivo);
          await tx.movimientoFinanciero.create({
            data: {
              empresaId,
              tipo: "CREDITO_REVERSO_AFORO",
              monto: montoPositivo,
              saldoPosterior: running,
              referencia: d.referencia,
              descripcion: `Reversión de ${d.descripcion ?? "débito de aforo"}`,
              envioId: d.envioId,
              conciliacionRunId: runId,
            },
          });
        }

        await tx.empresa.update({
          where: { id: empresaId },
          data: { saldoActivo: running },
        });
        empresasReversadas.add(empresaId);
      }

      await tx.conciliacionRun.update({
        where: { id: runId },
        data: { revertida: true, fechaReversion: new Date() },
      });

      return { count, empresasReversadas: [...empresasReversadas], reversadas: debits.length };
    });

    // PASO 2b: post-tx suspension/reactivation por cada empresa reversada.
    // Mirror del pattern crear.ts:855-865 — una falla acá NO revierte lo committeado.
    for (const empresaId of resultado.empresasReversadas) {
      try {
        const emp = await prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { saldoActivo: true, limiteDescubierto: true, suspendida: true },
        });
        if (!emp) continue;
        const { debeSuspender, debeReactivar } = evaluarSuspension(
          emp.saldoActivo,
          emp.limiteDescubierto ?? new Prisma.Decimal(0),
          emp.suspendida
        );
        // Un crédito (reversión) subiría el saldo → puede reactivar. Suspender
        // acá sería un no-op práctico pero se mantiene la simetría.
        if (debeReactivar) {
          await reactivarEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        } else if (debeSuspender) {
          await suspenderEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        }
      } catch (suspErr) {
        console.error(`[PASO 2b revertir] evaluación suspensión post-tx falló empresa=${empresaId}:`, suspErr);
      }
    }

    return NextResponse.json({
      success: true,
      runId,
      restauradas: resultado.count,
      movimientosReversados: resultado.reversadas,
    });
  } catch (error) {
    console.error("Error en POST /api/conciliacion/revertir:", error);
    return NextResponse.json({ error: "Error interno al revertir la conciliación." }, { status: 500 });
  }
}
