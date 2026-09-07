import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 170 Pieza A (2026-09-07): admin ver/editar el markup del DUEÑO de
// credenciales (CourierIntermediario). Calqueada de app/api/admin/markup-courier
// (DEUDA 157 Paso 1) — mismo shape "cerrar + crear vigencia" per courier,
// simplificada porque el markup del dueño no tiene el switch HEREDA/PROPIO
// (siempre valor propio o cero).
//
// SEMÁNTICA — CADA ROW REPRESENTA "EL MARKUP QUE UN COURIER COBRA CUANDO ES DUEÑO
// PRESTANDO SUS CREDENCIALES":
// - courier fila X en la UI = "cuánto cobra X cuando otro courier despacha con
//   las credenciales de X".
// - valor 0 = X no cobra intermediario (ej. X es Shipro-owned de facto, o no
//   presta credenciales). Distinto de "sin fila" en semántica UI, pero
//   equivalente en el motor (resolverIntermediario retorna null → factor 1).
// - valor > 0 = X es intermediario y cobra ese % (ej. Mocis 10% en el par
//   Mocis→Andreani).
//
// KEY: propietarioCourierId (el DUEÑO). El engine lee EXACTAMENTE por este
// eje (lib/utils/resolvers-tarifa.ts:220 → `findFirst({ propietarioCourierId, ... })`).
// El campo `courierId` (ejecutor legacy DEUDA 107) se setea = propietarioCourierId
// para no romper el @@index legacy `[courierId, activo]` ni el include vigente
// de cotizador.ts:279. El resolver moderno NO consulta el eje ejecutor excepto
// en el fallback legacy `propietarioTipo=null` (que este endpoint nunca genera).
//
// AISLAMIENTO DEL MOTOR: NINGÚN cambio a resolvers-tarifa.ts / cotizador.ts /
// crear.ts. La UI escribe el MISMO field/key que el engine ya lee — config↔engine
// alineado por construcción.
//
// PATRÓN DE ESCRITURA: mismo "cerrar + crear" atómico que markup-courier /
// smo-courier / markupShiproVigencia. Nunca se pisa una fila existente: cierra
// la vigencia activa del owner y crea una nueva. No-op guard por valor único.
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
        const activa = await prisma.courierIntermediario.findFirst({
          where: { propietarioCourierId: c.id, activo: true },
          orderBy: { vigenciaDesde: "desc" },
        });
        const historial = await prisma.courierIntermediario.findMany({
          where: { propietarioCourierId: c.id },
          orderBy: { vigenciaDesde: "desc" },
          take: 50,
        });
        return { courier: c, activa, historial };
      })
    );

    return NextResponse.json({ filas });
  } catch (error) {
    console.error("Error cargando markup del dueño:", error);
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

    // courierId acá se interpreta como el DUEÑO (propietarioCourierId). La UI
    // lista couriers 1:1 con este endpoint — cada fila es "este courier cuando
    // actúa como dueño prestando credenciales".
    const propietarioCourierId =
      typeof courierIdRaw === "number" ? courierIdRaw : Number(courierIdRaw);
    if (!Number.isInteger(propietarioCourierId) || propietarioCourierId <= 0) {
      return NextResponse.json(
        { error: "courierId inválido." },
        { status: 400 }
      );
    }

    const courier = await prisma.courier.findUnique({
      where: { id: propietarioCourierId },
      select: { id: true, nombre: true },
    });
    if (!courier) {
      return NextResponse.json(
        { error: `Courier ${propietarioCourierId} no existe.` },
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

    // markupPorcentaje es Float en schema (a diferencia de MarkupCourier que es
    // Decimal); se compara con === numérico directo en el no-op guard.
    const nuevoValor = parsed;
    const ahora = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      const previa = await tx.courierIntermediario.findFirst({
        where: { propietarioCourierId, activo: true },
        orderBy: { vigenciaDesde: "desc" },
      });

      // No-op guard: si el valor no cambia, no se crean filas idénticas.
      if (previa && previa.markupPorcentaje === nuevoValor) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa de ESTE dueño si existe.
      if (previa) {
        await tx.courierIntermediario.update({
          where: { id: previa.id },
          data: { activo: false, vigenciaHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa para el dueño. `courierId` (ejecutor
      // legacy) se setea = propietarioCourierId (self-refer) — el schema lo
      // requiere NOT NULL y el resolver moderno NO consulta este eje excepto
      // en el fallback `propietarioTipo=null` que este endpoint nunca genera.
      const nueva = await tx.courierIntermediario.create({
        data: {
          courierId: propietarioCourierId,
          propietarioCourierId,
          markupPorcentaje: nuevoValor,
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
      "[AUDIT courierIntermediario]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        ipOrigen,
        campo: "markupDueno",
        propietarioCourierId,
        courierNombre: courier.nombre,
        sensible: true,
        valorAnterior: resultado.previa?.markupPorcentaje ?? null,
        valorNuevo: resultado.nueva.markupPorcentaje,
        motivo,
        noop: resultado.noop,
        timestamp: ahora.toISOString(),
      })
    );

    return NextResponse.json({ success: true, courier, ...resultado });
  } catch (error: any) {
    console.error("Error guardando markup del dueño:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
