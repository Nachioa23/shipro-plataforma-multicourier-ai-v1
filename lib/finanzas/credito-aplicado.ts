// ============================================================================
// HELPER — ANTI-DOBLE-CRÉDITO (Política de Débito Unificada, DEUDA 174 Pieza 4)
//
// Análogo a `debito-aplicado.ts` (Pieza 1) pero para el LADO CRÉDITO. Consulta
// el ledger (`MovimientoFinanciero`) para responder "¿cuánto ya se acreditó a
// la wallet por este envío bajo un tipo dado?". Es la primitiva money-safe que
// Pieza 4 usa para reembolsar SOLO el delta faltante (target − ya acreditado),
// evitando doble-crédito ante retry / doble cancelación.
//
// TIPOS CREDIT DEL LEDGER (relevantes):
//   - CREDITO_CANCELACION: refund al cancelar un envío Rama A que tenía
//     etiqueta courier (chain − Fee). Introducido por Pieza 4 (esta).
//   - CREDITO_LOGISTICA_NO_FACTURADA: sweep-6m (post-hoc si el courier nunca
//     facturó a los 6 meses). Ver `cron/sweep-6m/route.ts`.
//   - CREDITO_REVERSO_AFORO: reverso del ajuste de aforo en la conciliación.
//     Ver `app/api/conciliacion/revertir/route.ts`.
//
// SCOPE POR TIPO — filtro explícito obligatorio:
//   El helper acepta un array `tipos` explícito para que cada caller declare
//   qué crédito consulta. No hay default "todos los CREDITO_*" — mezclar
//   sweep-6m con cancelación mezcla eventos independientes que pueden coexistir
//   (un envío puede ser cancelado + tener reverso-aforo separado). El caller
//   money-critical siempre sabe cuál preguntar.
//
// CONVENCIÓN DE SIGNO: `MovimientoFinanciero.monto` guarda créditos como
// POSITIVOS. `creditoAplicadoEnvio` devuelve el valor ABSOLUTO acumulado (siempre
// POSITIVO) para que las Piezas 4-5 puedan hacer aritmética simple `delta =
// target − yaAcreditado` sin manejar signos. Espejo del debit-helper.
//
// LEDGER = FUENTE DE VERDAD (mismo argumento que Pieza 1): `Empresa.saldoActivo`
// es la suma de todos los `monto` de `MovimientoFinanciero`. Consultar el
// ledger es consultar la wallet real — cero drift posible.
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { PrismaClientOrTx } from "@/lib/finanzas/debito-aplicado";

/**
 * Suma en VALOR ABSOLUTO los créditos de los tipos indicados ya emitidos para
 * este envío. Idempotente y sin efectos secundarios.
 *
 * Uso típico (Pieza 4 cancelación):
 *   const yaReembolsado = await creditoAplicadoEnvio(envio.id, tx, ["CREDITO_CANCELACION"]);
 *   const deltaRefund = target.sub(yaReembolsado);
 *   if (deltaRefund.gt(0)) { crear CREDITO_CANCELACION monto=+deltaRefund; empresa.saldoActivo += deltaRefund; }
 *
 * @param envioId - id del envío a consultar.
 * @param client  - Prisma client o transaction client (default global).
 * @param tipos   - Array de tipos CREDITO_* a sumar. Explícito por diseño —
 *                  cada caller declara qué evento consulta.
 * @returns Decimal ≥ 0 con el total ya acreditado bajo esos tipos (valor absoluto).
 */
export async function creditoAplicadoEnvio(
  envioId: number,
  client: PrismaClientOrTx = prisma,
  tipos: string[] = [],
): Promise<Prisma.Decimal> {
  if (tipos.length === 0) return new Prisma.Decimal(0);
  const rows = await client.movimientoFinanciero.findMany({
    where: { envioId, tipo: { in: tipos } },
    select: { monto: true },
  });
  return rows.reduce(
    (acc, r) => acc.add(r.monto.abs()),
    new Prisma.Decimal(0),
  );
}

/**
 * Conveniencia: ¿existe al menos un crédito de cancelación para este envío?
 *
 * Uso típico: check simple "¿ya reembolsé la cancelación de este envío?"
 *
 * @param envioId - id del envío a consultar.
 * @param client  - Prisma client o transaction client (default global).
 * @returns true si existe al menos una fila CREDITO_CANCELACION para el envío.
 */
export async function yaFueReembolsado(
  envioId: number,
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  const row = await client.movimientoFinanciero.findFirst({
    where: { envioId, tipo: "CREDITO_CANCELACION" },
    select: { id: true },
  });
  return row !== null;
}
