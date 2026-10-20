import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";

export const runtime = "nodejs";

// Shopify Fase 4 — Webhook app/uninstalled. Marca la tienda desinstalada
// (estado + timestamp). Con estado != "instalada", orders/paid ya hace no-op.
// NO borra tienda ni envíos (eso es shop/redact, 48h después). Idempotente.
export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(raw, hmac)) {
    console.warn("[/api/shopify/webhooks/app-uninstalled] HMAC inválido");
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!isValidShopDomain(shop)) {
    console.warn("[/api/shopify/webhooks/app-uninstalled] shop inválido:", shop);
    return NextResponse.json({ error: "shop inválido" }, { status: 400 });
  }
  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain: shop! },
    select: { id: true, estado: true },
  });
  if (!tienda) {
    console.warn("[/api/shopify/webhooks/app-uninstalled] store desconocida, no-op:", shop);
    return NextResponse.json({ status: "accepted" }, { status: 200 });
  }
  await prisma.tiendaShopify.update({
    where: { shopDomain: shop! },
    data: { estado: "desinstalada", desinstaladaEn: new Date() },
  });
  console.log("[/api/shopify/webhooks/app-uninstalled] tienda marcada desinstalada:", {
    shop, tiendaId: tienda.id,
  });
  return NextResponse.json({ status: "accepted" }, { status: 200 });
}
