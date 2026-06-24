// ============================================================================
// GET /api/onboarding/datos — devuelve datos para el paso 2 del wizard
//
// DEUDA 17.E.4.2.a (2026-06-23): lee datos actuales de Empresa + Usuario
// del cliente autenticado para pre-rellenar el form de "Confirmar datos".
//
// Solo expone los campos relevantes al onboarding (no apiKey, no saldo, etc).
//
// Auth: requiere x-empresa-id + x-usuario-email (inyectados por proxy.ts).
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const empresaIdHeader = request.headers.get("x-empresa-id");
    const emailUsuario = request.headers.get("x-usuario-email");

    if (!empresaIdHeader || !emailUsuario) {
      return NextResponse.json(
        { error: "No autenticado o sin empresa." },
        { status: 401 }
      );
    }

    const empresaId = parseInt(empresaIdHeader);

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        cuit: true,
        direccionFiscalCalle: true,
        direccionFiscalAltura: true,
        direccionFiscalCP: true,
        direccionFiscalLocalidad: true,
        direccionFiscalProvincia: true,
        modalidadPago: true,
        limiteDescubierto: true,
        modeloAHabilitado: true,
        onboardingCompletado: true,
      },
    });

    const usuario = await prisma.usuario.findUnique({
      where: { email: emailUsuario },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        passwordTemporal: true,
      },
    });

    if (!empresa || !usuario) {
      return NextResponse.json(
        { error: "Empresa o usuario no encontrados." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      empresa,
      usuario,
    });
  } catch (error: any) {
    console.error("[/api/onboarding/datos] Error:", error);
    return NextResponse.json(
      { error: "Error interno al cargar los datos." },
      { status: 500 }
    );
  }
}
