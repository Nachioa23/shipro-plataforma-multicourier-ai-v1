import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { getAppUrl } from "@/lib/utils/app-url";
import { enviarMailSetupApiKey } from "@/lib/mailer";

// DEUDA 150 Pieza 2 — Trigger del hub: Shipro dispara el envío del link de setup
// de API Key a un cliente (empresa). Solo admin_shipro/operador_shipro. Genera
// TokenSetupApiKey single-use + envía mail al gerente_cliente. Shipro NUNCA ve
// la key en plaintext — la genera el cliente en la página pública.
//
// Patrón moldeado sobre /api/tiendanube/install/link (mismo shape: gate por rol,
// token random 24 bytes base64url, expira 7 días, single-use por usadoEn).
//
// SIN retornar el token/URL al Shipro admin: el link viaja SOLO por el mail. Si
// el mail falla se reporta como error para que Shipro reintente (no queda un
// token huérfano usable en base sin destino conocido — no, sí queda; es
// aceptable porque el token no es útil sin el link vía mail y expira solo).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Solo equipo Shipro (mismo patrón que /api/tiendanube/install/link + /api/admin/tiendas-tiendanube/reasignar).
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
    }

    const { id } = await params;
    const empresaId = parseInt(id, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }

    // La empresa tiene que existir + estar activa + tener un gerente_cliente con email.
    // Buscamos el gerente_cliente activo — es el rol al que va dirigida la key
    // (el que administra la cuenta y las integraciones). Si hay varios, tomamos
    // el más antiguo (createdAt asc, id asc) — heurística determinística; el caso
    // multi-gerente es raro y admite futura selección explícita.
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        activo: true,
        usuarios: {
          where: { rol: "gerente_cliente", activo: true },
          select: { email: true, nombre: true },
          orderBy: { id: "asc" },
          take: 1,
        },
      },
    });
    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }
    if (!empresa.activo) {
      return NextResponse.json({ error: "Empresa inactiva" }, { status: 409 });
    }
    if (empresa.usuarios.length === 0) {
      return NextResponse.json(
        { error: "La empresa no tiene un gerente_cliente activo con email para recibir el link." },
        { status: 409 }
      );
    }
    const destinatario = empresa.usuarios[0];

    // Base URL fail-fast: sin APP_URL no podemos armar un link válido para el mail.
    const baseUrl = getAppUrl();
    if (!baseUrl) {
      return NextResponse.json(
        { error: "APP_URL no configurada en el servidor. No se puede armar el link." },
        { status: 500 }
      );
    }

    // Token 192-bit base64url + expiración 7 días (mismo patrón que TokenVinculacionTiendanube).
    const token = randomBytes(24).toString("base64url");
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.tokenSetupApiKey.create({
      data: { empresaId, token, expira },
    });

    const url = `${baseUrl}/setup-api-key/${encodeURIComponent(token)}`;

    // Envío del mail. Si falla, devolvemos 500 y el operador reintenta — no
    // borramos el token (expira solo en 7d; queda inutilizable sin el link).
    const okMail = await enviarMailSetupApiKey(destinatario.email, destinatario.nombre || empresa.nombre, url);
    if (!okMail) {
      return NextResponse.json(
        { error: "El mail no se pudo enviar. Reintentá en un rato." },
        { status: 502 }
      );
    }

    // NO devolvemos el token ni la URL al Shipro admin — el link viaja solo por
    // mail. Devolvemos únicamente confirmación + el destino para la UI.
    return NextResponse.json({
      ok: true,
      empresaId,
      enviadoA: destinatario.email,
      expira,
    });
  } catch (e) {
    console.error("[/api/admin/empresas/[id]/enviar-link-api-key] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
