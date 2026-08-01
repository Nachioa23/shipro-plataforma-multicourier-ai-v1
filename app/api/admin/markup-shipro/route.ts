import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// FASE 2 sub 2a (2026-08-01): admin ver/editar el markup Shipro GLOBAL con vigencias.
// Ver docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md §5.2.
//
// PATRÓN DE ESCRITURA — "cerrar + crear" (asiento inverso).
// Cambiar el valor NUNCA pisa una fila existente: cierra la vigencia activa
// (activo=false, vigenciaHasta=now) y crea una nueva (activo=true,
// vigenciaDesde=now). Ambos writes van dentro de una $transaction: si el
// create falla, el close rollbackea. Es el primer writer de este patrón en
// el repo (recon 2026-08-01) — será plantilla de las sub-piezas 2b/2d.
//
// AISLAMIENTO DEL MOTOR: ningún path de pricing lee `MarkupShiproVigencia`
// todavía (grep app/ lib/ components/ → cero hits). Este endpoint sólo
// escribe historia; el motor se conecta en una sub-piece posterior (paso 5
// del §7 del diseño). Editar acá no cambia precios.
//
// AUDITORÍA: el helper `registrarCambioConfiguracion` (lib/auditoria-configuracion.ts)
// requiere `empresaId: Int` no-null (schema `AuditoriaConfiguracion.empresaId`
// es NOT NULL); este cambio es GLOBAL (sin empresa) y ese helper no encaja
// sin un schema change out-of-scope para 2a. Se registran los datos
// operativos (usuario/rol/ip/antes/nuevo/motivo) vía console.log estructurado
// — la traza del VALOR queda además en las propias filas de
// MarkupShiproVigencia (createdAt + vigenciaDesde/Hasta + valorPorcentaje).
// Un audit-log persistente para cambios GLOBAL se registra como DEUDA.

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
    const activa = await prisma.markupShiproVigencia.findFirst({
      where: { activo: true },
      orderBy: { vigenciaDesde: "desc" },
    });

    const historial = await prisma.markupShiproVigencia.findMany({
      orderBy: { vigenciaDesde: "desc" },
      take: 50,
    });

    return NextResponse.json({ activa, historial });
  } catch (error) {
    console.error("Error cargando markup Shipro global:", error);
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
    const raw = body?.valorPorcentaje;
    const motivo: string | null =
      typeof body?.motivo === "string" && body.motivo.trim().length > 0
        ? body.motivo.trim()
        : null;

    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_PORCENTAJE ||
      parsed > MAX_PORCENTAJE
    ) {
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
      const previa = await tx.markupShiproVigencia.findFirst({
        where: { activo: true },
        orderBy: { vigenciaDesde: "desc" },
      });

      // No-op guard: si el valor no cambia respecto de la vigencia activa,
      // no crear filas idénticas contiguas — devolver la actual.
      if (previa && previa.valorPorcentaje.equals(nuevoValor)) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa si existe.
      if (previa) {
        await tx.markupShiproVigencia.update({
          where: { id: previa.id },
          data: { activo: false, vigenciaHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa. Si no había previa (primer alta),
      // esta pasa a ser la única (guard del prompt: "si no hay activa, crear
      // la primera en vez de fallar").
      const nueva = await tx.markupShiproVigencia.create({
        data: {
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
      "[AUDIT markupShiproGlobal]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        ipOrigen,
        campo: "markupShiproGlobal",
        sensible: true,
        valorAnterior: resultado.previa?.valorPorcentaje?.toString() ?? null,
        valorNuevo: resultado.nueva.valorPorcentaje.toString(),
        motivo,
        noop: resultado.noop,
        timestamp: ahora.toISOString(),
      })
    );

    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error("Error guardando markup Shipro global:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
