import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// DEUDA 157 Paso 1 (2026-08-31): admin ver/editar el markup Shipro GENERAL por
// courier con vigencias. Mirror de la ruta del SMO por courier
// (app/api/admin/smo-courier/route.ts, FASE 2 sub 3), adaptado de "un valor por
// courier en $ neto" a "un valor por courier en %". Ver DEUDA 157 (rediseño markup).
//
// PATRÓN DE ESCRITURA — "cerrar + crear" por courier (asiento inverso).
// Cambiar el valor de un courier NUNCA pisa una fila existente: cierra la
// vigencia activa del courier (activo=false, vigenciaHasta=now) y crea una
// nueva (activo=true, vigenciaDesde=now). Ambos writes van dentro de una
// $transaction: si el create falla, el close rollbackea. Mismo patrón que
// SmoCourier y MarkupShiproVigencia — cada courier evoluciona independiente.
//
// AISLAMIENTO DEL MOTOR: ningún path de pricing lee `MarkupCourier` todavía.
// Este endpoint sólo escribe historia; el motor se conecta en Paso 2 de
// DEUDA 157 (rewire de resolverMarkupShiproPorcentaje). Editar acá no cambia
// precios hoy.
//
// AUDITORÍA: el helper registrarCambioConfiguracion (lib/auditoria-configuracion.ts)
// requiere `empresaId: Int` no-null y este cambio no tiene empresa asociada
// (misma razón que las rutas del markup global y SMO). Se registran los datos
// operativos (usuario/rol/ip/courier/antes/nuevo/motivo) vía console.log
// estructurado — la traza del VALOR queda además en las propias filas de
// MarkupCourier (createdAt + vigenciaDesde/Hasta + valorPorcentaje). Audit-log
// persistente para cambios de config GLOBAL queda como deuda (misma que 2a).

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
        const activa = await prisma.markupCourier.findFirst({
          where: { courierId: c.id, activo: true },
          orderBy: { vigenciaDesde: "desc" },
        });
        const historial = await prisma.markupCourier.findMany({
          where: { courierId: c.id },
          orderBy: { vigenciaDesde: "desc" },
          take: 50,
        });
        return { courier: c, activa, historial };
      })
    );

    return NextResponse.json({ filas });
  } catch (error) {
    console.error("Error cargando markup Shipro por courier:", error);
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
      const previa = await tx.markupCourier.findFirst({
        where: { courierId, activo: true },
        orderBy: { vigenciaDesde: "desc" },
      });

      // No-op guard por courier: si el valor no cambia respecto de la
      // vigencia activa del mismo courier, no crear filas idénticas contiguas.
      if (previa && previa.valorPorcentaje.equals(nuevoValor)) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa de ESTE courier si existe.
      if (previa) {
        await tx.markupCourier.update({
          where: { id: previa.id },
          data: { activo: false, vigenciaHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa para el courier. Si no había previa
      // (primer alta para este courier), esta pasa a ser la única.
      const nueva = await tx.markupCourier.create({
        data: {
          courierId,
          valorPorcentaje: nuevoValor,
          activo: true,
          vigenciaDesde: ahora,
        },
      });

      return { previa, nueva, noop: false };
    });

    // Audit-log operacional (no persistente en tabla — ver header).
    const usuarioEmail = request.headers.get("x-usuario-email") || null;
    const ipOrigen =
      request.headers.get("x-ip-origen") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      null;
    console.log(
      "[AUDIT markupCourier]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        ipOrigen,
        campo: "markupCourier",
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
    console.error("Error guardando markup Shipro por courier:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
