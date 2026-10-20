import { NextResponse, after } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";
import { redactCustomerShopify } from "@/lib/shopify/lgpd-redact";

export const runtime = "nodejs";
export const maxDuration = 60;

// Shopify Fase 4 — GDPR customers/redact. HMAC + extraer customer/orders →
// after() → redactCustomerShopify (Chat A). orderGids = gid://shopify/Order/<id>.
export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(raw, hmac)) {
    console.warn("[/api/shopify/webhooks/customers-redact] HMAC inválido");
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!isValidShopDomain(shop)) {
    console.warn("[/api/shopify/webhooks/customers-redact] shop inválido:", shop);
    return NextResponse.json({ error: "shop inválido" }, { status: 400 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const shopDomain = shop!;
  const customer = payload?.customer ?? {};
  const email = customer?.email ? String(customer.email) : null;
  const phone = customer?.phone ? String(customer.phone) : null;
  const orderGids: string[] = Array.isArray(payload?.orders_to_redact)
    ? payload.orders_to_redact.filter((v: unknown) => v != null).map((v: unknown) => `gid://shopify/Order/${String(v)}`)
    : [];

  const respuesta = NextResponse.json({ status: "accepted" }, { status: 200 });
  after(async () => {
    try {
      await redactCustomerShopify({ shopDomain, orderGids, email, phone });
    } catch (e) {
      console.error("[webhook customers/redact] background error:", {
        shopDomain, err: e instanceof Error ? e.message : String(e).slice(0, 300),
      });
    }
  });
  return respuesta;
}
