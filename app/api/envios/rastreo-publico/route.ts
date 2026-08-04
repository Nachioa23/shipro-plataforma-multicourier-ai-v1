import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Le ordenamos a Next.js que NUNCA guarde en caché esta búsqueda pública.
export const dynamic = 'force-dynamic';

// DEUDA 106 pieza 2 mov 1 (2026-08-04): endpoint público de rastreo — nivel L1.
//
// TRES NIVELES DE LECTURA (design decision Nacho, DEUDA 106):
//   L1 — RASTREO público (este endpoint): estado + courier + vendor + timeline.
//        SIN destino en ninguna forma (ni nombre ni dirección ni PII). Anonymous.
//        Baseline "casi público como Andreani" — quien tenga el tracking ve el estado.
//   L2 — CORRECCIÓN (token, RETENIDO, movimiento 2+): agrega address para prefill.
//   L3 — DASHBOARD (session/ownership, /api/envios/buscar): full data incl. PII del owner.
//
// Esta ruta reemplaza el uso público de /api/envios/buscar por /s/[tracking], que
// PIEZA 1 rompió al gate-arla por sesión. buscar sigue en DUAL_EXACT sin cambios;
// esta es una salida limpia — endpoint separado, proyección INMUTABLE mínima.
//
// PROYECCIÓN L1 — sin destino. Andreani-style: el buyer confirma su paquete por
// tracking + estado, no por ver su nombre. Un scraper que adivine trackings ve
// exactamente lo mismo que cualquier receptor del mail (y nada más).
//
// NO ownership check (público por diseño). NO token todavía (mov 2+).
//
// La proyección se hace con `select` a nivel Prisma — así el shape es un contrato
// codificado en el query, y un contribuidor futuro no puede accidentalmente
// devolver un campo sensible añadiéndolo al include.

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });
    }

    const trackingLimpio = tracking.trim();

    const envio = await prisma.envio.findFirst({
      where: { trackingNumber: trackingLimpio },
      select: {
        trackingNumber: true,
        estadoActual: true,
        fechaImpresion: true,
        fechaColecta: true,
        fechaEntrega: true,
        courier: { select: { nombre: true } },
        empresa: { select: { nombre: true } },
        eventos: {
          orderBy: { fecha: 'desc' },
          select: { estado: true, observacion: true, fecha: true },
        },
      },
    });

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    // El resultado del `select` ya está recortado al shape L1. Se devuelve tal cual.
    // Explícitamente NO se toca destino (ni nombre, ni dirección, ni email, ni
    // documento, ni telefono). Empresa financials, courier internals y campos
    // operativos del envío tampoco fueron pedidos — nunca los emitimos.
    return NextResponse.json(envio);
  } catch (error) {
    console.error("Error en rastreo público:", error);
    return NextResponse.json({ error: "Error al buscar el envío" }, { status: 500 });
  }
}
