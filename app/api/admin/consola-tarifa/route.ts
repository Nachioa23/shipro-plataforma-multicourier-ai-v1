import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 170 Parte 2 Pieza 1 (2026-09-08, elevada 2026-09-08): GET consolidado
// de la Consola de Tarifa. Devuelve, per courier activo, las 3 variables
// per-courier vigentes de la cascada de precio + su HISTORIAL reciente (top 5)
// para el accordion inline. Además incluye el `globalActivo` del markup Shipro
// (hint del modo HEREDA).
//
// Variables por courier:
//   - Markup del DUEÑO (MarkupIntermediarioCourier.valorPorcentaje)
//   - Markup de SHIPRO (MarkupCourier: modo HEREDA/PROPIO + valorPorcentaje)
//   - SMO (SmoCourier.valorNeto — monto $ neto, no %)
//
// ARQUITECTURA: solo GET (read consolidado). Los SAVES los hace la pantalla
// via los 3 endpoints existentes: POST /api/admin/markup-dueno,
// /api/admin/markup-courier, /api/admin/smo-courier. Cada uno mantiene su
// "cerrar+crear vigencia" transaction — cero duplicación de la lógica de
// vigencia-swap. La consola es una VISTA nueva sobre mecanismos config
// existentes; los 3 endpoints atómicos siguen sirviendo a las pantallas
// individuales (que quedan operativas mientras la migración a la consola
// sea gradual).
//
// AISLAMIENTO DEL MOTOR: cero cambios en el motor de precios. Este endpoint
// lee los MISMOS modelos que el motor ya lee (via los resolvers
// resolverMarkupCourierPorcentaje, resolverSmoNeto,
// resolverIntermediarioMarkupPorcentaje). Editar valores desde la consola
// cambia precios en la próxima cotización (mismo efecto que editar desde las
// pantallas atómicas — single source of truth).
//
// GATE: admin_shipro.

const HISTORIAL_TAKE = 5;

function esVigenciaActiva(row: { activo: boolean; vigenciaDesde: Date; vigenciaHasta: Date | null }) {
  const ahora = new Date();
  return (
    row.activo &&
    row.vigenciaDesde <= ahora &&
    (row.vigenciaHasta === null || row.vigenciaHasta >= ahora)
  );
}

// Reduce: para una lista de vigencias ordenadas por vigenciaDesde desc, extrae
// la ACTIVA (primera que cumple activo + rango) y el HISTORIAL (top N por
// courier, incluye la activa como primer elemento por convenio de la UI).
function reducirPorCourier<T extends { courierId: number; activo: boolean; vigenciaDesde: Date; vigenciaHasta: Date | null }>(
  rows: T[],
  take: number = HISTORIAL_TAKE
) {
  const activas = new Map<number, T>();
  const historial = new Map<number, T[]>();
  for (const r of rows) {
    if (esVigenciaActiva(r) && !activas.has(r.courierId)) {
      activas.set(r.courierId, r);
    }
    const arr = historial.get(r.courierId) ?? [];
    if (arr.length < take) arr.push(r);
    historial.set(r.courierId, arr);
  }
  return { activas, historial };
}

export async function GET(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    // Batch paralelo. Los 3 findMany fetchean ALL vigencias (active+closed),
    // ordered desc — cero N+1. La reducción in-memory extrae la vigente y
    // el historial top-5 por courier. Volumen minúsculo (6 couriers × 3 vars ×
    // ~5 vigencias = ~90 rows max) — trivial en overhead.
    const [couriers, globalActivo, allDueno, allShipro, allSmo] = await Promise.all([
      prisma.courier.findMany({
        where: { activo: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      }),
      prisma.markupShiproVigencia.findFirst({
        where: { activo: true },
        orderBy: { vigenciaDesde: "desc" },
        select: { id: true, valorPorcentaje: true, vigenciaDesde: true },
      }),
      prisma.markupIntermediarioCourier.findMany({
        orderBy: { vigenciaDesde: "desc" },
      }),
      prisma.markupCourier.findMany({
        orderBy: { vigenciaDesde: "desc" },
      }),
      prisma.smoCourier.findMany({
        orderBy: { vigenciaDesde: "desc" },
      }),
    ]);

    const dueno = reducirPorCourier(allDueno);
    const shipro = reducirPorCourier(allShipro);
    const smo = reducirPorCourier(allSmo);

    const filas = couriers.map((c) => ({
      courier: c,
      markupDueno: dueno.activas.get(c.id) ?? null,
      markupShipro: shipro.activas.get(c.id) ?? null,
      smo: smo.activas.get(c.id) ?? null,
      historial: {
        dueno: dueno.historial.get(c.id) ?? [],
        shipro: shipro.historial.get(c.id) ?? [],
        smo: smo.historial.get(c.id) ?? [],
      },
    }));

    return NextResponse.json({ filas, globalActivo });
  } catch (error) {
    console.error("Error cargando consola de tarifa:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
