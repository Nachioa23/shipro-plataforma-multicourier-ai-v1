import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// ============================================================================
// Consola de Tarifa — REFERENCE tariff endpoint (Mejora B, 2026-09-13).
//
// Read-only: devuelve la última tarifa BASE RAW registrada del courier desde
// HistoricoCotizaciones (fuente: cotizador.guardarHistorico L400-424; se
// upsertea en cada cotización real exitosa por combinación de
// (courierId, cpOrigen, cpDestino, pesoKg, modalidad)). El valor almacenado
// es `op.precioNeto` — el precio raw que el adapter del courier devolvió,
// que dado que los 6 adapters declaran tarifaApiIncluyeIva=false hoy, ES
// directamente el secoNeto (sin IVA, sin markup) que la cascada del preview
// espera como entrada.
//
// CERO CREDENCIALES: no llama a cotizador ni a couriers. Puro DB read.
// CERO SIDE EFFECTS: solo findFirst.
// GATE: admin_shipro (mismo patrón que /api/admin/consola-tarifa/preview).
//
// FALLBACK PROGRESIVO: intenta primero el match más específico
// (courier + cpOrigen + cpDestino + pesoKg) y va relajando si no hay data.
// Reporta en la response qué "coincidencia" logró para que la UI le muestre
// al operador cuán aproximada es la referencia.
// ============================================================================

const COINCIDENCIAS = [
  "exacta",
  "sin_modalidad",
  "sin_peso",
  "sin_cp_origen",
  "sin_peso_ni_origen",
  "solo_courier",
] as const;

type Coincidencia = (typeof COINCIDENCIAS)[number];

export async function POST(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();

    const courierIdRaw = body?.courierId;
    const courierId =
      typeof courierIdRaw === "number" ? courierIdRaw : Number(courierIdRaw);
    if (!Number.isInteger(courierId) || courierId <= 0) {
      return NextResponse.json({ error: "courierId inválido." }, { status: 400 });
    }

    const cpOrigen =
      typeof body?.cpOrigen === "string" && body.cpOrigen.trim().length > 0
        ? body.cpOrigen.trim()
        : null;
    const cpDestino =
      typeof body?.cpDestino === "string" && body.cpDestino.trim().length > 0
        ? body.cpDestino.trim()
        : null;
    const pesoKgRaw = body?.pesoKg;
    const pesoNum =
      pesoKgRaw != null && Number.isFinite(Number(pesoKgRaw))
        ? Math.floor(Number(pesoKgRaw))
        : null;

    // Verificar courier existe (evita reportar sinDato para un id inválido).
    const courier = await prisma.courier.findUnique({
      where: { id: courierId },
      select: { id: true, nombre: true },
    });
    if (!courier) {
      return NextResponse.json(
        { error: `Courier ${courierId} no existe.` },
        { status: 404 },
      );
    }

    // Fallback progresivo: intento del más específico al más laxo.
    // Cada nivel es un pares (filtros, etiqueta). Skip si le faltan datos
    // al filtro (ej. sin cpOrigen no tiene sentido el nivel "exacta").
    const intentos: Array<{ where: any; coincidencia: Coincidencia }> = [];
    if (cpOrigen && cpDestino && pesoNum != null) {
      intentos.push({
        where: { courierId, cpOrigen, cpDestino, pesoKg: pesoNum },
        coincidencia: "exacta",
      });
    }
    if (cpOrigen && cpDestino) {
      intentos.push({
        where: { courierId, cpOrigen, cpDestino },
        coincidencia: "sin_peso",
      });
    }
    if (cpDestino && pesoNum != null) {
      intentos.push({
        where: { courierId, cpDestino, pesoKg: pesoNum },
        coincidencia: "sin_cp_origen",
      });
    }
    if (cpDestino) {
      intentos.push({
        where: { courierId, cpDestino },
        coincidencia: "sin_peso_ni_origen",
      });
    }
    intentos.push({
      where: { courierId },
      coincidencia: "solo_courier",
    });

    for (const { where, coincidencia } of intentos) {
      const row = await prisma.historicoCotizaciones.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          precio: true,
          createdAt: true,
          cpOrigen: true,
          cpDestino: true,
          pesoKg: true,
          modalidad: true,
          servicio: true,
        },
      });
      if (row) {
        return NextResponse.json({
          courier: { id: courier.id, nombre: courier.nombre },
          tarifaBase: row.precio.toString(),
          fuente: "HistoricoCotizaciones",
          coincidencia,
          match: {
            cpOrigen: row.cpOrigen,
            cpDestino: row.cpDestino,
            pesoKg: row.pesoKg,
            modalidad: row.modalidad,
            servicio: row.servicio,
            fecha: row.createdAt.toISOString(),
          },
        });
      }
    }

    // Nadie cotizó nunca a este courier — no hay data para dar referencia.
    return NextResponse.json({
      sinDato: true,
      courier: { id: courier.id, nombre: courier.nombre },
    });
  } catch (error: any) {
    console.error(
      "Error en POST /api/admin/consola-tarifa/tarifa-referencia:",
      error,
    );
    return NextResponse.json(
      { error: error?.message || "Error interno" },
      { status: 500 },
    );
  }
}
