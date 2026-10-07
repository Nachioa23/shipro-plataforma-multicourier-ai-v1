// ============================================================================
// POST /api/auth/forgot-password — DEUDA 96 Pieza 1 (2026-10-08)
//
// Flujo:
//   1. Body { email }. Normaliza email.toLowerCase().trim().
//   2. Rate-limit DB (decisión Nacho: robusto, no in-memory):
//        - 1 request / email / 60s.
//        - 10 requests / IP / 5min.
//      Siempre registra la fila IntentoResetPassword primero. Si cualquier
//      límite se excede, responde genérico 200 (no revela).
//   3. Lookup Usuario por email (lowercased). Si existe + activo: genera token
//      192-bit base64url + expira now+2h → prisma.tokenResetPassword.create →
//      enviarMailReseteoPassword.
//   4. Si no existe o está inactivo: fake delay ~200ms para blunt timing.
//   5. SIEMPRE responde 200 genérico — anti-enumeration.
//
// SEGURIDAD:
//   - Endpoint cae bajo PUBLIC_API_PREFIXES = /api/auth/ (proxy.ts:7) → sin
//     sesión. Es correcto: el usuario olvidó la clave, no puede loguearse.
//   - Mensaje genérico siempre: nunca revela si un email existe en Shipro.
//   - Rate-limit en BD (sobrevive restarts, cross-process safe).
//   - Token entropy: 192-bit (randomBytes(24).base64url = 32 chars URL-safe).
// ============================================================================

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { enviarMailReseteoPassword } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";

// Rate-limit windows (decisión Nacho 2026-10-08).
const EMAIL_WINDOW_MS = 60 * 1000;          // 1 request / email / 60s
const EMAIL_MAX = 1;
const IP_WINDOW_MS = 5 * 60 * 1000;         // 10 requests / IP / 5min
const IP_MAX = 10;

// Token TTL (decisión Nacho 2026-10-08): 2h (corto, sensible).
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

// Fake delay para branch "no user" — mitiga timing attack cheap.
const FAKE_DELAY_MS = 200;

// Respuesta genérica. SIEMPRE 200. Sin importar branch.
const RESPUESTA_GENERICA = {
  ok: true,
  mensaje: "Si el email está registrado, te enviamos un link para restablecer tu contraseña.",
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const emailInput = typeof body?.email === "string" ? body.email : "";
    const email = emailInput.toLowerCase().trim();

    // Guard mínimo: si no mandó email, responde genérico igual (no revela que
    // el shape está mal).
    if (!email || email.length > 320) {
      return NextResponse.json(RESPUESTA_GENERICA);
    }

    // IP de origen: proxy inyecta x-ip-origen cuando puede; fallback a los
    // forwarded headers. Null si nada.
    const ipOrigen =
      request.headers.get("x-ip-origen") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;

    // Registra el intento SIEMPRE (fuente de verdad del rate-limit).
    await prisma.intentoResetPassword
      .create({ data: { email, ip: ipOrigen } })
      .catch((err) => {
        // Si falla el log del intento, no romper el flujo. Loguear + seguir.
        console.error("[forgot-password] no se pudo registrar intento:", err);
      });

    // Rate-limit por email (1/60s).
    const desdeEmail = new Date(Date.now() - EMAIL_WINDOW_MS);
    const nEmail = await prisma.intentoResetPassword.count({
      where: { email, createdAt: { gte: desdeEmail } },
    });
    if (nEmail > EMAIL_MAX) {
      console.warn("[forgot-password] rate-limit por email:", { email, nEmail });
      return NextResponse.json(RESPUESTA_GENERICA);
    }

    // Rate-limit por IP (10/5min) — solo si tenemos IP.
    if (ipOrigen) {
      const desdeIp = new Date(Date.now() - IP_WINDOW_MS);
      const nIp = await prisma.intentoResetPassword.count({
        where: { ip: ipOrigen, createdAt: { gte: desdeIp } },
      });
      if (nIp > IP_MAX) {
        console.warn("[forgot-password] rate-limit por IP:", { ip: ipOrigen, nIp });
        return NextResponse.json(RESPUESTA_GENERICA);
      }
    }

    // Lookup usuario por email lowercase. Nota: Postgres es case-sensitive por
    // defecto; dependemos de que los writers (clientes/route.ts, mi-equipo/
    // route.ts) guarden email en lowercase. Si no, se agregará lookup case-
    // insensitive en un follow-up (bug latente separado, no Pieza 1).
    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, email: true, nombre: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      // Fake delay — iguala groseramente el tiempo del branch "existe".
      await new Promise((r) => setTimeout(r, FAKE_DELAY_MS));
      return NextResponse.json(RESPUESTA_GENERICA);
    }

    // Generar token 192-bit base64url + expira now+2h + persistir + mail.
    const token = randomBytes(24).toString("base64url");
    const expira = new Date(Date.now() + TOKEN_TTL_MS);
    await prisma.tokenResetPassword.create({
      data: { usuarioId: usuario.id, token, expira, ipOrigen },
    });

    const baseUrl = getAppUrl();
    if (!baseUrl) {
      // Sin APP_URL no podemos armar un link. Logeamos para investigación +
      // devolvemos genérico (no filtra la condición).
      console.error("[forgot-password] APP_URL no configurado — no se envía mail");
      return NextResponse.json(RESPUESTA_GENERICA);
    }
    const urlReset = `${baseUrl}/reset-password/${encodeURIComponent(token)}`;

    // Envío de mail. Si falla, logeamos pero no revelamos — igual devolvemos
    // genérico (el link no sirve si el mail no llega, pero el usuario puede
    // reintentar tras el cooldown de 60s).
    const okMail = await enviarMailReseteoPassword(usuario.email, usuario.nombre || usuario.email, urlReset);
    if (!okMail) {
      console.error("[forgot-password] falló envío de mail:", { email: usuario.email });
    }

    return NextResponse.json(RESPUESTA_GENERICA);
  } catch (error) {
    console.error("[forgot-password] error inesperado:", error);
    // Incluso en error inesperado, respondemos genérico. No revelamos.
    return NextResponse.json(RESPUESTA_GENERICA);
  }
}
