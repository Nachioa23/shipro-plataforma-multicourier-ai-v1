// ============================================================================
// /api/auth/reset-password — DEUDA 96 Pieza 1 (2026-10-08)
//
// GET  ?token=X  → valida token (unused + not expired + usuario activo).
//                  Si válido: { ok: true, emailMasked: "j***@dominio.com" }
//                  para la UI del reset page. Si no: 404 genérico.
// POST { token, passwordNueva } → valida + consume atómico + bcrypt hash +
//      update password + audit (closes DEUDA 69) → 200.
//
// SEGURIDAD:
//   - 404 genérico para toda falla de token (no revela existencia/expiración/
//     usuario inactivo).
//   - passwordNueva.length >= 8 (mismo gate que cambiar-password del wizard).
//   - Consumo atómico: $transaction + updateMany(where usadoEn=null → now).
//     Race condition: si count=0, otra request ya consumió → throw TOKEN_YA_USADO.
//   - Audit: AuditoriaConfiguracion(campo="password_reset", valorAnterior/Nuevo
//     redacted). Cierra DEUDA 69 (audit de cambio de password).
//     Shipro users (empresaId=null): la tabla NO tolera null → se skipea audit
//     para esos y se loguea. Flag follow-up: hacer empresaId nullable en
//     AuditoriaConfiguracion si Nacho quiere audit completo para Shipro admins.
//   - Session invalidation post-reset: PIEZA 2 (lib/auth.ts + passwordChangedAt).
//     Mientras tanto, sesión vieja sobrevive hasta su maxAge de 8h (riesgo
//     aceptado y documentado en el diseño).
// ============================================================================

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

const RESPUESTA_INVALIDO = NextResponse.json(
  { error: "Link inválido o expirado" },
  { status: 404 },
);

// Enmascarador de email para la UI del reset page: "jnacho@shipro.pro" → "j***@shipro.pro".
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const localPart = email.slice(0, at);
  const domain = email.slice(at);
  const first = localPart.charAt(0);
  return `${first}***${domain}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = (searchParams.get("token") || "").trim();
  if (!token) return RESPUESTA_INVALIDO;

  const registro = await prisma.tokenResetPassword.findFirst({
    where: {
      token,
      expira: { gt: new Date() },
      usadoEn: null,
    },
    select: {
      id: true,
      usuario: { select: { email: true, activo: true } },
    },
  });

  if (!registro || !registro.usuario.activo) {
    return RESPUESTA_INVALIDO;
  }

  return NextResponse.json({
    ok: true,
    emailMasked: maskEmail(registro.usuario.email),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const passwordNueva = typeof body?.passwordNueva === "string" ? body.passwordNueva : "";

    if (!token) return RESPUESTA_INVALIDO;

    // Gate de longitud (mismo que /api/onboarding/cambiar-password).
    if (passwordNueva.length < 8) {
      return NextResponse.json(
        { error: "La nueva clave debe tener al menos 8 caracteres." },
        { status: 400 },
      );
    }

    const registro = await prisma.tokenResetPassword.findFirst({
      where: {
        token,
        expira: { gt: new Date() },
        usadoEn: null,
      },
      select: {
        id: true,
        usuario: {
          select: { id: true, email: true, activo: true, empresaId: true },
        },
      },
    });

    if (!registro || !registro.usuario.activo) {
      return RESPUESTA_INVALIDO;
    }

    const usuario = registro.usuario;
    const ipOrigen =
      request.headers.get("x-ip-origen") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;

    const passwordNuevaHasheado = await bcrypt.hash(passwordNueva, 10);
    const now = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        // Consumo atómico del token. Race condition guard: si otra request lo
        // marcó entre nuestro findFirst y el update, count=0 → throw.
        const consumido = await tx.tokenResetPassword.updateMany({
          where: { id: registro.id, usadoEn: null },
          data: { usadoEn: now },
        });
        if (consumido.count === 0) {
          throw new Error("TOKEN_YA_USADO");
        }

        // Update password + liberar passwordTemporal (si venía del wizard).
        await tx.usuario.update({
          where: { id: usuario.id },
          data: {
            password: passwordNuevaHasheado,
            passwordTemporal: false,
          },
        });

        // Audit (cierra DEUDA 69). Solo si usuario tiene empresaId (la tabla
        // AuditoriaConfiguracion requiere empresaId NOT NULL — users shipro
        // con empresaId=null quedan sin audit por limitación de schema; log
        // console.warn como fallback. Follow-up para hacer empresaId nullable.
        if (usuario.empresaId !== null) {
          await tx.auditoriaConfiguracion.create({
            data: {
              empresaId: usuario.empresaId,
              usuarioEmail: usuario.email,
              rolUsuario: null,
              ipOrigen,
              campo: "password_reset",
              valorAnterior: "[REDACTED]",
              valorNuevo: "[REDACTED]",
              motivo: "Reseteo via link token (DEUDA 96 Pieza 1)",
            },
          });
        } else {
          console.warn(
            "[reset-password] usuario shipro (empresaId=null) sin audit — follow-up: hacer empresaId nullable en AuditoriaConfiguracion",
            { usuarioEmail: usuario.email },
          );
        }
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "TOKEN_YA_USADO") {
        return RESPUESTA_INVALIDO;
      }
      throw txErr;
    }

    return NextResponse.json({
      ok: true,
      mensaje: "Contraseña actualizada. Ya podés iniciar sesión.",
    });
  } catch (error) {
    console.error("[reset-password] error inesperado:", error);
    return NextResponse.json(
      { error: "Error interno. Reintentá en un minuto." },
      { status: 500 },
    );
  }
}
