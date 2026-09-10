// ============================================================================
// HELPER — POLÍTICA FINANCIERA DE CANCELACIÓN (DEUDA 174 Pieza 4, 2026-09-10)
//
// Aplica la política de débito unificada al cancelar un envío. Fuente de
// verdad de la política (Nacho, LOCKED):
//
//   Estado terminal SIEMPRE = "solo Fee+IVA cobrado" (Shipro trabajó al crear
//   el SHP-* / procesar la venta). Camino para llegar depende de si el chain
//   YA SE DEBITÓ al momento del cancel:
//
//   (A) Chain YA debitado (típico Rama A dispatch OK, o Rama A post-corrección/
//       destrabe con etiqueta courier real):
//         REEMBOLSO = logisticaNetaFacturada × IVA_AR_MULTIPLIER
//                   = tarifaFullCotizada − feeConIva
//                   (devolvés todo lo cobrado excepto la Fee+IVA)
//       Se emite MovimientoFinanciero tipo CREDITO_CANCELACION.
//       Se marca finanzas.logisticaDevuelta=true + fechaDevolucionLogistica
//       para excluir del cron/sweep-6m (que refundea al 6to mes si no hubo
//       conciliación — colisionaría con este refund sino).
//
//   (B) Chain NO debitado (envío RETENIDO/BLOQUEADO_* nunca resuelto → chain
//       jamás cobrado post-Pieza-3):
//         COBRO Fee+IVA = feeNetoFacturado × IVA_AR_MULTIPLIER
//       Se emite MovimientoFinanciero tipo DEBITO_ENVIO. Cierra el gap dejado
//       por Pieza 3 (Rama A never-labelled = 0 charge → política Nacho exige
//       cobrar Fee).
//
//   (C) Rama B cancelado: `feeConIva` ya se cobró en creación (Pieza 2). El
//       ledger dice `yaDebitado = feeConIva` → no > feeConIva → caso (A) no
//       aplica; en caso (B) el delta = 0 → skip. Total: cero movimientos.
//       Correcto per política.
//
// SIGNAL "CHAIN DEBITADO" — LEDGER, NO EL BREAKDOWN:
//   `FinanzasEnvio.logisticaNetaFacturada` se persiste al alta con el desglose
//   del motor de pricing INDEPENDIENTEMENTE del gate de débito (crear.ts guard
//   L1116). Un envío Rama A + RETENIDO/DATOS_PAQUETE (post-Pieza-3, no debita
//   al crear) tiene `logisticaNetaFacturada > 0` PERO no debitó nada. Usar
//   `logisticaNetaFacturada > 0` como señal daría un falso positivo → refund
//   de plata que nunca se cobró. **Signal correcto: el LEDGER**: consultamos
//   `debitoAplicadoEnvio` y verificamos `yaDebitado > feeConIva` — solo si se
//   cobró MÁS que la Fee, entonces el chain se cobró y hay que refundar.
//   El breakdown se sigue usando para calcular el MONTO exacto del refund
//   (`logisticaNetaFacturada × IVA_AR_MULTIPLIER`), pero el GATE es el ledger.
//
// ANTI-DOBLE-CRÉDITO / DÉBITO:
//   Consulta el ledger via `creditoAplicadoEnvio` + `debitoAplicadoEnvio` (los
//   helpers de Pieza 1 y esta Pieza 4). Si la cancelación ya emitió su
//   CREDITO_CANCELACION (retry, doble cancel), skip. Si el Fee ya está cobrado
//   (Rama B post-P2, o Rama A que sí tuvo etiqueta), skip.
//
// EXCLUSIÓN SWEEP-6M:
//   Sweep-6m selecciona envíos con `finanzas.logisticaDevuelta=false`. Este
//   helper setea el flag a true al reembolsar → sweep-6m auto-excluye. Zero
//   colisión, mismo flag semantic ("logística devuelta al cliente, por
//   cualquier camino").
//
// CALLER INTEGRATION:
//   Se invoca DENTRO de un `$transaction` ya abierto por el caller (necesario
//   para atomicidad con el `estadoActual: "CANCELADO"` update). Devuelve un
//   objeto con lo que hizo para logging/response.
//
//   Se usa por:
//     - `app/api/envios/cancelar/route.ts` (cancel manual del cliente / operador).
//     - `app/api/tiendanube/labels/cancel/route.ts` (cancel via webhook TN,
//       provisoria + normal).
//
// SCOPE POR CALLER: el caller decide CUÁNDO llamar (post-marca-CANCELADO,
// dentro de la misma tx). Este helper NO toca `Envio.estadoActual` ni
// `EventoTracking` — solo la parte financiera + `FinanzasEnvio.logisticaDevuelta`.
// ============================================================================

import { Prisma } from "@prisma/client";
import { IVA_AR_MULTIPLIER } from "@/lib/constants/iva";
import { debitoAplicadoEnvio } from "@/lib/finanzas/debito-aplicado";
import { creditoAplicadoEnvio } from "@/lib/finanzas/credito-aplicado";

/**
 * Resultado de aplicar la política financiera de cancelación a un envío.
 */
export interface ResultadoCancelacionFinanciera {
  /** Monto acreditado como CREDITO_CANCELACION (0 si no aplicó / ya estaba refundeado / Rama B). */
  reembolsoAplicado: Prisma.Decimal;
  /** Monto debitado como Fee al cancelar sin etiqueta courier (0 si no aplicó / Fee ya cobrado). */
  feeCobrado: Prisma.Decimal;
  /** Saldo final de la empresa post-movimiento (o el saldo actual si no hubo movimiento). */
  saldoFinal: Prisma.Decimal;
  /** Motivo textual del resultado (para audit / logging). */
  motivo: string;
}

/**
 * Aplica la política de débito unificada al cancelar un envío. Debe ejecutarse
 * DENTRO de un `$transaction` abierto por el caller.
 *
 * @param tx        - Transaction client de Prisma (obligatorio — atomicidad con
 *                    el update de `estadoActual: "CANCELADO"`).
 * @param envioId   - id del envío que se está cancelando.
 * @param trackingReferencia - String que se usará como `referencia` del
 *                    MovimientoFinanciero (típicamente el `trackingNumber` del
 *                    envío — SHP-* provisorio o tracking real del courier).
 * @returns Objeto describiendo qué movimientos se aplicaron.
 * @throws Si el envío no existe o no tiene `FinanzasEnvio` asociado.
 */
export async function aplicarCancelacionFinanciera(
  tx: Prisma.TransactionClient,
  envioId: number,
  trackingReferencia: string,
): Promise<ResultadoCancelacionFinanciera> {
  const envio = await tx.envio.findUnique({
    where: { id: envioId },
    include: {
      courier: { select: { nombre: true } },
      finanzas: {
        select: {
          id: true,
          feeNetoFacturado: true,
          logisticaNetaFacturada: true,
          ivaFacturado: true,
          tarifaFullCotizada: true,
          ramaCongelada: true,
          logisticaDevuelta: true,
        },
      },
    },
  });
  if (!envio) {
    throw new Error(`CancelacionFinanciera: envío ${envioId} no encontrado.`);
  }
  const finanzas = envio.finanzas;

  const empresaActual = await tx.empresa.findUnique({
    where: { id: envio.empresaId },
    select: { saldoActivo: true },
  });
  let saldoFinal = empresaActual?.saldoActivo ?? new Prisma.Decimal(0);

  // Sin FinanzasEnvio → envío legacy sin breakdown. No podemos aplicar política
  // rama-aware sin los fields. Skip financial + retornar motivo informativo.
  if (!finanzas) {
    return {
      reembolsoAplicado: new Prisma.Decimal(0),
      feeCobrado: new Prisma.Decimal(0),
      saldoFinal,
      motivo: "Sin FinanzasEnvio (envío legacy sin breakdown) — sin movimiento financiero.",
    };
  }

  const courierNombre = envio.courier.nombre;
  const logisticaNeta = finanzas.logisticaNetaFacturada ?? new Prisma.Decimal(0);
  const feeNeto = finanzas.feeNetoFacturado ?? new Prisma.Decimal(0);
  const feeConIva = feeNeto.mul(IVA_AR_MULTIPLIER);
  // Refund objetivo (chain − Fee): reusar la fórmula EXACTA de cron/sweep-6m
  // (logisticaNetaFacturada × IVA_AR_MULTIPLIER) para consistencia numérica.
  // Equivale a `tarifaFullCotizada − feeConIva` bajo el invariante feeNeto +
  // logisticaNeta + iva == tarifaFullCotizada persistido.
  const refundObjetivo = logisticaNeta.mul(IVA_AR_MULTIPLIER);

  let reembolsoAplicado = new Prisma.Decimal(0);
  let feeCobrado = new Prisma.Decimal(0);
  const motivoPartes: string[] = [];

  // Ledger como fuente de verdad: consultamos qué se debitó realmente al envío.
  // Se usa como GATE (¿el chain se cobró?) y como base para el delta del Fee.
  const yaDebitado = await debitoAplicadoEnvio(envioId, tx);

  // ---- (A) Refund del chain-menos-Fee si el chain SE DEBITÓ ----
  //   GATE correcto: `yaDebitado > feeConIva` — sólo si el ledger muestra que
  //   se cobró MÁS que la Fee, entonces el chain se cobró (dispatch OK / corregir
  //   / destrabe). NO usar `logisticaNetaFacturada > 0` porque ese field se
  //   persiste al alta con el desglose del motor INDEPENDIENTEMENTE del gate de
  //   débito (falso positivo para Rama A + RETENIDO/DATOS_PAQUETE post-Pieza-3).
  //
  //   Rama B: yaDebitado = feeConIva (Pieza 2 cobró al crear) → NO gt(feeConIva)
  //   → skip refund. Cero special-casing Rama B necesario.
  //
  //   Anti-doble-crédito: consulta CREDITO_CANCELACION previos y cobra solo
  //   el delta. Idempotencia + protección contra retry.
  //
  //   Guard extra: si `logisticaDevuelta` ya está en true (sweep-6m ya corrió
  //   sobre este envío), skip refund — sweep ya devolvió la logística.
  const chainFueDebitado = yaDebitado.gt(feeConIva);
  if (chainFueDebitado && logisticaNeta.gt(0) && !finanzas.logisticaDevuelta) {
    const yaReembolsado = await creditoAplicadoEnvio(envioId, tx, ["CREDITO_CANCELACION"]);
    const deltaRefund = refundObjetivo.sub(yaReembolsado);

    if (deltaRefund.gt(0)) {
      const nuevoSaldoRefund = saldoFinal.add(deltaRefund);

      await tx.movimientoFinanciero.create({
        data: {
          empresaId: envio.empresaId,
          tipo: "CREDITO_CANCELACION",
          monto: deltaRefund, // positivo (crédito)
          saldoPosterior: nuevoSaldoRefund,
          referencia: trackingReferencia,
          descripcion: `Reembolso por cancelación de envío — ${courierNombre} (chain − Fee)`,
          envioId,
        },
      });

      await tx.empresa.update({
        where: { id: envio.empresaId },
        data: { saldoActivo: nuevoSaldoRefund },
      });

      // Excluir del cron/sweep-6m: mismo flag semantic ("logística devuelta,
      // por cualquier camino"). Fecha para audit.
      await tx.finanzasEnvio.update({
        where: { id: finanzas.id },
        data: {
          logisticaDevuelta: true,
          fechaDevolucionLogistica: new Date(),
        },
      });

      saldoFinal = nuevoSaldoRefund;
      reembolsoAplicado = deltaRefund;
      motivoPartes.push(
        `Refund cancelación $${deltaRefund.toFixed(2)} (chain − Fee) aplicado.`,
      );
    } else {
      motivoPartes.push("Refund ya aplicado previamente (idempotente).");
    }
  } else if (chainFueDebitado && logisticaNeta.gt(0) && finanzas.logisticaDevuelta) {
    motivoPartes.push(
      "Logística ya devuelta (cron/sweep-6m o cancelación previa) — sin refund adicional.",
    );
  }

  // ---- (B) Cobro Fee si nunca se cobró (chain NO debitado) ----
  //   Señal: yaDebitado < feeConIva → Nunca hubo debit completo. Típico
  //   Rama A + RETENIDO/blocked post-Pieza-3 (yaDebitado=0). Corresponde
  //   cobrar Fee+IVA per política Nacho ("Rama A sin etiqueta courier jamás
  //   generada → se comporta como Rama B, cobrar solo Fee+IVA").
  //
  //   Rama B: yaDebitado = feeConIva → delta = 0 → skip.
  //   Rama A + chain ya cobrado: yaDebitado >= feeConIva → delta = 0 → skip
  //   (el Fee está adentro del chain cobrado).
  //   Rama A + RETENIDO nunca resuelto: yaDebitado = 0 → delta = feeConIva
  //   → cobra Fee. Cierra el gap Pieza 3.
  //
  //   Anti-doble-débito: reusa `debitoAplicadoEnvio` (Pieza 1) — ya
  //   consultado arriba.
  //   Si `feeConIva === 0` (sin OperacionFee vigente al alta — edge), skip.
  if (feeConIva.gt(0)) {
    const deltaFee = feeConIva.sub(yaDebitado);

    if (deltaFee.gt(0)) {
      const nuevoSaldoFee = saldoFinal.sub(deltaFee);

      await tx.movimientoFinanciero.create({
        data: {
          empresaId: envio.empresaId,
          tipo: "DEBITO_ENVIO",
          monto: deltaFee.neg(),
          saldoPosterior: nuevoSaldoFee,
          referencia: trackingReferencia,
          descripcion: `Fee Shipro por cancelación de envío sin etiqueta courier — ${courierNombre}`,
          envioId,
        },
      });

      await tx.empresa.update({
        where: { id: envio.empresaId },
        data: { saldoActivo: nuevoSaldoFee },
      });

      saldoFinal = nuevoSaldoFee;
      feeCobrado = deltaFee;
      motivoPartes.push(
        `Fee $${deltaFee.toFixed(2)} cobrado en cancelación (nunca se había cobrado).`,
      );
    }
  }

  const motivo = motivoPartes.length > 0
    ? motivoPartes.join(" ")
    : "Sin movimiento financiero (Rama B Fee ya cobrado + sin chain que refundear, o edge sin breakdown).";

  return { reembolsoAplicado, feeCobrado, saldoFinal, motivo };
}
