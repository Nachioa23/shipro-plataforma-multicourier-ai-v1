import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import {
  getShopifyApiKeyOrThrow,
  getShopifyScopesOrThrow,
  getShopifyRedirectUri,
} from "@/lib/utils/shopify-config";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";

export interface GenerarInstallLinkResult {
  url: string;
  expira: Date;
}

// Helper reutilizable: genera el link OAuth de Shopify (crea TokenVinculacionShopify
// que bindea shopDomain↔empresa + arma la URL de authorize). NO valida rol ni
// empresa (lo hace el caller); SÍ valida formato del shopDomain (anti-SSRF).
export async function generarInstallLinkShopify(
  empresaId: number,
  shopDomain: string,
): Promise<GenerarInstallLinkResult> {
  if (!isValidShopDomain(shopDomain)) {
    throw new Error("shopDomain inválido (formato esperado: '<handle>.myshopify.com')");
  }
  const clientId = getShopifyApiKeyOrThrow();
  const scopes = getShopifyScopesOrThrow();
  const redirectUri = getShopifyRedirectUri();
  const token = randomBytes(24).toString("base64url");
  const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.tokenVinculacionShopify.create({
    data: { empresaId, token, shopDomain, expira },
  });
  const url =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(token)}`;
  return { url, expira };
}
