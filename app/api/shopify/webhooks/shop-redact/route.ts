import { NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";
import { redactShopShopify } from "@/lib/shopify/lgpd-redact";

export const runtime = "nodejs";

// Shopify Fase 4 — GDPR shop/redact (48h post-uninstall). redactShopShopify
// (Chat A) purga credenciales + marca estado desinstalada idempotente. Liviano:
// corre INLINE; si falla → 500 → Shopify reintenta (garantiza la purga).
export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(raw, hmac)) {
    console.warn("[/api/shopify/webhooks/shop-redact] HMAC inválido");
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!isValidShopDomain(shop)) {
    console.warn("[/api/shopify/webhooks/shop-redact] shop inválido:", shop);
    return NextResponse.json({ error: "shop inválido" }, { status: 400 });
  }
  try {
    await redactShopShopify({ shopDomain: shop! });
  } catch (e) {
    console.error("[webhook shop/redact] error en redactShopShopify:", {
      shop, err: e instanceof Error ? e.message : String(e).slice(0, 300),
    });
    return NextResponse.json({ error: "error interno" }, { status: 500 });
  }
  return NextResponse.json({ status: "accepted" }, { status: 200 });
}
