// ============================================================================
// TORRE DE CONTROL — METRICA 2.4 "Tasa de Tickets de Mesa de Ayuda"
//
// Mide el volumen y la velocidad de resolucion de tickets de soporte sobre
// el total de envios. Indicador de salud operativa: cuantos envios generan
// problemas que requieren intervencion manual y cuanto tarda resolverlos.
//
// Decisiones (director 2026-06-09):
// - Universo: tickets creados en ventana 90 dias.
// - Tasa: tickets / envios totales en ventana × 100.
// - Tiempo de resolucion: MEDIANA de dias entre fechaCreacion y
//   fechaCierre (solo CERRADOS). Mas robusto que promedio ante outliers.
// - Origen Radar Shipro vs Cliente: heuristica por substring en motivo
//   (mientras no exista campo formal — DEUDA 53).
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

const VENTANA_DIAS = 90;

// Substrings que identifican tickets auto-creados por Radar Shipro (cron).
// Cuando se cree el campo formal `origen` en TicketSoporte (DEUDA 53),
// esta heuristica se reemplaza por un check directo.
const SUBSTRINGS_RADAR_SHIPRO = [
  "demora sin actualizacion",
  "auto-creado",
  "sin movimiento",
];

function esRadarShipro(motivo: string): boolean {
  const m = motivo.toLowerCase();
  return SUBSTRINGS_RADAR_SHIPRO.some(s => m.includes(s));
}

function calcularMediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 0) {
    return Math.round(((ordenados[mid - 1] + ordenados[mid]) / 2) * 10) / 10;
  }
  return Math.round(ordenados[mid] * 10) / 10;
}

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json({ error: "Acceso solo para roles Shipro." }, { status: 403 });
    }

    const ventanaInicio = new Date();
    ventanaInicio.setDate(ventanaInicio.getDate() - VENTANA_DIAS);

    // Fetch tickets en ventana + envio + courier.
    const tickets = await prisma.ticketSoporte.findMany({
      where: {
        fechaCreacion: { gte: ventanaInicio },
      },
      include: {
        envio: {
          include: {
            courier: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    // Denominador: envios en la misma ventana.
    const totalEnviosEnVentana = await prisma.envio.count({
      where: {
        fechaImpresion: { gte: ventanaInicio },
      },
    });

    // ============================================================
    // 1. Resumen agregado.
    // ============================================================
    const totalTickets = tickets.length;
    const totalActivos = tickets.filter(t => t.estado === "ABIERTO" || t.estado === "EN_PROGRESO").length;
    const totalCerrados = tickets.filter(t => t.estado === "CERRADO").length;

    const tasaSoporte = totalEnviosEnVentana > 0
      ? Math.round((totalTickets / totalEnviosEnVentana) * 1000) / 10
      : 0;

    // Tiempo mediano de resolucion (solo CERRADOS).
    const tiemposResolucion = tickets
      .filter(t => t.estado === "CERRADO" && t.fechaCierre)
      .map(t => {
        const ms = new Date(t.fechaCierre!).getTime() - new Date(t.fechaCreacion).getTime();
        return ms / (1000 * 60 * 60 * 24); // dias
      });

    const tiempoMedianoResolucion = calcularMediana(tiemposResolucion);

    // ============================================================
    // 2. Distribucion de estados.
    // ============================================================
    const conteoAbierto = tickets.filter(t => t.estado === "ABIERTO").length;
    const conteoEnProgreso = tickets.filter(t => t.estado === "EN_PROGRESO").length;
    const conteoCerrado = totalCerrados;

    const distribucionEstados = {
      abierto: {
        cantidad: conteoAbierto,
        porcentaje: totalTickets > 0 ? Math.round((conteoAbierto / totalTickets) * 100) : 0,
      },
      enProgreso: {
        cantidad: conteoEnProgreso,
        porcentaje: totalTickets > 0 ? Math.round((conteoEnProgreso / totalTickets) * 100) : 0,
      },
      cerrado: {
        cantidad: conteoCerrado,
        porcentaje: totalTickets > 0 ? Math.round((conteoCerrado / totalTickets) * 100) : 0,
      },
    };

    // ============================================================
    // 3. Origen (Radar Shipro vs Cliente).
    // ============================================================
    const radarShipro = tickets.filter(t => esRadarShipro(t.motivo)).length;
    const cliente = totalTickets - radarShipro;

    const origen = {
      radarShipro: {
        cantidad: radarShipro,
        porcentaje: totalTickets > 0 ? Math.round((radarShipro / totalTickets) * 100) : 0,
      },
      cliente: {
        cantidad: cliente,
        porcentaje: totalTickets > 0 ? Math.round((cliente / totalTickets) * 100) : 0,
      },
    };

    // ============================================================
    // 4. Top motivos.
    // ============================================================
    const motivosFreq = new Map<string, number>();
    for (const t of tickets) {
      motivosFreq.set(t.motivo, (motivosFreq.get(t.motivo) || 0) + 1);
    }
    const topMotivos = Array.from(motivosFreq.entries())
      .map(([motivo, cantidad]) => ({
        motivo,
        cantidad,
        porcentaje: totalTickets > 0 ? Math.round((cantidad / totalTickets) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    // ============================================================
    // 5. Por courier.
    // ============================================================
    type GrupoCourier = { courierId: number; nombre: string; cantidad: number };
    const porCourierMap = new Map<string, GrupoCourier>();
    for (const t of tickets) {
      const cId = t.envio.courier.id;
      const key = `${cId}`;
      if (!porCourierMap.has(key)) {
        porCourierMap.set(key, { courierId: cId, nombre: t.envio.courier.nombre, cantidad: 0 });
      }
      porCourierMap.get(key)!.cantidad++;
    }

    // Denominador por courier para tasa especifica.
    const enviosPorCourier = await prisma.envio.groupBy({
      by: ["courierId"],
      where: {
        fechaImpresion: { gte: ventanaInicio },
      },
      _count: true,
    });
    const enviosPorCourierMap = new Map<number, number>();
    for (const e of enviosPorCourier) {
      enviosPorCourierMap.set(e.courierId, e._count);
    }

    const porCourier = Array.from(porCourierMap.values())
      .map(g => {
        const enviosCount = enviosPorCourierMap.get(g.courierId) || 0;
        return {
          courierId: g.courierId,
          nombre: g.nombre,
          cantidad: g.cantidad,
          enviosTotales: enviosCount,
          tasaSoporte: enviosCount > 0
            ? Math.round((g.cantidad / enviosCount) * 1000) / 10
            : 0,
        };
      })
      .sort((a, b) => b.cantidad - a.cantidad);

    // ============================================================
    // 6. Por mes.
    // ============================================================
    const porMesMap = new Map<string, number>();
    for (const t of tickets) {
      const fecha = new Date(t.fechaCreacion);
      const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
      porMesMap.set(mesKey, (porMesMap.get(mesKey) || 0) + 1);
    }
    const porMes = Array.from(porMesMap.entries())
      .map(([mes, cantidad]) => ({ mes, cantidad }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return NextResponse.json({
      resumen: {
        totalTickets,
        totalActivos,
        totalCerrados,
        totalEnviosEnVentana,
        tasaSoporte,
        tiempoMedianoResolucion,
      },
      distribucionEstados,
      origen,
      topMotivos,
      porCourier,
      porMes,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en tickets-mesa-ayuda:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Tasa de Tickets de Mesa de Ayuda" },
      { status: 500 }
    );
  }
}
