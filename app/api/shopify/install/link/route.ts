import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import {
  getShopifyApiKeyOrThrow,
  getShopifyScopesOrThrow,
  getShopifyRedirectUri,
} from "@/lib/utils/shopify-config";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";

// Shopify Fase 1 — Install Link (espejo de /api/tiendanube/install/link).
//
// Endpoint SESSION-AUTHED (NO está en PUBLIC_API_EXACT). El proxy valida el
// JWT antes de que corra este handler. Acá sólo chequeamos rol: admin_shipro /
// operador_shipro. Cliente no puede generar su propio link.
//
// QUÉ HACE:
// 1. Valida empresaId + shopDomain (formato `*.myshopify.com`).
// 2. Genera un token de vinculación aleatorio (192 bits base64url).
// 3. Lo persiste en TokenVinculacionShopify con shopDomain + expira (7d).
// 4. Arma la URL de authorize de Shopify con client_id + scopes + redirect + state.
// 5. Devuelve `{ url, expira }`.
//
// QUÉ NO HACE:
// - No llama a Shopify (solo construye la URL).
// - No mueve plata, no toca núcleo.
// - No devuelve el token suelto (viaja en el `state` dentro de la URL).
export async function POST(request: Request) {
  try {
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
    }

    const body: any = await request.json().catch(() => null);
    const empresaId = Number(body?.empresaId);
    const shopDomain: string | undefined =
      typeof body?.shopDomain === "string" ? body.shopDomain.toLowerCase().trim() : undefined;

    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }
    if (!isValidShopDomain(shopDomain)) {
      return NextResponse.json(
        { error: "shopDomain inválido. Formato esperado: '<handle>.myshopify.com' (lowercase)" },
        { status: 400 },
      );
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, activo: true },
    });
    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }
    if (!empresa.activo) {
      return NextResponse.json({ error: "Empresa inactiva" }, { status: 409 });
    }

    // Fail-fast de la config antes de generar el token (si falta client_id/scopes,
    // no tiene sentido persistir un link que no se puede completar).
    const clientId = getShopifyApiKeyOrThrow();
    const scopes = getShopifyScopesOrThrow();
    const redirectUri = getShopifyRedirectUri();

    // Token de vinculación: 192 bits base64url (32 chars URL-safe). Expira 7 días.
    const token = randomBytes(24).toString("base64url");
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.tokenVinculacionShopify.create({
      data: { empresaId, token, shopDomain: shopDomain!, expira },
    });

    // URL de authorize: todos los dinámicos encodeURIComponent (defensa anti
    // injection — client_id es nuestro, pero scopes/redirect/state son dinámicos).
    const url =
      `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(token)}`;

    // NO devolvemos el token suelto — viaja dentro de la URL en `state`.
    return NextResponse.json({ url, expira }, { status: 200 });
  } catch (e) {
    console.error("[/api/shopify/install/link] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
