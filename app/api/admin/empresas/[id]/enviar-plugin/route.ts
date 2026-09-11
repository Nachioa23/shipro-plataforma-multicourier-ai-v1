import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { enviarMailPlugin } from "@/lib/mailer";
import { ZIP_PLUGIN_WOOCOMMERCE_URL, GUIA_PLUGIN_WOOCOMMERCE_URL } from "@/lib/constants/plugin";

// DEUDA 150 Pieza 3 — Verbo "mandar plugin" del hub. Shipro dispara el envío
// del plugin WooCommerce (.zip del release + link de guía) al gerente del
// cliente. Solo admin_shipro/operador_shipro.
//
// Mirror de /api/admin/empresas/[id]/enviar-link-api-key (mismo gate, misma
// forma de resolver destinatario, misma shape de respuesta), pero SIN token —
// no hay estado persistido: el link del .zip es público (release de GitHub)
// y la guía es un link estático. Idempotente: reenviar no genera side effects.
//
// La URL de la guía puede estar vacía (Chat C coordina el hosting del PDF).
// El mail degrada con gracia si es "" — se manda igual con solo el .zip.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Solo equipo Shipro (mismo patrón que enviar-link-api-key).
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
    }

    const { id } = await params;
    const empresaId = parseInt(id, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }

    // Empresa activa + gerente_cliente activo con email (mismo criterio de
    // destinatario que enviar-link-api-key para consistencia UX).
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
        { error: "La empresa no tiene un gerente_cliente activo con email para recibir el plugin." },
        { status: 409 },
      );
    }
    const destinatario = empresa.usuarios[0];

    // Envío del mail. Si falla, 502 y el operador reintenta.
    const okMail = await enviarMailPlugin(
      destinatario.email,
      destinatario.nombre || empresa.nombre,
      ZIP_PLUGIN_WOOCOMMERCE_URL,
      GUIA_PLUGIN_WOOCOMMERCE_URL,
    );
    if (!okMail) {
      return NextResponse.json(
        { error: "El mail no se pudo enviar. Reintentá en un rato." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      empresaId,
      enviadoA: destinatario.email,
      incluyeGuia: GUIA_PLUGIN_WOOCOMMERCE_URL.trim().length > 0,
    });
  } catch (e) {
    console.error("[/api/admin/empresas/[id]/enviar-plugin] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
