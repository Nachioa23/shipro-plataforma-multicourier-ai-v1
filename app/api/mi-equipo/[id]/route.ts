// ============================================================================
// PATCH /api/mi-equipo/[id] — activar/desactivar operador
//
// DEUDA 17.F.2 (2026-06-23): soft-delete via Usuario.activo. El gerente solo
// puede cambiar el flag de operadores de SU empresa.
//
// Auth: solo gerente_cliente. Empresa scope: id del operador debe pertenecer
// a la empresa del gerente (segunda validacion antes del update).
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const operadorId = parseInt(params.id);

    if (isNaN(operadorId)) {
      return NextResponse.json({ error: "ID invalido." }, { status: 400 });
    }

    const empresaIdHeader = request.headers.get("x-empresa-id");
    const rol = request.headers.get("x-rol");

    if (!empresaIdHeader) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (rol !== "gerente_cliente") {
      return NextResponse.json({ error: "Solo el gerente puede modificar a su equipo." }, { status: 403 });
    }

    const empresaId = parseInt(empresaIdHeader);

    const body = await request.json();
    const { activo } = body;

    if (typeof activo !== "boolean") {
      return NextResponse.json({ error: "Campo 'activo' debe ser true o false." }, { status: 400 });
    }

    // Validar que el operador existe Y pertenece a la empresa del gerente.
    const operador = await prisma.usuario.findUnique({
      where: { id: operadorId },
    });

    if (!operador) {
      return NextResponse.json({ error: "Operador no encontrado." }, { status: 404 });
    }
    if (operador.empresaId !== empresaId) {
      return NextResponse.json({ error: "Ese operador no pertenece a tu equipo." }, { status: 403 });
    }
    if (operador.rol !== "operador_cliente") {
      return NextResponse.json({ error: "Solo se puede modificar operadores." }, { status: 403 });
    }

    const operadorActualizado = await prisma.usuario.update({
      where: { id: operadorId },
      data: { activo },
      select: {
        id: true,
        nombre: true,
        email: true,
        activo: true,
      },
    });

    return NextResponse.json({ operador: operadorActualizado });
  } catch (error: any) {
    console.error("[PATCH /api/mi-equipo/[id]] Error:", error);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
