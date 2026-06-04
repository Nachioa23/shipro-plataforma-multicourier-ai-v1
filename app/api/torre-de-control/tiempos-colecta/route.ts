// ============================================================================
// TORRE DE CONTROL — METRICA 2.1 "Tiempos Colecta (Tiempo de Despacho)"
// ============================================================================
//
// Documento maestro: docs/TORRE-DE-CONTROL.md (DEUDA 39, diseño 2026-06-04).
//
// Que mide:
//   Tiempo entre la creacion de la etiqueta (Envio.fechaImpresion) y la
//   recoleccion fisica del paquete por el courier (Envio.fechaColecta).
//
//   Nota de naming: el campo "fechaImpresion" se llena automaticamente cuando
//   se crea el Envio en BD (via Prisma @default(now())), NO cuando se imprime
//   fisicamente el PDF. Es decir, mide desde "etiqueta creada" hasta "paquete
//   recolectado".
//
// Auth:
//   - Solo Shipro (admin_shipro y operador_shipro). Validado via resolverContext
//     + check modoDios.
//   - El cliente vera una version derivada de esta metrica en el futuro Panel
//     de Control. Hoy queda exclusiva de Shipro per politica declarada.
//
// Notas tecnicas:
//   - Envios sin fechaColecta se excluyen del calculo pero se reportan
//     explicitamente como cantidadEnviosSinFechaColecta para honestidad de
//     calidad de datos.
//   - Percentiles calculados via helper lib/utils/percentiles.ts (SQLite no
//     soporta PERCENTILE_CONT/DISC nativos).
//   - Sin scope por empresa en esta version. Cuando se construya el Panel
//     de Control con vistas por empresa, se agrega parametro empresaId.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import { calcularEstadisticos } from "@/lib/utils/percentiles";

// Ventana temporal por defecto (en dias).
const VENTANA_DIAS_DEFAULT = 30;

// Nombres de los dias de la semana en castellano para el corte por dia.
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

export async function GET(request: Request) {
  try {
    // Auth: solo roles Shipro.
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.modoDios) {
      return NextResponse.json(
        { error: "No autorizado. Torre de Control es exclusiva de Shipro." },
        { status: 403 }
      );
    }

    // Parametros opcionales.
    const url = new URL(request.url);
    const ventanaDias = parseInt(url.searchParams.get("ventanaDias") || "") || VENTANA_DIAS_DEFAULT;

    const desde = new Date();
    desde.setDate(desde.getDate() - ventanaDias);

    // ========================================================================
    // QUERY — Fetch envios en ventana, con info de deposito y courier.
    // ========================================================================
    const envios = await prisma.envio.findMany({
      where: {
        fechaImpresion: { gte: desde },
      },
      select: {
        id: true,
        fechaImpresion: true,
        fechaColecta: true,
        depositoId: true,
        courierId: true,
        deposito: { select: { id: true, nombre: true } },
        courier: { select: { id: true, nombre: true } },
      },
    });

    // ========================================================================
    // CALCULOS — Filtrar envios validos, calcular deltas, calcular cortes.
    // ========================================================================
    const enviosValidos = envios.filter(e => e.fechaColecta !== null);
    const cantidadEnviosSinFechaColecta = envios.length - enviosValidos.length;

    // Delta en horas para cada envio valido.
    const calcularHoras = (impresion: Date, colecta: Date): number => {
      return (colecta.getTime() - impresion.getTime()) / 3600000;
    };

    const horasGlobales: number[] = enviosValidos.map(e =>
      calcularHoras(e.fechaImpresion, e.fechaColecta!)
    );

    // Estadisticos globales.
    const estadisticosGlobales = calcularEstadisticos(horasGlobales, 1);

    // ========================================================================
    // CORTE POR DEPOSITO
    // ========================================================================
    const porDepositoMap = new Map<number, {
      depositoId: number;
      depositoNombre: string;
      horas: number[];
    }>();

    for (const e of enviosValidos) {
      if (!e.depositoId || !e.deposito) continue;
      const horas = calcularHoras(e.fechaImpresion, e.fechaColecta!);
      const existente = porDepositoMap.get(e.depositoId);
      if (existente) {
        existente.horas.push(horas);
      } else {
        porDepositoMap.set(e.depositoId, {
          depositoId: e.depositoId,
          depositoNombre: e.deposito.nombre,
          horas: [horas],
        });
      }
    }

    const porDeposito = Array.from(porDepositoMap.values())
      .map(d => {
        const stats = calcularEstadisticos(d.horas, 1);
        return {
          depositoId: d.depositoId,
          depositoNombre: d.depositoNombre,
          medianaHoras: stats?.p50 ?? 0,
          promedioHoras: stats?.promedio ?? 0,
          p95Horas: stats?.p95 ?? 0,
          cantidad: stats?.cantidad ?? 0,
        };
      })
      .sort((a, b) => b.cantidad - a.cantidad);

    // ========================================================================
    // CORTE POR COURIER
    // ========================================================================
    const porCourierMap = new Map<number, {
      courierId: number;
      courierNombre: string;
      horas: number[];
    }>();

    for (const e of enviosValidos) {
      if (!e.courierId || !e.courier) continue;
      const horas = calcularHoras(e.fechaImpresion, e.fechaColecta!);
      const existente = porCourierMap.get(e.courierId);
      if (existente) {
        existente.horas.push(horas);
      } else {
        porCourierMap.set(e.courierId, {
          courierId: e.courierId,
          courierNombre: e.courier.nombre,
          horas: [horas],
        });
      }
    }

    const porCourier = Array.from(porCourierMap.values())
      .map(c => {
        const stats = calcularEstadisticos(c.horas, 1);
        return {
          courierId: c.courierId,
          courierNombre: c.courierNombre,
          medianaHoras: stats?.p50 ?? 0,
          promedioHoras: stats?.promedio ?? 0,
          p95Horas: stats?.p95 ?? 0,
          cantidad: stats?.cantidad ?? 0,
        };
      })
      .sort((a, b) => b.cantidad - a.cantidad);

    // ========================================================================
    // CORTE POR DIA DE LA SEMANA (de fechaImpresion)
    // ========================================================================
    // Usa getDay() del runtime del servidor. Si el server corre en UTC y la
    // operacion es Argentina (UTC-3), los dias pueden quedar desfasados en
    // envios creados muy temprano o muy tarde. Es deuda menor: para 1ra
    // version aceptamos la imprecision. Solucion futura: ajustar a UTC-3 con
    // toLocaleString o Intl.DateTimeFormat.
    const porDiaSemanaMap = new Map<number, number[]>();

    for (const e of enviosValidos) {
      const dia = e.fechaImpresion.getDay(); // 0 (domingo) a 6 (sabado)
      const horas = calcularHoras(e.fechaImpresion, e.fechaColecta!);
      const existente = porDiaSemanaMap.get(dia);
      if (existente) {
        existente.push(horas);
      } else {
        porDiaSemanaMap.set(dia, [horas]);
      }
    }

    const porDiaSemana = Array.from(porDiaSemanaMap.entries())
      .map(([dia, horas]) => {
        const stats = calcularEstadisticos(horas, 1);
        return {
          diaSemana: dia,
          diaSemanaNombre: DIAS_SEMANA[dia],
          medianaHoras: stats?.p50 ?? 0,
          promedioHoras: stats?.promedio ?? 0,
          p95Horas: stats?.p95 ?? 0,
          cantidad: stats?.cantidad ?? 0,
        };
      })
      .sort((a, b) => a.diaSemana - b.diaSemana); // ordenar de domingo a sabado

    // ========================================================================
    // RESPONSE
    // ========================================================================
    return NextResponse.json({
      ventanaDias,

      // Estadisticos globales (null si no hay envios validos).
      estadisticosGlobales,

      // Calidad de datos.
      cantidadEnviosTotal: envios.length,
      cantidadEnviosValidos: enviosValidos.length,
      cantidadEnviosSinFechaColecta,

      // Cortes.
      porDeposito,
      porCourier,
      porDiaSemana,
    });
  } catch (error) {
    console.error("[torre-de-control/tiempos-colecta] error:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Tiempos Colecta" },
      { status: 500 }
    );
  }
}
