import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 186 Fase 2 (2026-10-14) — audit log de cambios de reglas de ruteo.
// Best-effort (fire-and-forget con .catch); nunca rompe la operación si el
// insert falla. empresaId=null porque este endpoint maneja PLANTILLAS MAESTRAS
// GLOBALES del admin shipro — las per-empresa viven en /api/empresa/reglas.
function auditarReglaRuteo(
  request: Request,
  data: {
    reglaRuteoId: number | null;
    accion: "CREADA" | "EDITADA_VALOR" | "ACTIVADA" | "DESACTIVADA" | "ELIMINADA";
    campo?: string | null;
    valorAnterior?: string | null;
    valorNuevo?: string | null;
    motivo?: string | null;
    empresaId?: number | null;
  }
): void {
  const usuarioEmail = request.headers.get("x-usuario-email");
  const rolUsuario = request.headers.get("x-rol");
  const ipOrigen = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
  void prisma.auditoriaReglaRuteo
    .create({
      data: {
        usuarioEmail,
        rolUsuario,
        ipOrigen,
        empresaId: data.empresaId ?? null,
        reglaRuteoId: data.reglaRuteoId,
        accion: data.accion,
        campo: data.campo ?? null,
        valorAnterior: data.valorAnterior ?? null,
        valorNuevo: data.valorNuevo ?? null,
        motivo: data.motivo ?? null,
      },
    })
    .catch((err) => {
      console.warn("[audit][reglaRuteo] best-effort falló:", err);
    });
}

export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const reglas = await prisma.reglaRuteo.findMany({
      orderBy: { prioridad: 'asc' }
    });
    return NextResponse.json(reglas);
  } catch (error: any) {
    return NextResponse.json({ error: "Error al obtener las reglas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Calculamos la prioridad: la nueva regla va al final de la cola
    const cantidadActual = await prisma.reglaRuteo.count();

    const nuevaRegla = await prisma.reglaRuteo.create({
      data: {
        nombre: body.nombre,
        condicionVariable: body.condicionVariable,
        condicionOperador: body.condicionOperador,
        condicionValor1: body.condicionValor1 ? parseFloat(body.condicionValor1) : null,
        condicionValor2: body.condicionValor2 ? parseFloat(body.condicionValor2) : null,
        // DEUDA 186 Fase 2 pieza 2 — valor categórico (PROVINCIA_DESTINO; futuras ZONA/SKU).
        // Numéricas quedan null acá; categóricas quedan null en condicionValor1/2. Aditivo.
        condicionValorTexto: body.condicionValorTexto || null,
        accionTipo: body.accionTipo,
        accionValor: body.accionValor || null,
        activa: true,
        prioridad: cantidadActual + 1
      }
    });
    // DEUDA 186 Fase 2 — audit CREADA (plantilla maestra, empresaId=null).
    auditarReglaRuteo(request, {
      reglaRuteoId: nuevaRegla.id,
      accion: "CREADA",
      valorNuevo: JSON.stringify({
        nombre: nuevaRegla.nombre,
        condicionVariable: nuevaRegla.condicionVariable,
        condicionOperador: nuevaRegla.condicionOperador,
        condicionValor1: nuevaRegla.condicionValor1,
        condicionValor2: nuevaRegla.condicionValor2,
        condicionValorTexto: nuevaRegla.condicionValorTexto,
        accionTipo: nuevaRegla.accionTipo,
        accionValor: nuevaRegla.accionValor,
      }),
      motivo: `Admin creó plantilla maestra "${nuevaRegla.nombre}"`,
    });
    return NextResponse.json(nuevaRegla);
  } catch (error: any) {
    console.error("Error al crear regla:", error);
    return NextResponse.json({ error: "Error al crear la regla" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, activa, prioridad } = body;

    // Si pasamos 'activa', actualizamos el estado
    if (activa !== undefined) {
      // DEUDA 186 Fase 2 — leer el estado anterior para el audit (best-effort,
      // query extra tolerable para un endpoint admin de baja frecuencia).
      const prev = await prisma.reglaRuteo.findUnique({ where: { id: Number(id) }, select: { activa: true, nombre: true, empresaId: true } });
      const actualizada = await prisma.reglaRuteo.update({
        where: { id: Number(id) },
        data: { activa }
      });
      auditarReglaRuteo(request, {
        reglaRuteoId: actualizada.id,
        empresaId: actualizada.empresaId,
        accion: activa ? "ACTIVADA" : "DESACTIVADA",
        campo: "activa",
        valorAnterior: prev ? String(prev.activa) : null,
        valorNuevo: String(activa),
        motivo: `Admin ${activa ? "activó" : "desactivó"} regla "${actualizada.nombre}"`,
      });
      return NextResponse.json(actualizada);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "Falta el ID" }, { status: 400 });

    // DEUDA 186 Fase 2 — leer la regla pre-delete para preservar su snapshot en el audit.
    const prev = await prisma.reglaRuteo.findUnique({ where: { id: Number(id) } });
    await prisma.reglaRuteo.delete({ where: { id: Number(id) } });
    auditarReglaRuteo(request, {
      reglaRuteoId: Number(id), // id queda como breadcrumb histórico aunque la fila ya no exista.
      empresaId: prev?.empresaId ?? null,
      accion: "ELIMINADA",
      valorAnterior: prev ? JSON.stringify(prev) : null,
      motivo: `Admin eliminó regla ${prev?.nombre ? `"${prev.nombre}"` : `id=${id}`}`,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}
