import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

// DEUDA 186 Fase 2 (2026-10-14) — audit log de cambios de reglas del cliente.
// Best-effort (fire-and-forget con .catch); nunca rompe la operación.
function auditarReglaRuteoCliente(
  request: Request,
  data: {
    reglaRuteoId: number | null;
    empresaId: number;
    accion: "CREADA" | "EDITADA_VALOR" | "ACTIVADA" | "DESACTIVADA" | "ELIMINADA";
    valorNuevo?: string | null;
    motivo?: string | null;
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
        empresaId: data.empresaId,
        reglaRuteoId: data.reglaRuteoId,
        accion: data.accion,
        valorNuevo: data.valorNuevo ?? null,
        motivo: data.motivo ?? null,
      },
    })
    .catch((err) => {
      console.warn("[audit][reglaRuteo cliente] best-effort falló:", err);
    });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const where: any = {};
    if (ctx.empresaId !== null) where.empresaId = ctx.empresaId;

    const reglas = await prisma.reglaRuteo.findMany({ where });

    return NextResponse.json(reglas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener reglas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = resolverContext(request, body.filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    if (ctx.empresaId === null) {
      return NextResponse.json({ error: "Crear/actualizar reglas requiere especificar una empresa." }, { status: 400 });
    }
    const empresaId = ctx.empresaId;

    const { nombre, condicionVariable, condicionOperador, condicionValor1, condicionValor2, accionTipo, accionValor, activa } = body;

    // DEUDA 186 Fase 2 pieza 1 — side-fix (bug lateral detectado por recon):
    // antes el update/create del cliente no incluía condicionValor2 → al activar/editar una regla ENTRE
    // (traída de la plantilla maestra), el segundo valor se perdía y ENTRE nunca funcionaba end-to-end.
    // Ahora se parsea igual que condicionValor1; para reglas sin ENTRE queda null (backward-compat).
    const valor2Parseado =
      condicionValor2 == null || condicionValor2 === ""
        ? null
        : (parseFloat(condicionValor2) || null);

    // MAGIA: Si el cliente está PRENDIENDO esta regla, apagamos todas las demás de su empresa.
    if (activa) {
      await prisma.reglaRuteo.updateMany({
        where: { empresaId },
        data: { activa: false }
      });
    }

    const reglaExistente = await prisma.reglaRuteo.findFirst({
      where: { empresaId, nombre: nombre }
    });

    if (reglaExistente) {
      const actualizada = await prisma.reglaRuteo.update({
        where: { id: reglaExistente.id },
        data: { condicionValor1: parseFloat(condicionValor1) || 0, condicionValor2: valor2Parseado, accionValor, activa }
      });
      // DEUDA 186 Fase 2 — audit cliente: ACTIVADA/DESACTIVADA si el flag cambió,
      // o EDITADA_VALOR si solo cambió el valor manteniendo el estado.
      const accion: "ACTIVADA" | "DESACTIVADA" | "EDITADA_VALOR" =
        reglaExistente.activa !== actualizada.activa
          ? (actualizada.activa ? "ACTIVADA" : "DESACTIVADA")
          : "EDITADA_VALOR";
      auditarReglaRuteoCliente(request, {
        reglaRuteoId: actualizada.id,
        empresaId,
        accion,
        valorNuevo: JSON.stringify({
          condicionValor1: actualizada.condicionValor1,
          condicionValor2: actualizada.condicionValor2,
          accionValor: actualizada.accionValor,
          activa: actualizada.activa,
        }),
        motivo: `Cliente actualizó regla "${actualizada.nombre}"`,
      });
      return NextResponse.json(actualizada);
    } else {
      const nueva = await prisma.reglaRuteo.create({
        data: {
          empresaId,
          nombre, condicionVariable, condicionOperador,
          condicionValor1: parseFloat(condicionValor1) || 0,
          condicionValor2: valor2Parseado,
          accionTipo, accionValor, activa,
          prioridad: 1
        }
      });
      auditarReglaRuteoCliente(request, {
        reglaRuteoId: nueva.id,
        empresaId,
        accion: "CREADA",
        valorNuevo: JSON.stringify({
          nombre: nueva.nombre,
          condicionVariable: nueva.condicionVariable,
          condicionOperador: nueva.condicionOperador,
          condicionValor1: nueva.condicionValor1,
          condicionValor2: nueva.condicionValor2,
          accionTipo: nueva.accionTipo,
          accionValor: nueva.accionValor,
          activa: nueva.activa,
        }),
        motivo: `Cliente activó regla "${nueva.nombre}" (desde plantilla maestra)`,
      });
      return NextResponse.json(nueva);
    }
  } catch (error) {
    return NextResponse.json({ error: "Error al guardar la regla" }, { status: 500 });
  }
}
