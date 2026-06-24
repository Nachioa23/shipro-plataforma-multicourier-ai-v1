// ============================================================================
// POST /api/onboarding/cambiar-password — paso 1 del wizard
//
// DEUDA 17.E.1 (2026-06-23): permite al gerente_cliente (o operador_cliente
// futuro) cambiar su password temporal por uno propio.
//
// Validaciones:
// - passwordActual debe matchear bcrypt hash en BD.
// - passwordNueva minimo 8 caracteres.
// - passwordNueva NO puede ser igual a passwordActual.
//
// Effects:
// - Update Usuario.password con nuevo hash bcrypt.
// - Mark Usuario.passwordTemporal = false (forced change ya cumplido).
// - Audit log (DEUDA 19): registra el cambio.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { passwordActual, passwordNueva } = body;

    // Validaciones de input.
    if (!passwordActual || !passwordNueva) {
      return NextResponse.json(
        { error: "Faltan datos: passwordActual y passwordNueva son obligatorios." },
        { status: 400 }
      );
    }

    if (passwordNueva.length < 8) {
      return NextResponse.json(
        { error: "La nueva clave debe tener al menos 8 caracteres." },
        { status: 400 }
      );
    }

    if (passwordActual === passwordNueva) {
      return NextResponse.json(
        { error: "La nueva clave debe ser distinta a la actual." },
        { status: 400 }
      );
    }

    // Identificar el usuario por header inyectado por proxy.ts (x-usuario-email).
    const emailUsuario = request.headers.get("x-usuario-email");
    if (!emailUsuario) {
      return NextResponse.json(
        { error: "No autenticado." },
        { status: 401 }
      );
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email: emailUsuario },
    });

    if (!usuario) {
      return NextResponse.json(
        { error: "Usuario no encontrado." },
        { status: 404 }
      );
    }

    // Validar password actual.
    const matchActual = await bcrypt.compare(passwordActual, usuario.password);
    if (!matchActual) {
      return NextResponse.json(
        { error: "La clave actual es incorrecta." },
        { status: 400 }
      );
    }

    // Hashear y guardar password nueva.
    const passwordNuevaHasheado = await bcrypt.hash(passwordNueva, 10);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        password: passwordNuevaHasheado,
        passwordTemporal: false, // Ya no es temporal.
      },
    });

    return NextResponse.json({ ok: true, message: "Clave actualizada correctamente." });
  } catch (error: any) {
    console.error("[/api/onboarding/cambiar-password] Error:", error);
    return NextResponse.json(
      { error: "Error interno al cambiar la clave." },
      { status: 500 }
    );
  }
}
