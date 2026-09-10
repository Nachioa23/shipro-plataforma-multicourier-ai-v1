// ============================================================================
// HELPER — ANTI-DOBLE-DÉBITO (Política de Débito Unificada, DEUDA 174 Pieza 1)
//
// Consulta el ledger (`MovimientoFinanciero`) para responder "¿cuánto ya se
// debitó a la wallet por este envío?". Es la primitiva money-safe que las
// Piezas 2-5 usan para debitar SOLO el delta faltante (target − ya cobrado),
// evitando doble-débito cuando el gatillo se mueve entre creación / destrabe /
// corregir / cancelar.
//
// LEDGER = FUENTE DE VERDAD:
//   `Empresa.saldoActivo` es (invariante) la suma de todos los `monto` de
//   `MovimientoFinanciero` de esa empresa. Si el ledger dice que este envío
//   ya tiene un `DEBITO_ENVIO` de -$X, entonces esa plata SALIÓ de la wallet
//   — no puede haber drift entre "flag dice sí" y "wallet dice no". Un flag
//   booleano en FinanzasEnvio introduciría exactamente ese modo de falla;
//   consultar el ledger no.
//
// CONVENCIÓN DE SIGNO (schema.prisma:655 + crear.ts:1129):
//   `MovimientoFinanciero.monto` guarda débitos como NEGATIVOS (`.neg()` al
//   crear). `debitoAplicadoEnvio` devuelve el valor ABSOLUTO acumulado —
//   siempre POSITIVO — para que las Piezas 2-5 puedan hacer aritmética simple
//   `delta = target − yaDebitado` sin manejar signos.
//
// SCOPE — SOLO "DEBITO_ENVIO":
//   No incluye `DEBITO_AJUSTE_AFORO` ni `CREDITO_*`. Aforo es un mecanismo
//   post-conciliación separado (ajusta el flete facturado por el courier
//   contra lo estimado); mezclarlo con la "base ya cobrada" del envío
//   contaminaría el delta. Sweep-6m (`CREDITO_LOGISTICA_NO_FACTURADA`) y
//   reverso aforo (`CREDITO_REVERSO_AFORO`) tampoco cuentan — son refunds
//   posteriores, no impactan la pregunta "¿cobré la etiqueta?".
//
// PIEZA 1 (esta): SOLO existe el helper, NADIE lo consume todavía. Después
// de este commit el sistema debita idénticamente a antes. Las Piezas 2-5 lo
// wirean uno por uno con verificación numérica.
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Cliente Prisma o transacción — el helper corre tanto en la conexión global
 * como dentro de un `$transaction` (typical uso: dentro de la tx del sitio
 * de débito, para consistencia entre el read y el write).
 */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

/**
 * Suma en VALOR ABSOLUTO los `DEBITO_ENVIO` ya emitidos para este envío.
 *
 * Devuelve un Decimal ≥ 0: `Σ |monto|` sobre las filas de MovimientoFinanciero
 * con `envioId = <envioId>` y `tipo = "DEBITO_ENVIO"`. Idempotente y sin
 * efectos secundarios: solo lectura.
 *
 * Uso típico (Piezas 2-5):
 *   const yaDebitado = await debitoAplicadoEnvio(envio.id, tx);
 *   const delta = target.sub(yaDebitado);
 *   if (delta.gt(0)) { crear DEBITO_ENVIO por -delta; empresa.update saldo }
 *
 * @param envioId - id del envío a consultar.
 * @param client  - Prisma client o transaction client. Por defecto usa el
 *                  singleton global; pasar `tx` cuando se corre dentro de un
 *                  `$transaction` para que la lectura vea los writes previos
 *                  del mismo tx (consistencia read-your-writes).
 * @returns Decimal ≥ 0 con el total ya debitado (valor absoluto).
 */
export async function debitoAplicadoEnvio(
  envioId: number,
  client: PrismaClientOrTx = prisma,
): Promise<Prisma.Decimal> {
  const rows = await client.movimientoFinanciero.findMany({
    where: { envioId, tipo: "DEBITO_ENVIO" },
    select: { monto: true },
  });
  return rows.reduce(
    (acc, r) => acc.add(r.monto.abs()),
    new Prisma.Decimal(0),
  );
}

/**
 * Conveniencia: ¿existe al menos un DEBITO_ENVIO para este envío?
 *
 * Uso típico: checks simples "¿ya cobré el Fee?" donde no importa el monto.
 * Para la aritmética `target − yaDebitado`, usar `debitoAplicadoEnvio`.
 *
 * @param envioId - id del envío a consultar.
 * @param client  - Prisma client o transaction client (default: global).
 * @returns true si existe al menos una fila DEBITO_ENVIO para el envío.
 */
export async function yaFueDebitado(
  envioId: number,
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  const row = await client.movimientoFinanciero.findFirst({
    where: { envioId, tipo: "DEBITO_ENVIO" },
    select: { id: true },
  });
  return row !== null;
}
