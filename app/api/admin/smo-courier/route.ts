import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// FASE 2 sub 3 (2026-08-01): admin ver/editar el SMO por courier con vigencias.
// Mirror de la ruta del markup Shipro global (app/api/admin/markup-shipro/route.ts,
// sub-piece 2a, commit 9b6aa1d), adaptado de "un valor global" a "un valor por
// courier". Ver docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md §5.3 y DEUDA 115.
//
// PATRÓN DE ESCRITURA — "cerrar + crear" por courier (asiento inverso).
// Cambiar el valor de un courier NUNCA pisa una fila existente: cierra la
// vigencia activa del courier (activo=false, vigenciaHasta=now) y crea una
// nueva (activo=true, vigenciaDesde=now). Ambos writes van dentro de una
// $transaction: si el create falla, el close rollbackea. Mismo patrón que el
// markup global — cada courier evoluciona independiente.
//
// AISLAMIENTO DEL MOTOR: ningún path de pricing lee `SmoCourier` todavía
// (grep app/ lib/ components/ → cero hits fuera de este archivo + seed).
// Este endpoint sólo escribe historia; el motor se conecta en una sub-piece
// posterior (paso 5 del §7 del diseño). Editar acá no cambia precios.
//
// AUDITORÍA: el helper registrarCambioConfiguracion (lib/auditoria-configuracion.ts)
// requiere `empresaId: Int` no-null y este cambio no tiene empresa asociada
// (misma razón que la ruta del markup global). Se registran los datos
// operativos (usuario/rol/ip/courier/antes/nuevo/motivo) vía console.log
// estructurado — la traza del VALOR queda además en las propias filas de
// SmoCourier (createdAt + vigenciaDesde/Hasta + valorNeto). Un audit-log
// persistente para cambios de config GLOBAL queda como deuda (misma que 2a).

const MIN_VALOR = 0;
const MAX_VALOR = 100000;

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
        const activa = await prisma.smoCourier.findFirst({
          where: { courierId: c.id, activo: true },
          orderBy: { vigenciaDesde: "desc" },
        });
        const historial = await prisma.smoCourier.findMany({
          where: { courierId: c.id },
          orderBy: { vigenciaDesde: "desc" },
          take: 50,
        });
        return { courier: c, activa, historial };
      })
    );

    return NextResponse.json({ filas });
  } catch (error) {
    console.error("Error cargando SMO por courier:", error);
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
    const raw = body?.valorNeto;
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
    if (!Number.isFinite(parsed) || parsed < MIN_VALOR || parsed > MAX_VALOR) {
      return NextResponse.json(
        {
          error: `valorNeto debe ser un número finito entre ${MIN_VALOR} y ${MAX_VALOR}.`,
        },
        { status: 400 }
      );
    }

    const nuevoValor = new Prisma.Decimal(parsed.toString()).toDecimalPlaces(2);
    const ahora = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      const previa = await tx.smoCourier.findFirst({
        where: { courierId, activo: true },
        orderBy: { vigenciaDesde: "desc" },
      });

      // No-op guard por courier: si el valor no cambia respecto de la
      // vigencia activa del mismo courier, no crear filas idénticas contiguas.
      if (previa && previa.valorNeto.equals(nuevoValor)) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa de ESTE courier si existe.
      if (previa) {
        await tx.smoCourier.update({
          where: { id: previa.id },
          data: { activo: false, vigenciaHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa para el courier. Si no había previa
      // (primer alta para este courier), esta pasa a ser la única — guard
      // del prompt: "si no hay activa, crear la primera en vez de fallar".
      const nueva = await tx.smoCourier.create({
        data: {
          courierId,
          valorNeto: nuevoValor,
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
      "[AUDIT smoCourier]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        ipOrigen,
        campo: "smoCourier",
        courierId,
        courierNombre: courier.nombre,
        sensible: true,
        valorAnterior: resultado.previa?.valorNeto?.toString() ?? null,
        valorNuevo: resultado.nueva.valorNeto.toString(),
        motivo,
        noop: resultado.noop,
        timestamp: ahora.toISOString(),
      })
    );

    return NextResponse.json({ success: true, courier, ...resultado });
  } catch (error: any) {
    console.error("Error guardando SMO por courier:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
