import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, EstadoLiquidacion } from "@prisma/client";
import { evaluarSuspension, suspenderEmpresa, reactivarEmpresa } from "@/lib/utils/suspension-cuenta";
import { IVA_AR_MULTIPLIER } from "@/lib/constants/iva";

// PASO 3 PIECE 1: barrido de 6 meses. Al día 1 de cada mes, para cada etiqueta
// Rama A cuya fechaImpresion ya cumplió 6 meses sin conciliación del courier,
// devuelve el flete estimado (logisticaNetaFacturada × 1.21) como crédito al
// saldo. El Fee no se toca (ya se cobró en la proforma FEE del mes de creación).
// La etiqueta queda `logisticaDevuelta=true` (idempotency del propio sweep);
// `estadoLiquidacionLogistica` PERMANECE en PENDIENTE (decisión de Nacho: el
// estado terminal post-sweep queda cubierto por el flag `logisticaDevuelta`).
//
// Auth: proxy.ts:99-101 valida Authorization Bearer CRON_SECRET para todo
// /api/cron/*. El handler no re-verifica.
// IVA: fuente única en lib/constants/iva.ts (consolidación 2026-07-31).

export async function GET(_request: Request) {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const eligibles = await prisma.envio.findMany({
      where: {
        fechaImpresion: { lte: sixMonthsAgo },
        finanzas: {
          estadoLiquidacionLogistica: EstadoLiquidacion.PENDIENTE,
          ramaCongelada: false,
          logisticaDevuelta: false,
          logisticaNetaFacturada: { gt: 0 },
        },
      },
      select: {
        id: true,
        trackingNumber: true,
        empresaId: true,
        finanzas: {
          select: {
            id: true,
            logisticaNetaFacturada: true,
          },
        },
      },
    });

    if (eligibles.length === 0) {
      return NextResponse.json({ ok: true, sweptCount: 0, totalCreditado: "0.00", empresasTocadas: 0, perEmpresa: [] });
    }

    // Agrupar por empresa: una $transaction atómica por empresa (una falla no
    // bloquea al resto de las empresas del run).
    const porEmpresa = new Map<number, typeof eligibles>();
    for (const e of eligibles) {
      const arr = porEmpresa.get(e.empresaId) ?? [];
      arr.push(e);
      porEmpresa.set(e.empresaId, arr);
    }

    let totalCreditado: Prisma.Decimal = new Prisma.Decimal(0);
    const perEmpresa: { empresaId: number; labels: number; credited: string }[] = [];
    const empresasTocadas: number[] = [];

    for (const [empresaId, lista] of porEmpresa) {
      try {
        const creditadoEmpresa = await prisma.$transaction(async (tx) => {
          const empFresh = await tx.empresa.findUnique({
            where: { id: empresaId },
            select: { saldoActivo: true },
          });
          if (!empFresh) throw new Error(`Empresa ${empresaId} no encontrada en sweep-6m.`);

          let running: Prisma.Decimal = empFresh.saldoActivo;
          let creditadoLocal: Prisma.Decimal = new Prisma.Decimal(0);

          for (const envio of lista) {
            const netoLog = envio.finanzas!.logisticaNetaFacturada ?? new Prisma.Decimal(0);
            const credit = netoLog.mul(IVA_AR_MULTIPLIER);
            running = running.add(credit);
            creditadoLocal = creditadoLocal.add(credit);

            await tx.movimientoFinanciero.create({
              data: {
                empresaId,
                tipo: "CREDITO_LOGISTICA_NO_FACTURADA",
                monto: credit,
                saldoPosterior: running,
                referencia: envio.trackingNumber,
                descripcion: `Devolución flete no facturado por el courier (barrido 6 meses) — envío ${envio.trackingNumber}`,
                envioId: envio.id,
              },
            });

            await tx.finanzasEnvio.update({
              where: { id: envio.finanzas!.id },
              data: {
                logisticaDevuelta: true,
                fechaDevolucionLogistica: now,
              },
            });
          }

          await tx.empresa.update({
            where: { id: empresaId },
            data: { saldoActivo: running },
          });

          return creditadoLocal;
        });

        empresasTocadas.push(empresaId);
        totalCreditado = totalCreditado.add(creditadoEmpresa);
        perEmpresa.push({
          empresaId,
          labels: lista.length,
          credited: creditadoEmpresa.toFixed(2),
        });
      } catch (txErr) {
        console.error(`[sweep-6m] tx empresa=${empresaId} falló:`, txErr);
        // Seguimos con las otras empresas — decisión: una falla NO bloquea al resto.
      }
    }

    // Post-tx: evaluar suspensión por cada empresa cuyo saldo cambió. Un crédito
    // sube el saldo → debería reactivar; se mantiene la simetría con revertir.
    for (const empresaId of empresasTocadas) {
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
        if (debeReactivar) {
          await reactivarEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        } else if (debeSuspender) {
          await suspenderEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        }
      } catch (suspErr) {
        console.error(`[sweep-6m] evaluación suspensión post-tx falló empresa=${empresaId}:`, suspErr);
      }
    }

    return NextResponse.json({
      ok: true,
      sweptCount: perEmpresa.reduce((acc, p) => acc + p.labels, 0),
      totalCreditado: totalCreditado.toFixed(2),
      empresasTocadas: empresasTocadas.length,
      perEmpresa,
    });
  } catch (error) {
    console.error("Error en el sweep-6m:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
