import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { enviarMailGenerico } from "@/lib/mailer";
import { generarInstallLinkShopify } from "@/lib/shopify/generar-install-link";
import { GUIA_SHOPIFY_URL } from "@/lib/constants/plugin";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";

// Verbo "enviar link de instalación de Shopify al cliente" — espejo de
// enviar-plugin (WooCommerce), adaptado a Shopify (link OAuth por-tienda +
// mail al gerente del cliente con la documentación). Solo admin_shipro/operador_shipro.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
    }
    const { id } = await params;
    const empresaId = parseInt(id, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }
    const body: any = await request.json().catch(() => null);
    const shopDomain: string | undefined =
      typeof body?.shopDomain === "string" ? body.shopDomain.toLowerCase().trim() : undefined;
    if (!isValidShopDomain(shopDomain)) {
      return NextResponse.json(
        { error: "shopDomain inválido. Formato esperado: '<handle>.myshopify.com'." },
        { status: 400 },
      );
    }
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true, nombre: true, activo: true,
        usuarios: {
          where: { rol: "gerente_cliente", activo: true },
          select: { email: true, nombre: true }, orderBy: { id: "asc" }, take: 1,
        },
      },
    });
    if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    if (!empresa.activo) return NextResponse.json({ error: "Empresa inactiva" }, { status: 409 });
    if (empresa.usuarios.length === 0) {
      return NextResponse.json({ error: "La empresa no tiene un gerente_cliente activo con email para recibir el link." }, { status: 409 });
    }
    const destinatario = empresa.usuarios[0];
    let link;
    try {
      link = await generarInstallLinkShopify(empresaId, shopDomain!);
    } catch (e) {
      console.error("[enviar-link-shopify] generar link falló:", e);
      return NextResponse.json({ error: "No se pudo generar el link de instalación. Revisá la config de Shopify." }, { status: 500 });
    }
    const hayGuia = GUIA_SHOPIFY_URL.trim().length > 0;
    const htmlBody = `
      <h2 style="color: #233b6b;">Conectá tu tienda Shopify con Shipro</h2>
      <p>Hola ${destinatario.nombre || empresa.nombre},</p>
      <p>Para conectar tu tienda de Shopify con Shipro y empezar a cotizar y despachar tus envíos,
         hacé clic en el botón de abajo e instalá la app. El link es válido por 7 días y de un solo uso.</p>
      <p style="margin: 24px 0;">
        <a href="${link.url}" style="background:#233b6b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Instalar Shipro en mi Shopify</a>
      </p>
      ${hayGuia ? `<p>Guía de instalación paso a paso: <a href="${GUIA_SHOPIFY_URL}">${GUIA_SHOPIFY_URL}</a></p>` : `<p style="font-size:12px;color:#666;">La guía de instalación paso a paso te la enviamos por separado.</p>`}
      <p style="font-size:12px;color:#666;">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>${link.url}</p>
      <p style="font-size:12px;color:#666;">Este mail es automático de Shipro.</p>
    `;
    const okMail = await enviarMailGenerico(destinatario.email, "Conectá tu tienda Shopify con Shipro", htmlBody);
    if (!okMail) {
      return NextResponse.json({ error: "El link se generó pero el mail no se pudo enviar. Reintentá en un rato." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, empresaId, enviadoA: destinatario.email, url: link.url, expira: link.expira, incluyeGuia: hayGuia });
  } catch (e) {
    console.error("[/api/admin/empresas/[id]/enviar-link-shopify] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
