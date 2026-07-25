// ============================================================================
// STEP 1 (dos-vías-liquidación) — backfill de FinanzasEnvio para envíos previos.
//
// Reproducible / idempotente / no fabrica: si el recompute no cuadra con el
// precioFactura persistido, la fila queda en OBSERVADO con breakdown NULL.
//
// Reglas:
//   1. ramaCongelada ← credencial.usaCredencialesPropias (última valid read).
//      Si no hay credencial → false (Rama A) y se cuenta como "sin credencial".
//   2. Rama B (ramaCongelada=true):
//        Fee = calcularFeeOperacion(empresaId, 0) — usa el fee vigente hoy.
//        Si feeConIva == precioFactura → OK (fee/0/iva). Si no → OBSERVADO.
//        estadoLiquidacionLogistica → NO_APLICA.
//   3. Rama A OK: recompute aplicarMarkup(precioProveedor, config) con la
//      MISMA config assembly de cotizador (fee neto, smo neto, intermediario%,
//      iva-policy de la credencial). Si precioFinal == precioFactura →
//      persistir desglose. Si no → OBSERVADO.
//   4. Ambas estados por defecto = viejo Envio.estadoLiquidacion (PENDIENTE/LIQUIDADO).
//      Rama B → estadoLiquidacionLogistica = NO_APLICA (overrules).
//      Rows OBSERVADO → ambos estados OBSERVADO (excluidos de proformas hasta review).
//   5. FKs viejas → nuevas: liquidacionFeeId = liquidacionLogisticaId = viejo Envio.liquidacionId.
//      logisticaDevuelta = false; fechaDevolucionLogistica = null; periodoLogistica = null.
//
// Uso: npx tsx scripts/backfill-liquidacion-dos-vias.ts
// ============================================================================
import { PrismaClient, Prisma, EstadoLiquidacion } from "@prisma/client";
import { aplicarMarkup } from "../lib/cotizador";
import { calcularFeeOperacion } from "../lib/utils/operacion-fee";

const prisma = new PrismaClient();
const CENTAVOS = new Prisma.Decimal("0.01");

// Igualdad con tolerancia de 1 centavo (evita drift por redondeo).
function eqAlCentavo(a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean {
  if (a == null || b == null) return false;
  return a.sub(b).abs().lte(CENTAVOS);
}

async function main() {
  const envios = await prisma.envio.findMany({
    include: {
      finanzas: true,
      courier: { include: { intermediarios: { where: { activo: true } } } },
      empresa: { include: { credenciales: true } },
    },
  });

  const counters = {
    total: 0,
    ramaAOk: 0,
    ramaAObservado: 0,
    ramaBOk: 0,
    ramaBObservado: 0,
    sinCredencial: 0,
    yaBackfilled: 0,
  };

  const feeCache = new Map<number, { feePreIva: Prisma.Decimal; feeConIva: Prisma.Decimal } | null>();

  for (const envio of envios) {
    counters.total++;
    if (!envio.finanzas) continue;
    const fin = envio.finanzas;

    // Idempotencia: si feeNetoFacturado ya está seteado, saltar.
    if (fin.feeNetoFacturado != null) {
      counters.yaBackfilled++;
      continue;
    }

    const credencial = envio.empresa.credenciales.find(c => c.nombreCourier === envio.courier.nombre);
    const ramaCongelada = credencial?.usaCredencialesPropias === true;
    // La vieja Envio.estadoLiquidacion fue dropeada en la migración
    // drop_estado_liquidacion_viejo. Este backfill se pensó para correr ANTES
    // de esa migración; si se re-ejecuta post-drop, el "estado viejo" ya no es
    // legible y arrancamos ambas vías en PENDIENTE por default.
    const oldEstado = ((envio as any).estadoLiquidacion as string | undefined) === "LIQUIDADO"
      ? EstadoLiquidacion.LIQUIDADO
      : EstadoLiquidacion.PENDIENTE;

    let feeNetoFacturado: Prisma.Decimal | null = null;
    let logisticaNetaFacturada: Prisma.Decimal | null = null;
    let ivaFacturado: Prisma.Decimal | null = null;
    let estadoLiqFee: EstadoLiquidacion = oldEstado;
    let estadoLiqLog: EstadoLiquidacion = oldEstado;

    if (!credencial) {
      counters.sinCredencial++;
      estadoLiqFee = EstadoLiquidacion.OBSERVADO;
      estadoLiqLog = EstadoLiquidacion.OBSERVADO;
    } else if (ramaCongelada) {
      // ---------- RAMA B ----------
      let fee = feeCache.get(envio.empresaId);
      if (fee === undefined) {
        const r = await calcularFeeOperacion(envio.empresaId, new Prisma.Decimal(0));
        fee = r ? { feePreIva: r.feePreIva, feeConIva: r.feeConIva } : null;
        feeCache.set(envio.empresaId, fee);
      }
      const expected = fee ? fee.feeConIva : new Prisma.Decimal(0);
      if (eqAlCentavo(expected, fin.precioFactura)) {
        feeNetoFacturado = fee ? fee.feePreIva : new Prisma.Decimal(0);
        logisticaNetaFacturada = new Prisma.Decimal(0);
        ivaFacturado = fee ? fee.feeConIva.sub(fee.feePreIva) : new Prisma.Decimal(0);
        estadoLiqLog = EstadoLiquidacion.NO_APLICA;
        counters.ramaBOk++;
      } else {
        estadoLiqFee = EstadoLiquidacion.OBSERVADO;
        estadoLiqLog = EstadoLiquidacion.OBSERVADO;
        counters.ramaBObservado++;
      }
    } else {
      // ---------- RAMA A ----------
      let feeShiproNeto: Prisma.Decimal = new Prisma.Decimal(0);
      let fee = feeCache.get(envio.empresaId);
      if (fee === undefined) {
        const r = await calcularFeeOperacion(envio.empresaId, new Prisma.Decimal(0));
        fee = r ? { feePreIva: r.feePreIva, feeConIva: r.feeConIva } : null;
        feeCache.set(envio.empresaId, fee);
      }
      if (fee) feeShiproNeto = fee.feePreIva;

      const intermediarioActivo = envio.courier.intermediarios.length ? envio.courier.intermediarios[0] : null;
      const intermediarioMarkupPorcentaje = intermediarioActivo ? Number(intermediarioActivo.markupPorcentaje) : null;

      const smoNeto: Prisma.Decimal = envio.courier.smoActivo
        ? new Prisma.Decimal(envio.courier.smoPrecioAlClienteConIva)
        : new Prisma.Decimal(0);

      const raw = fin.precioProveedor ?? new Prisma.Decimal(0);
      const recompute = aplicarMarkup(raw, {
        usaCredencialesPropias: false,
        ajusteTarifaPorcentaje: credencial.ajusteTarifaPorcentaje,
        markupFijo: credencial.markupFijo,
        tarifaIncluyeIva: credencial.tarifaIncluyeIva,
        intermediarioMarkupPorcentaje,
        smoNeto,
        feeShiproNeto,
      });

      if (eqAlCentavo(recompute.precioFinal, fin.precioFactura)) {
        feeNetoFacturado = recompute.desglose.feeNeto;
        logisticaNetaFacturada = recompute.desglose.cascadaNeto.add(recompute.desglose.smoNeto);
        ivaFacturado = recompute.precioFinal.sub(recompute.desglose.netoAcumulado);
        counters.ramaAOk++;
      } else {
        estadoLiqFee = EstadoLiquidacion.OBSERVADO;
        estadoLiqLog = EstadoLiquidacion.OBSERVADO;
        counters.ramaAObservado++;
        console.log(
          `  [OBSERVADO] envio.id=${envio.id} tracking=${envio.trackingNumber} ` +
          `precioFactura=${fin.precioFactura?.toFixed(2)} recompute=${recompute.precioFinal.toFixed(2)} (drift, no fabrico)`
        );
      }
    }

    // Nota: la vieja Envio.liquidacionId no existe en el modelo Envio de Prisma
    // como campo TS accesible acá post-STAGE-8, pero en STAGE 7 aún sí. La copiamos
    // a ambas FKs para preservar el vínculo legacy con la LiquidacionMensual vieja.
    const oldLiquidacionId = (envio as any).liquidacionId as number | null | undefined;

    await prisma.finanzasEnvio.update({
      where: { id: fin.id },
      data: {
        ramaCongelada,
        feeNetoFacturado,
        logisticaNetaFacturada,
        ivaFacturado,
        estadoLiquidacionFee: estadoLiqFee,
        estadoLiquidacionLogistica: estadoLiqLog,
        liquidacionFeeId: oldLiquidacionId ?? null,
        liquidacionLogisticaId: oldLiquidacionId ?? null,
        logisticaDevuelta: false,
        fechaDevolucionLogistica: null,
        periodoLogistica: null,
      },
    });
  }

  console.log("\n=== Backfill STEP 1 counts ===");
  console.log(JSON.stringify(counters, null, 2));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
