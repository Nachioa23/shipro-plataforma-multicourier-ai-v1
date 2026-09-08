import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// DEUDA 170 Pieza 2 (2026-09-08): admin ver/editar el markup del INTERMEDIARIO /
// dueño de credenciales, POR COURIER que despacha. Reescrito para apuntar al
// modelo nuevo MarkupIntermediarioCourier (creado en Pieza 1) — hermano de
// MarkupCourier, per-courier + vigencias, sin modo HEREDA/PROPIO (no hay global
// del cual heredar). Mirror del patrón de /api/admin/markup-courier (que ya vive
// en MarkupCourier con vigencia-swap "cerrar + crear").
//
// SEMÁNTICA — CADA ROW ES "EL MARKUP QUE APLICA CUANDO SE DESPACHA CON ESTE COURIER":
// - courier fila X en la UI = "cuánto cobra el dueño de las credenciales de X
//   cuando X despacha". Valor 0 = las credenciales de X son de Shipro (o no
//   tienen intermediario) → sin cascada de intermediario.
// - valor > 0 = las credenciales de X son de un tercero que cobra ese % (ej.
//   Andreani cuyas credenciales presta Mocis → fila Andreani = 10%).
//
// KEY: courierId (el COURIER QUE DESPACHA). El engine lo va a leer EXACTAMENTE
// por este eje en Pieza 4 (rewire del resolver: `findFirst({ courierId })`).
// La key acá coincide con la key futura del engine — cero mismatch de dos-fuentes
// (a diferencia del intento anterior que escribía en CourierIntermediario keyed
// por propietarioCourierId mientras el engine también leía por owner: al menos
// era key-consistente, pero la SEMÁNTICA per-owner no matcheaba el modelo Nacho
// per-courier — de ahí el "backwards" reportado en las pruebas).
//
// AISLAMIENTO DEL MOTOR: hoy el motor de plata SIGUE leyendo el modelo VIEJO
// CourierIntermediario (owner-keyed). Editar/poblar MarkupIntermediarioCourier
// desde acá NO cambia precios hasta que Pieza 4 haga el swap del resolver.
// Este endpoint pobla la fuente de verdad futura; Nacho carga valores acá antes
// del rewire del motor. Consistent con el playbook DEUDA 157 / SmoCourier.
//
// PATRÓN DE ESCRITURA — "cerrar + crear" por courier (asiento inverso, mismo
// que /admin-markup-courier / /admin-smo). Cambiar el valor de un courier NUNCA
// pisa una fila existente: cierra la vigencia activa del courier
// (activo=false, vigenciaHasta=now) y crea una nueva (activo=true, vigenciaDesde=now).
// Ambos writes en una $transaction: si el create falla, el close rollbackea.
//
// AUDITORÍA: console.log estructurado (mismo motivo que hermanos:
// registrarCambioConfiguracion exige empresaId no-null y esto es config global).

const MIN_PORCENTAJE = 0;
const MAX_PORCENTAJE = 100;

export async function GET(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const couriers = await prisma.courier.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    });

    const filas = await Promise.all(
      couriers.map(async (c) => {
        const activa = await prisma.markupIntermediarioCourier.findFirst({
          where: { courierId: c.id, activo: true },
          orderBy: { vigenciaDesde: "desc" },
        });
        const historial = await prisma.markupIntermediarioCourier.findMany({
          where: { courierId: c.id },
          orderBy: { vigenciaDesde: "desc" },
          take: 50,
        });
        return { courier: c, activa, historial };
      })
    );

    return NextResponse.json({ filas });
  } catch (error) {
    console.error("Error cargando markup del intermediario por courier:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const courierIdRaw = body?.courierId;
    const raw = body?.valorPorcentaje;
    const motivo: string | null =
      typeof body?.motivo === "string" && body.motivo.trim().length > 0
        ? body.motivo.trim()
        : null;

    // courierId acá es el COURIER QUE DESPACHA. La UI lista couriers 1:1 con
    // este endpoint — cada fila = "cuando despachamos con este courier, cuánto
    // cobra el dueño de sus credenciales".
    const courierId =
      typeof courierIdRaw === "number" ? courierIdRaw : Number(courierIdRaw);
    if (!Number.isInteger(courierId) || courierId <= 0) {
      return NextResponse.json(
        { error: "courierId inválido." },
        { status: 400 }
      );
    }

    const courier = await prisma.courier.findUnique({
      where: { id: courierId },
      select: { id: true, nombre: true },
    });
    if (!courier) {
      return NextResponse.json(
        { error: `Courier ${courierId} no existe.` },
        { status: 404 }
      );
    }

    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_PORCENTAJE || parsed > MAX_PORCENTAJE) {
      return NextResponse.json(
        {
          error: `valorPorcentaje debe ser un número finito entre ${MIN_PORCENTAJE} y ${MAX_PORCENTAJE}.`,
        },
        { status: 400 }
      );
    }

    const nuevoValor = new Prisma.Decimal(parsed.toString()).toDecimalPlaces(4);
    const ahora = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      const previa = await tx.markupIntermediarioCourier.findFirst({
        where: { courierId, activo: true },
        orderBy: { vigenciaDesde: "desc" },
      });

      // No-op guard: si el valor no cambia, no se crean filas idénticas.
      if (previa && previa.valorPorcentaje.equals(nuevoValor)) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa de ESTE courier si existe.
      if (previa) {
        await tx.markupIntermediarioCourier.update({
          where: { id: previa.id },
          data: { activo: false, vigenciaHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa para el courier. Mirror plain de
      // MarkupCourier (sin field `modo` — el intermediario no tiene HEREDA).
      const nueva = await tx.markupIntermediarioCourier.create({
        data: {
          courierId,
          valorPorcentaje: nuevoValor,
          activo: true,
          vigenciaDesde: ahora,
        },
      });

      return { previa, nueva, noop: false };
    });

    // Audit-log operacional.
    const usuarioEmail = request.headers.get("x-usuario-email") || null;
    const ipOrigen =
      request.headers.get("x-ip-origen") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      null;
    console.log(
      "[AUDIT markupIntermediarioCourier]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        ipOrigen,
        campo: "markupIntermediarioCourier",
        courierId,
        courierNombre: courier.nombre,
        sensible: true,
        valorAnterior: resultado.previa?.valorPorcentaje?.toString() ?? null,
        valorNuevo: resultado.nueva.valorPorcentaje.toString(),
        motivo,
        noop: resultado.noop,
        timestamp: ahora.toISOString(),
      })
    );

    return NextResponse.json({ success: true, courier, ...resultado });
  } catch (error: any) {
    console.error("Error guardando markup del intermediario por courier:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
