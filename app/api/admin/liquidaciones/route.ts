import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, EstadoLiquidacion, TipoLiquidacion } from "@prisma/client";

// ============================================================================
// STEP 1 (dos-vías-liquidación) — rebuild.
//
// Antes: una sola proforma por (empresa, período libre-text). Filtro
// pesoAforado != null (excluía Rama B por definición). Monto = precioFactura
// + costoAforo (Fee + logística mezclados).
//
// Ahora: DOS proformas independientes por (empresa, período YYYY-MM):
//   - FEE: rows con estadoLiquidacionFee=PENDIENTE agrupadas por el mes de
//     fechaImpresion. Total = Σ (feeNetoFacturado + su IVA 21%). Cubre AMBAS
//     ramas (Fee siempre se cobra).
//   - LOGISTICA: rows con estadoLiquidacionLogistica=EN_PROCESO (la conciliación
//     ya trajo la factura del courier) AND ramaCongelada=false AND
//     periodoLogistica=período. Total = Σ (logisticaNetaFacturada + costoAforo +
//     su IVA). Excluye Rama B (NO_APLICA) y filas OBSERVADO (fallback rama A o
//     desglose faltante — revisión manual).
//
// NO se crea ningún MovimientoFinanciero acá (documento solamente). El débito
// al saldo es STEP 2 (todavía out-of-scope).
// ============================================================================

const IVA_MULTIPLIER = new Prisma.Decimal("1.21");
const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Deriva "YYYY-MM" desde una Date usando fecha en el timezone del server.
function periodoDeFecha(d: Date): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

function tieneBreakdown(f: { feeNetoFacturado: Prisma.Decimal | null }) {
  return f.feeNetoFacturado !== null;
}

export async function GET(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get("tracking");

    // ===================== SÚPER BUSCADOR FORENSE =====================
    if (tracking) {
      const envio = await prisma.envio.findUnique({
        where: { trackingNumber: tracking },
        include: {
          empresa: true,
          finanzas: {
            include: {
              liquidacionFee: true,
              liquidacionLogistica: true,
            },
          },
          courier: true,
        },
      });
      if (!envio) return NextResponse.json({ error: "Tracking no encontrado en la base." }, { status: 404 });
      return NextResponse.json(envio);
    }

    // ===================== PENDIENTES POR VÍA =====================
    // FEE: cualquier envío con estadoLiquidacionFee=PENDIENTE. Se agrupa por
    // (empresa, mes de fechaImpresion). Cubre AMBAS ramas.
    const enviosFee = await prisma.envio.findMany({
      where: {
        finanzas: {
          estadoLiquidacionFee: EstadoLiquidacion.PENDIENTE,
          feeNetoFacturado: { not: null }, // fallback rows tienen null → excluidas hasta revisión manual
        },
      },
      select: {
        id: true,
        fechaImpresion: true,
        empresaId: true,
        empresa: { select: { id: true, nombre: true, cuit: true } },
        finanzas: {
          select: { feeNetoFacturado: true, ivaFacturado: true, logisticaNetaFacturada: true },
        },
      },
    });

    // LOGISTICA: rows Rama A que ya trajeron factura del courier (EN_PROCESO)
    // y tienen periodoLogistica sembrado por conciliación.
    const enviosLog = await prisma.envio.findMany({
      where: {
        finanzas: {
          estadoLiquidacionLogistica: EstadoLiquidacion.EN_PROCESO,
          ramaCongelada: false,
          periodoLogistica: { not: null },
        },
      },
      select: {
        id: true,
        empresaId: true,
        empresa: { select: { id: true, nombre: true, cuit: true } },
        finanzas: {
          select: { logisticaNetaFacturada: true, costoAforo: true, periodoLogistica: true },
        },
      },
    });

    // Group Fee por (empresaId, periodoFee) — periodoFee = mes de fechaImpresion.
    type Bucket = { empresaId: number; empresaNombre: string; cuit: string | null; periodo: string; totalEnvios: number; montoTotal: Prisma.Decimal };
    const feeMap = new Map<string, Bucket>();
    for (const e of enviosFee) {
      const periodo = periodoDeFecha(e.fechaImpresion);
      const key = `${e.empresaId}:${periodo}`;
      const bucket = feeMap.get(key) ?? {
        empresaId: e.empresaId,
        empresaNombre: e.empresa.nombre,
        cuit: e.empresa.cuit,
        periodo,
        totalEnvios: 0,
        montoTotal: new Prisma.Decimal(0),
      };
      const feeNeto = e.finanzas!.feeNetoFacturado ?? new Prisma.Decimal(0);
      const feeConIva = feeNeto.mul(IVA_MULTIPLIER);
      bucket.montoTotal = bucket.montoTotal.add(feeConIva);
      bucket.totalEnvios += 1;
      feeMap.set(key, bucket);
    }

    // Group Logistica por (empresaId, periodoLogistica).
    const logMap = new Map<string, Bucket>();
    for (const e of enviosLog) {
      const periodo = e.finanzas!.periodoLogistica!; // filtered above
      const key = `${e.empresaId}:${periodo}`;
      const bucket = logMap.get(key) ?? {
        empresaId: e.empresaId,
        empresaNombre: e.empresa.nombre,
        cuit: e.empresa.cuit,
        periodo,
        totalEnvios: 0,
        montoTotal: new Prisma.Decimal(0),
      };
      const logNeto = e.finanzas!.logisticaNetaFacturada ?? new Prisma.Decimal(0);
      const aforo = e.finanzas!.costoAforo ?? new Prisma.Decimal(0);
      const netoTotal = logNeto.add(aforo);
      const conIva = netoTotal.mul(IVA_MULTIPLIER);
      bucket.montoTotal = bucket.montoTotal.add(conIva);
      bucket.totalEnvios += 1;
      logMap.set(key, bucket);
    }

    const pendientesFee = Array.from(feeMap.values()).map(b => ({ ...b, montoTotal: b.montoTotal.toNumber() }));
    const pendientesLogistica = Array.from(logMap.values()).map(b => ({ ...b, montoTotal: b.montoTotal.toNumber() }));

    const historial = await prisma.liquidacionMensual.findMany({
      include: { empresa: true },
      orderBy: { fechaCreacion: "desc" },
      take: 50,
    });

    return NextResponse.json({ pendientesFee, pendientesLogistica, historial });
  } catch (error) {
    console.error("Error cargando liquidaciones:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { empresaId, periodo, tipo } = await request.json();

    if (!empresaId || !periodo || !tipo) {
      return NextResponse.json({ error: "Faltan datos: empresaId, periodo y tipo son requeridos." }, { status: 400 });
    }
    if (tipo !== "FEE" && tipo !== "LOGISTICA") {
      return NextResponse.json({ error: "tipo inválido: se espera 'FEE' o 'LOGISTICA'." }, { status: 400 });
    }
    if (typeof periodo !== "string" || !PERIODO_REGEX.test(periodo)) {
      return NextResponse.json({ error: "periodo inválido: formato requerido YYYY-MM (ej. '2026-04')." }, { status: 400 });
    }

    const empresaIdInt = parseInt(empresaId, 10);
    if (!Number.isFinite(empresaIdInt)) {
      return NextResponse.json({ error: "empresaId inválido." }, { status: 400 });
    }

    // Rango [inicio, siguiente-mes) para el filtro de FEE (por fechaImpresion).
    const [yStr, mStr] = periodo.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const inicioMes = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const siguienteMes = new Date(Date.UTC(y, m, 1, 0, 0, 0));

    const resultado = await prisma.$transaction(async (tx) => {
      if (tipo === "FEE") {
        // Universo FEE: envíos de esa empresa, alta dentro del mes, vía FEE=PENDIENTE,
        // breakdown presente (excluye fallbacks OBSERVADO). Ambas ramas.
        const envios = await tx.envio.findMany({
          where: {
            empresaId: empresaIdInt,
            fechaImpresion: { gte: inicioMes, lt: siguienteMes },
            finanzas: {
              estadoLiquidacionFee: EstadoLiquidacion.PENDIENTE,
              feeNetoFacturado: { not: null },
            },
          },
          include: { finanzas: true, courier: true, destino: true },
        });

        if (envios.length === 0) throw new Error("No hay envíos con Fee pendiente para este período.");

        const montoTotal = envios.reduce((acc, e) => {
          const feeNeto = e.finanzas!.feeNetoFacturado ?? new Prisma.Decimal(0);
          return acc.add(feeNeto.mul(IVA_MULTIPLIER));
        }, new Prisma.Decimal(0));

        const nueva = await tx.liquidacionMensual.create({
          data: {
            empresaId: empresaIdInt,
            periodo,
            montoTotal,
            estado: "EMITIDA",
            tipo: TipoLiquidacion.FEE,
          },
        });

        await tx.finanzasEnvio.updateMany({
          where: { id: { in: envios.map(e => e.finanzas!.id) } },
          data: {
            estadoLiquidacionFee: EstadoLiquidacion.LIQUIDADO,
            liquidacionFeeId: nueva.id,
          },
        });

        return { liquidacion: nueva, envios };
      }

      // tipo === "LOGISTICA"
      // Universo LOGISTICA: Rama A, vía LOGISTICA=EN_PROCESO, período de la
      // factura del courier = período del cierre. Excluye NO_APLICA (Rama B)
      // y OBSERVADO (fallback).
      const envios = await tx.envio.findMany({
        where: {
          empresaId: empresaIdInt,
          finanzas: {
            estadoLiquidacionLogistica: EstadoLiquidacion.EN_PROCESO,
            ramaCongelada: false,
            periodoLogistica: periodo,
            logisticaNetaFacturada: { not: null },
          },
        },
        include: { finanzas: true, courier: true, destino: true },
      });

      if (envios.length === 0) throw new Error("No hay envíos con Logística pendiente para este período.");

      const montoTotal = envios.reduce((acc, e) => {
        const logNeto = e.finanzas!.logisticaNetaFacturada ?? new Prisma.Decimal(0);
        const aforo = e.finanzas!.costoAforo ?? new Prisma.Decimal(0);
        return acc.add(logNeto.add(aforo).mul(IVA_MULTIPLIER));
      }, new Prisma.Decimal(0));

      const nueva = await tx.liquidacionMensual.create({
        data: {
          empresaId: empresaIdInt,
          periodo,
          montoTotal,
          estado: "EMITIDA",
          tipo: TipoLiquidacion.LOGISTICA,
        },
      });

      await tx.finanzasEnvio.updateMany({
        where: { id: { in: envios.map(e => e.finanzas!.id) } },
        data: {
          estadoLiquidacionLogistica: EstadoLiquidacion.LIQUIDADO,
          liquidacionLogisticaId: nueva.id,
        },
      });

      return { liquidacion: nueva, envios };
    });

    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error al procesar el cierre" }, { status: 500 });
  }
}
