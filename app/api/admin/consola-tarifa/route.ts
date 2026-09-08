import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 170 Parte 2 Pieza 1 (2026-09-08): GET consolidado de la Consola de
// Tarifa — devuelve, per courier activo, las 3 variables per-courier de la
// cascada de precio en una sola respuesta:
//   - Markup del DUEÑO (MarkupIntermediarioCourier.valorPorcentaje)
//   - Markup de SHIPRO (MarkupCourier: modo HEREDA/PROPIO + valorPorcentaje)
//   - SMO (SmoCourier.valorNeto — monto $ neto, no %)
// Además incluye `globalActivo` del `MarkupShiproVigencia` (para el hint
// "hereda X%" cuando el modo de Shipro-per-courier es HEREDA).
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
// resolverMarkupCourierPorcentaje, resolverSmoNeto, resolverIntermediarioMarkupPorcentaje).
// Editar valores desde la consola cambia precios en la próxima cotización
// (mismo efecto que editar desde las pantallas atómicas).
//
// GATE: admin_shipro. Espejo del pattern de las 3 pantallas hermanas.

const VIGENCIA_FILTER = () => {
  const ahora = new Date();
  return {
    activo: true,
    vigenciaDesde: { lte: ahora },
    OR: [
      { vigenciaHasta: null as Date | null },
      { vigenciaHasta: { gte: ahora } },
    ],
  };
};

export async function GET(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const filtro = VIGENCIA_FILTER();

    // Batch en paralelo: couriers + global + los 3 conjuntos de vigencias
    // activas de una sola pasada. Cero N+1.
    const [couriers, globalActivo, markupsDueno, markupsShipro, smos] = await Promise.all([
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
        where: filtro,
        orderBy: { vigenciaDesde: "desc" },
      }),
      prisma.markupCourier.findMany({
        where: filtro,
        orderBy: { vigenciaDesde: "desc" },
      }),
      prisma.smoCourier.findMany({
        where: filtro,
        orderBy: { vigenciaDesde: "desc" },
      }),
    ]);

    // Reducer per courier: primera vigencia activa (findFirst semantics — la
    // más reciente por vigenciaDesde). Un courier sin fila deja el field null,
    // que la UI presenta como "sin configurar" (semánticamente = valor 0 en la
    // cascada del motor).
    const primeroPorCourier = <T extends { courierId: number }>(rows: T[]) => {
      const map = new Map<number, T>();
      for (const r of rows) {
        if (!map.has(r.courierId)) map.set(r.courierId, r);
      }
      return map;
    };

    const dueno = primeroPorCourier(markupsDueno);
    const shipro = primeroPorCourier(markupsShipro);
    const smo = primeroPorCourier(smos);

    const filas = couriers.map((c) => ({
      courier: c,
      markupDueno: dueno.get(c.id) ?? null,
      markupShipro: shipro.get(c.id) ?? null,
      smo: smo.get(c.id) ?? null,
    }));

    return NextResponse.json({ filas, globalActivo });
  } catch (error) {
    console.error("Error cargando consola de tarifa:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
