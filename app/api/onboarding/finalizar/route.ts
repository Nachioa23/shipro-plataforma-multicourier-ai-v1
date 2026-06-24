// ============================================================================
// POST /api/onboarding/finalizar — paso final del wizard
//
// DEUDA 17.E.3 (2026-06-23): marca Empresa.onboardingCompletado=true cuando
// el gerente completa todos los pasos del wizard.
//
// Effects:
// - Empresa.onboardingCompletado = true (gate del layout desactivado).
// - Audit log: registra el cambio.
//
// Post-call: el frontend debe forzar refresh de session (NextAuth callback)
// para que el nuevo flag se refleje en el JWT y deshabilite el redirect.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { registrarCambioConfiguracion } from "@/lib/auditoria-configuracion";

export async function POST(request: Request) {
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

    const empresaAntes = await prisma.empresa.findUnique({
      where: { id: empresaId },
    });

    if (!empresaAntes) {
      return NextResponse.json(
        { error: "Empresa no encontrada." },
        { status: 404 }
      );
    }

    if (empresaAntes.onboardingCompletado === true) {
      return NextResponse.json(
        { ok: true, message: "Onboarding ya estaba completo.", yaEstaba: true },
        { status: 200 }
      );
    }

    // Update + audit en paralelo (audit no debe romper la operacion).
    await prisma.empresa.update({
      where: { id: empresaId },
      data: { onboardingCompletado: true },
    });

    try {
      await registrarCambioConfiguracion({
        request,
        empresaId,
        campo: "onboardingCompletado",
        valorAnterior: false,
        valorNuevo: true,
        motivo: "Cliente finalizo wizard de onboarding (4 pasos completos).",
      });
    } catch (e) {
      console.warn("[onboarding/finalizar] Audit log fallo:", e);
    }

    return NextResponse.json({
      ok: true,
      message: "Onboarding completado. Bienvenido a Shipro.",
    });
  } catch (error: any) {
    console.error("[/api/onboarding/finalizar] Error:", error);
    return NextResponse.json(
      { error: "Error interno al finalizar el onboarding." },
      { status: 500 }
    );
  }
}
