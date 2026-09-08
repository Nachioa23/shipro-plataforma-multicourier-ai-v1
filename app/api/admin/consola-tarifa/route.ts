import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { IVA_AR_MULTIPLIER_NUM } from "@/lib/constants/iva";

// DEUDA 170 Parte 2 Piezas 1+2+3+4 (2026-09-08): GET consolidado de la Consola
// de Tarifa. Devuelve las 5 variables de la cascada de precio en un solo
// round-trip:
//
//   [1] Por courier (tabla): las 3 variables per-courier vigentes + historial
//       top-5 (Markup del DUEÑO, Markup de SHIPRO, SMO).
//   [2] Global: Markup SHIPRO GLOBAL vigente + historial top-10 (el valor
//       que siguen los couriers en modo HEREDA).
//   [3] Per empresa: Fee (OperacionFee) vigente por empresa activa. Vista
//       compacta para el caso común; la pantalla /admin-fee mantiene el
//       flow avanzado (mass-adjust + promos).
//   [4] Constante: IVA (multiplier, literal) — display-only.
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
const HISTORIAL_GLOBAL_TAKE = 10;

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
    // Batch paralelo. Los findMany per-courier fetchean ALL vigencias
    // (active+closed) ordered desc — cero N+1. Global markup Shipro trae
    // historial top-10 (el más relevante de mostrar completo). Per-empresa
    // Fee trae solo la vigente por empresa (el flow completo con historial
    // + mass-adjust sigue viviendo en /admin-fee).
    const [
      couriers,
      allGlobal,
      allDueno,
      allShipro,
      allSmo,
      empresas,
      feesActivos,
    ] = await Promise.all([
      prisma.courier.findMany({
        where: { activo: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      }),
      prisma.markupShiproVigencia.findMany({
        orderBy: { vigenciaDesde: "desc" },
        take: HISTORIAL_GLOBAL_TAKE,
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
      prisma.empresa.findMany({
        where: { activo: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true, cuit: true },
      }),
      prisma.operacionFee.findMany({
        where: { activo: true },
        orderBy: { vigenteDesde: "desc" },
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

    // Global markup Shipro: la activa + el historial top-N. `globalActivo`
    // preserva el shape que la Pieza 1 ya consumía (backward compat de la UI).
    const globalActivo =
      allGlobal.find((r) => esVigenciaActiva(r)) ?? null;

    // Per-empresa Fee: 1 row por empresa activa. Si la empresa no tiene Fee
    // configurado, `fee` viene null (aparece en la UI como "sin configurar" +
    // link para setear via /admin-fee). Enforce single active vigencia per
    // empresa (la primera desc gana) — mismo criterio que el resolver del
    // motor lee en calcularFeeOperacion.
    const feePorEmpresa = new Map<number, (typeof feesActivos)[number]>();
    for (const f of feesActivos) {
      if (!feePorEmpresa.has(f.empresaId)) feePorEmpresa.set(f.empresaId, f);
    }
    const fees = empresas.map((e) => ({
      empresa: e,
      fee: feePorEmpresa.get(e.id) ?? null,
    }));

    // IVA: constante en código (lib/constants/iva.ts). Display-only en la
    // consola — la eventual promoción a MODELO editable (IvaVigencia) es
    // sub-pieza futura, no en scope hoy.
    const iva = {
      multiplier: IVA_AR_MULTIPLIER_NUM,
      porcentaje: (IVA_AR_MULTIPLIER_NUM - 1) * 100, // 21 (%)
    };

    return NextResponse.json({
      filas,
      globalActivo,
      globalHistorial: allGlobal,
      fees,
      iva,
    });
  } catch (error) {
    console.error("Error cargando consola de tarifa:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
