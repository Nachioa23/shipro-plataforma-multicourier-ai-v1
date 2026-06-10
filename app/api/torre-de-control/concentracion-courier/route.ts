// ============================================================================
// TORRE DE CONTROL — METRICA 2.6 "Concentracion Courier"
//
// Mide la concentracion / diversificacion del mix de couriers que se utilizan.
// Indicador de riesgo operativo: si un courier concentra >60% del volumen,
// hay Single Point of Failure (SPOF) que pone en riesgo la continuidad
// del servicio si ese courier tiene problemas.
//
// Decisiones (director 2026-06-10):
// - Vista global: sin parametro empresaId, suma todo el ecosistema Shipro.
// - Vista por empresa: con ?empresaId=X, filtra solo envios de esa empresa.
// - Ventana 90 dias desde fechaImpresion.
// - Threshold SPOF: 60% (hardcoded por ahora, configurable futuro).
// - HHI: Herfindahl-Hirschman Index. <1500 bajo, 1500-2500 moderado, >2500 alto.
//
// Auth: modoDios. Scope global. La vista por empresa requiere parametro
// explicito; sin parametro retorna agregado global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

const VENTANA_DIAS = 90;
const THRESHOLD_SPOF = 60;
const UMBRAL_HHI_MODERADO = 1500;
const UMBRAL_HHI_ALTO = 2500;

/**
 * Herfindahl-Hirschman Index.
 * Suma de los cuadrados de las cuotas de mercado.
 * Escala 0-10000: <1500 bajo, 1500-2500 moderado, >2500 alto.
 */
function calcularHHI(porcentajes: number[]): number {
  return Math.round(porcentajes.reduce((sum, p) => sum + p * p, 0));
}

function nivelHHI(hhi: number): "bajo" | "moderado" | "alto" {
  if (hhi < UMBRAL_HHI_MODERADO) return "bajo";
  if (hhi < UMBRAL_HHI_ALTO) return "moderado";
  return "alto";
}

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json({ error: "Acceso solo para roles Shipro." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const empresaIdParam = searchParams.get("empresaId");
    const empresaId = empresaIdParam ? parseInt(empresaIdParam, 10) : null;

    if (empresaIdParam && isNaN(empresaId!)) {
      return NextResponse.json({ error: "empresaId debe ser numerico." }, { status: 400 });
    }

    const ventanaInicio = new Date();
    ventanaInicio.setDate(ventanaInicio.getDate() - VENTANA_DIAS);

    // Buscar nombre de empresa si se filtro.
    let empresaNombre: string | null = null;
    if (empresaId !== null) {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true },
      });
      if (!empresa) {
        return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
      }
      empresaNombre = empresa.nombre;
    }

    // Construir where clause.
    const whereClause: any = {
      fechaImpresion: { gte: ventanaInicio },
    };
    if (empresaId !== null) {
      whereClause.empresaId = empresaId;
    }

    // Fetch envios con courier.
    const envios = await prisma.envio.findMany({
      where: whereClause,
      include: {
        courier: { select: { id: true, nombre: true } },
      },
    });

    const totalEnvios = envios.length;

    // ============================================================
    // 1. Distribucion por courier.
    // ============================================================
    type GrupoCourier = { courierId: number; nombre: string; cantidad: number };
    const couriersMap = new Map<number, GrupoCourier>();

    for (const e of envios) {
      const cId = e.courier.id;
      if (!couriersMap.has(cId)) {
        couriersMap.set(cId, { courierId: cId, nombre: e.courier.nombre, cantidad: 0 });
      }
      couriersMap.get(cId)!.cantidad++;
    }

    const shareByCourier = Array.from(couriersMap.values())
      .map(g => ({
        courierId: g.courierId,
        nombre: g.nombre,
        cantidad: g.cantidad,
        porcentaje: totalEnvios > 0 ? Math.round((g.cantidad / totalEnvios) * 1000) / 10 : 0,
        esLider: false,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // Marcar lider.
    if (shareByCourier.length > 0) {
      shareByCourier[0].esLider = true;
    }

    // ============================================================
    // 2. Resumen agregado.
    // ============================================================
    const cantidadCouriers = shareByCourier.length;
    const topShare = shareByCourier[0]?.porcentaje || 0;
    const esRiesgoAlto = topShare >= THRESHOLD_SPOF;
    const hhi = calcularHHI(shareByCourier.map(c => c.porcentaje));
    const nivelConcentracion = nivelHHI(hhi);

    // ============================================================
    // 3. Evolucion mensual.
    // ============================================================
    type DistribucionMensual = {
      mes: string;
      distribuciones: Array<{ courierId: number; nombre: string; cantidad: number; porcentaje: number }>;
    };

    const porMesMap = new Map<string, Map<number, { nombre: string; cantidad: number }>>();

    for (const e of envios) {
      const fecha = e.fechaImpresion;
      const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;

      if (!porMesMap.has(mesKey)) {
        porMesMap.set(mesKey, new Map());
      }
      const mesMap = porMesMap.get(mesKey)!;
      const cId = e.courier.id;
      if (!mesMap.has(cId)) {
        mesMap.set(cId, { nombre: e.courier.nombre, cantidad: 0 });
      }
      mesMap.get(cId)!.cantidad++;
    }

    const porMes: DistribucionMensual[] = Array.from(porMesMap.entries())
      .map(([mes, mesMap]) => {
        const totalMes = Array.from(mesMap.values()).reduce((sum, m) => sum + m.cantidad, 0);
        const distribuciones = Array.from(mesMap.entries())
          .map(([cId, { nombre, cantidad }]) => ({
            courierId: cId,
            nombre,
            cantidad,
            porcentaje: totalMes > 0 ? Math.round((cantidad / totalMes) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.cantidad - a.cantidad);
        return { mes, distribuciones };
      })
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return NextResponse.json({
      resumen: {
        vista: empresaId !== null ? "empresa" : "global",
        empresaId,
        empresaNombre,
        totalEnvios,
        cantidadCouriers,
        topShare,
        esRiesgoAlto,
        thresholdSPOF: THRESHOLD_SPOF,
        hhi,
        nivelConcentracion,
      },
      shareByCourier,
      porMes,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        vista: empresaId !== null ? "empresa" : "global",
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en concentracion-courier:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Concentracion Courier" },
      { status: 500 }
    );
  }
}
