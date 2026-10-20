import { NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";
import { dataReportShopify } from "@/lib/shopify/lgpd-data-report";
import { enviarMailGenerico } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 60;

// Shopify Fase 4 — GDPR customers/data_request. READ-ONLY. La lib devuelve el
// reporte; este endpoint lo manda por mail al merchant (cascade gerente →
// operador), con idempotencia por data_request.id + audit. Espejo del TN.
export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(raw, hmac)) {
    console.warn("[/api/shopify/webhooks/customers-data-request] HMAC inválido");
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!isValidShopDomain(shop)) {
    console.warn("[/api/shopify/webhooks/customers-data-request] shop inválido:", shop);
    return NextResponse.json({ error: "shop inválido" }, { status: 400 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const shopDomain = shop!;
  const customer = payload?.customer ?? {};
  const email = customer?.email ? String(customer.email) : null;
  const phone = customer?.phone ? String(customer.phone) : null;
  const orderGids: string[] = Array.isArray(payload?.orders_requested)
    ? payload.orders_requested.filter((v: unknown) => v != null).map((v: unknown) => `gid://shopify/Order/${String(v)}`)
    : [];
  const dataRequestId = payload?.data_request?.id != null ? String(payload.data_request.id) : "";

  const respuesta = NextResponse.json({ status: "accepted" }, { status: 200 });
  after(async () => {
    try {
      if (dataRequestId) {
        const audit = await prisma.auditoriaConfiguracion.findFirst({
          where: { campo: "shopify:gdpr_data_request", motivo: { contains: `data_request_id=${dataRequestId}` } },
          select: { id: true },
        });
        if (audit) {
          console.log("[gdpr customers/data_request] retry — skip:", { shopDomain, dataRequestId });
          return;
        }
      }
      const reporte = await dataReportShopify({ shopDomain, orderGids, email, phone });
      if (reporte.empresaId === null) {
        console.warn("[gdpr customers/data_request] store desconocida — skip:", { shopDomain, dataRequestId });
        return;
      }
      const gerentes = await prisma.usuario.findMany({
        where: { empresaId: reporte.empresaId, activo: true, rol: "gerente_cliente" }, select: { email: true },
      });
      let contactos = gerentes.map((u) => u.email);
      if (contactos.length === 0) {
        const operadores = await prisma.usuario.findMany({
          where: { empresaId: reporte.empresaId, activo: true, rol: "operador_cliente" }, select: { email: true },
        });
        contactos = operadores.map((u) => u.email);
      }
      if (contactos.length === 0) {
        await prisma.auditoriaConfiguracion.create({
          data: {
            empresaId: reporte.empresaId, campo: "shopify:gdpr_data_request",
            valorAnterior: `${reporte.enviosCount} envíos matched`,
            valorNuevo: "sin contactos activos (gerente_cliente/operador_cliente) — reporte NO enviado",
            motivo: `GDPR customers/data_request de Shopify (shopDomain=${shopDomain}, data_request_id=${dataRequestId})`,
          },
        }).catch((auditErr) => console.error("[gdpr customers/data_request] audit no persistió (sin contactos):", { shopDomain, err: String(auditErr).slice(0, 300) }));
        return;
      }
      const htmlBody = `
        <h2 style="color: #233b6b;">Pedido de datos personales (GDPR)</h2>
        <p>Recibiste un pedido de acceso a datos personales de un comprador (vía Shopify / ley de datos).</p>
        <p>Adjuntamos un Excel con toda la información que Shipro tiene de ese comprador: sus datos de
           contacto y el detalle de sus envíos con historial de seguimiento. Reenvialo al comprador para
           responder su solicitud.</p>
        <p><strong>Envíos incluidos:</strong> ${reporte.enviosCount}</p>
        <p style="font-size: 12px; color: #666;">Este mail es automático de Shipro. La legislación te da un plazo
           para responder al comprador; consultá con tu asesor legal si tenés dudas sobre el proceso.</p>
      `;
      const enviado = await enviarMailGenerico(contactos, "Pedido de datos personales (GDPR) — Shopify", htmlBody, {
        attachments: [{ filename: "reporte-datos-comprador.xlsx", content: reporte.excelBuffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
      });
      await prisma.auditoriaConfiguracion.create({
        data: {
          empresaId: reporte.empresaId, campo: "shopify:gdpr_data_request",
          valorAnterior: `${reporte.enviosCount} envíos reportados`,
          valorNuevo: enviado ? `Reporte Excel enviado a ${contactos.length} contacto(s)` : `Reporte generado pero envío de mail FALLÓ (revisar logs mailer)`,
          motivo: `GDPR customers/data_request de Shopify (shopDomain=${shopDomain}, data_request_id=${dataRequestId})`,
        },
      }).catch((auditErr) => console.error("[gdpr customers/data_request] audit no persistió (post-send):", { shopDomain, err: String(auditErr).slice(0, 300) }));
      console.log("[gdpr customers/data_request] reporte procesado:", { shopDomain, empresaId: reporte.empresaId, dataRequestId, envios: reporte.enviosCount, contactos: contactos.length, mailEnviado: enviado });
    } catch (e) {
      console.error("[webhook customers/data_request] background error:", { shopDomain, err: e instanceof Error ? e.message : String(e).slice(0, 300) });
    }
  });
  return respuesta;
}
