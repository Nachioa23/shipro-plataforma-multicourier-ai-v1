import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ============================================================================
// POST /api/conciliacion/revertir — undo de una corrida de conciliación.
// Body: { runId: number }
//
// Restaura los 6 campos de FinanzasEnvio guardados en ConciliacionRun.snapshot
// (pesoAforado, costoCourierEsperado, costoCourierFacturado, estadoAuditoria,
// facturaCourierRef, costoAforo) a los valores previos a la corrida.
//
// Guards:
//   1. run no existe → 404
//   2. run ya revertida → 409
//   3. algún envío del snapshot ya está en una LiquidacionMensual
//      (estadoLiquidacion === "LIQUIDADO") → 409. Racional: el mes ya cerró
//      y una reversión descuadraría el total emitido al cliente. Corregir con
//      un ajuste (nuevo movimiento contable), no con reversión de conciliación.
// ============================================================================

type SnapshotPrior = {
  pesoAforado: number | null;
  costoCourierEsperado: string | null;
  costoCourierFacturado: string | null;
  estadoAuditoria: string | null;
  facturaCourierRef: string | null;
  costoAforo: string | null;
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

    // Guard 3: si algún envío del snapshot ya cerró en una LiquidacionMensual,
    // no se puede revertir sin descuadrar el mes emitido.
    const finanzasEnvioIds = snapshot.map(s => s.finanzasEnvioId);
    const enviosLiquidados = await prisma.envio.findMany({
      where: {
        finanzas: { id: { in: finanzasEnvioIds } },
        estadoLiquidacion: "LIQUIDADO",
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
    const restauradas = await prisma.$transaction(async (tx) => {
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
          },
        });
        count++;
      }

      await tx.conciliacionRun.update({
        where: { id: runId },
        data: { revertida: true, fechaReversion: new Date() },
      });

      return count;
    });

    return NextResponse.json({ success: true, runId, restauradas });
  } catch (error) {
    console.error("Error en POST /api/conciliacion/revertir:", error);
    return NextResponse.json({ error: "Error interno al revertir la conciliación." }, { status: 500 });
  }
}
