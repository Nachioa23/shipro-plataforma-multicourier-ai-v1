// ============================================================================
// Shopify tokens (2026-10-21) — biblioteca de tokens OAuth para apps PÚBLICAS.
//
// La app pasó de CUSTOM (token offline permanente) a PÚBLICA ("Shipro Flow
// Clientes"); Shopify dejó de aceptar tokens offline no-expirantes en el Admin
// API para apps públicas nuevas (confirmado 403 "Non-expiring access tokens are
// no longer accepted" en prod + doc oficial). Mode: tokens offline EXPIRANTES
// (~1h) + refresh token (~90d).
//
// MOLDE: lib/mercadolibre/tokens.ts — mismo contrato: single-flight lock keyed,
// SAFETY_MARGIN, persist-before-return, invalid_grant → estado + throw.
// Adaptado al shape de Shopify (shopDomain string en vez de empresaId int;
// expiring=1 en el exchange; refresh error = 401 invalid_request).
//
// Contrato Shopify (verificado contra doc oficial):
//   POST https://{shop}/admin/oauth/access_token (Content-Type application/
//   x-www-form-urlencoded):
//     - code + expiring=1 → exchange inicial.
//     - grant_type=refresh_token + refresh_token → refresh.
//   Respuesta: { access_token, refresh_token, expires_in,
//                refresh_token_expires_in, scope }.
//   Refresh muerto: HTTP 401 { "error": "invalid_request" } → reinstalación.
//
// GARANTÍAS CRÍTICAS (money-adjacent, prevención de brick):
//   (a) PERSIST-BEFORE-RETURN: el update de TiendaShopify con el nuevo par
//       (access + refresh + expiras) corre ANTES del return. Si falla, throw.
//   (b) SINGLE-FLIGHT LOCK: dos llamadas concurrentes a
//       getShopifyAccessToken(shopDomain) con token vencido comparten el MISMO
//       refresh en vuelo (Map keyed por shopDomain). Lock se libera en finally
//       (settle exitoso Y fallido).
//   (c) ESTADO: la tienda debe estar "instalada". Cualquier otro estado →
//       throw pidiendo reinstalación (no re-golpear Shopify).
//
// TOKEN STORAGE: accessToken + refreshToken van ENCRIPTADOS (AES-256-GCM, mismo
// módulo lib/utils/secret-crypto). Este archivo es el ÚNICO punto de
// decrypt/encrypt — consumers llaman getShopifyAccessToken y reciben plaintext.
// ============================================================================

import prisma from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/utils/secret-crypto";
import {
  getShopifyApiKeyOrThrow,
  getShopifyApiSecretOrThrow,
} from "@/lib/utils/shopify-config";

// 10 min cubre clock skew + latencia de red + procesamiento downstream.
const SAFETY_MARGIN_MS = 10 * 60 * 1000;

// ============================================================================
// TIPOS
// ============================================================================

export interface ShopifyTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds (típicamente 3600)
  refreshTokenExpiresIn: number; // seconds (típicamente ~90d)
  scope: string;
}

export interface ExchangeShopifyResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn: number;
  scope: string;
}

// ============================================================================
// SINGLE-FLIGHT LOCK — mismo patrón que MEF, keyed por shopDomain (multi-tenant).
// Map en memoria del proceso Node; multi-server futuro requiere lock
// distribuido o pesimista en BD. No aplica hoy (un solo Node).
// ============================================================================

const inFlightRefreshes = new Map<string, Promise<string>>();

// ============================================================================
// LOW-LEVEL: POST /admin/oauth/access_token
// ============================================================================

async function postShopifyOAuthToken(
  shop: string,
  params: Record<string, string>,
): Promise<ShopifyTokenResponse> {
  const body = new URLSearchParams({
    client_id: getShopifyApiKeyOrThrow(),
    client_secret: getShopifyApiSecretOrThrow(),
    ...params,
  });
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Shopify devuelve { error, error_description } en errores. Adjuntamos
    // el error code al throw para que el caller distinga invalid_request
    // (refresh dead) de otros errores (network, 5xx, etc.).
    const err = new Error(
      `Shopify oauth/access_token HTTP ${res.status}: ${data?.error ?? "unknown"}${
        data?.error_description ? ` — ${data.error_description}` : ""
      }`,
    );
    (err as any).shopifyErrorCode = data?.error ?? null;
    (err as any).shopifyHttpStatus = res.status;
    throw err;
  }
  // Defense-in-depth: validamos shape mínimo antes de persistir.
  if (
    typeof data?.access_token !== "string" ||
    typeof data?.refresh_token !== "string" ||
    typeof data?.expires_in !== "number" ||
    typeof data?.refresh_token_expires_in !== "number"
  ) {
    throw new Error(
      "Shopify oauth/access_token respondió con shape inesperado (falta access_token/refresh_token/expires_in/refresh_token_expires_in — ¿la app está marcada como 'expiring'? ¿se pasó expiring=1 en el exchange?).",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshTokenExpiresIn: data.refresh_token_expires_in,
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

// ============================================================================
// PUBLIC: exchangeCodeForTokenShopify — intercambio inicial (post-callback OAuth).
//
// PURE: fetch + parse + return. NO persiste. La persistencia del PRIMER par
// (access + refresh + expiras) es responsabilidad del callback OAuth (igual
// que en ML), porque ese es quien también crea/upserea la TiendaShopify con
// shopDomain, nombre, dominio, carrierServiceId, etc.
//
// expiring=1: pedido explícito a Shopify de devolver tokens EXPIRANTES
// (contrato de apps públicas nuevas; sin este flag Shopify podría intentar
// devolver un offline permanente que ya no acepta).
// ============================================================================

export async function exchangeCodeForTokenShopify(
  shop: string,
  code: string,
): Promise<ExchangeShopifyResult> {
  const res = await postShopifyOAuthToken(shop, {
    code,
    expiring: "1",
  });
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresIn: res.expiresIn,
    refreshTokenExpiresIn: res.refreshTokenExpiresIn,
    scope: res.scope,
  };
}

// ============================================================================
// INTERNAL: doRefresh — corre la rotación + persiste + retorna access.
//
// PERSIST-BEFORE-RETURN: update de TiendaShopify con el nuevo par corre ANTES
// del return. Si falla, throw se propaga.
//
// invalid_request (401): Shopify indica refresh muerto. Marcamos estado=
// "token_expirado" (best-effort) + throw pidiendo reinstalación. NO retry.
// ============================================================================

async function doRefresh(
  shop: string,
  refreshTokenCiphertext: string,
): Promise<string> {
  const refreshPlain = decryptSecret(refreshTokenCiphertext);

  let nuevo: ShopifyTokenResponse;
  try {
    nuevo = await postShopifyOAuthToken(shop, {
      grant_type: "refresh_token",
      refresh_token: refreshPlain,
    });
  } catch (e: any) {
    // Shopify 401 con invalid_request = refresh muerto. Marcamos para evitar
    // reintentos futuros y para que la UI/alertas vean el estado.
    const esRefreshMuerto =
      e?.shopifyHttpStatus === 401 && e?.shopifyErrorCode === "invalid_request";
    if (esRefreshMuerto) {
      try {
        await prisma.tiendaShopify.update({
          where: { shopDomain: shop },
          data: { estado: "token_expirado" },
        });
      } catch (updateErr) {
        console.error(
          `[shopify tokens] No pude marcar TiendaShopify shop=${shop} como "token_expirado":`,
          updateErr,
        );
      }
      throw new Error(
        `Tienda Shopify ${shop} tiene el refresh_token muerto (Shopify: 401 invalid_request). Requiere reinstalación de la app.`,
      );
    }
    throw e;
  }

  // PERSIST-BEFORE-RETURN — 1 update atómico con los 4 campos.
  await prisma.tiendaShopify.update({
    where: { shopDomain: shop },
    data: {
      accessToken: encryptSecret(nuevo.accessToken),
      refreshToken: encryptSecret(nuevo.refreshToken),
      accessTokenExpira: new Date(Date.now() + nuevo.expiresIn * 1000),
      refreshTokenExpira: new Date(Date.now() + nuevo.refreshTokenExpiresIn * 1000),
      // estado queda "instalada" — no lo tocamos acá.
    },
  });

  return nuevo.accessToken;
}

// ============================================================================
// PUBLIC: getShopifyAccessToken(shopDomain, opts?)
//
// Punto de entrada primario. Devuelve un access_token válido, refrescando
// lazy si hace falta. Idempotente + concurrent-safe.
//
// opts.force: salta el chequeo de cache y fuerza refresh. Usado si una
// llamada a Shopify devolvió 401 side-band y queremos un token fresco.
// ============================================================================

export async function getShopifyAccessToken(
  shopDomain: string,
  opts?: { force?: boolean },
): Promise<string> {
  // 1. Cargar la tienda.
  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain },
    select: {
      accessToken: true,
      refreshToken: true,
      accessTokenExpira: true,
      estado: true,
    },
  });
  if (!tienda) {
    throw new Error(
      `No hay TiendaShopify registrada con shopDomain=${shopDomain}. El merchant debe completar el OAuth de instalación.`,
    );
  }
  if (tienda.estado !== "instalada") {
    throw new Error(
      `TiendaShopify shop=${shopDomain} está en estado "${tienda.estado}" — requiere reinstalación de la app.`,
    );
  }
  if (!tienda.accessToken) {
    throw new Error(
      `TiendaShopify shop=${shopDomain} sin accessToken persistido (OAuth incompleto). Requiere reinstalación.`,
    );
  }

  // 2. Instalación custom legacy (sin accessTokenExpira ⇒ token permanente).
  // En apps nuevas (públicas) Shopify ya no permite esto; pero mantenemos la
  // compat para tiendas custom pre-2025 que todavía usen el token permanente.
  if (!tienda.accessTokenExpira) {
    return decryptSecret(tienda.accessToken);
  }

  // 3. Cache hit — token todavía dentro del margen de seguridad.
  if (!opts?.force) {
    const nowMs = Date.now();
    const expiraMs = tienda.accessTokenExpira.getTime();
    if (expiraMs > nowMs + SAFETY_MARGIN_MS) {
      return decryptSecret(tienda.accessToken);
    }
  }

  // 4. Refresh needed. Validamos refreshToken persistido.
  if (!tienda.refreshToken) {
    throw new Error(
      `TiendaShopify shop=${shopDomain} tiene accessToken expirado pero NO refreshToken persistido. Requiere reinstalación.`,
    );
  }

  // 5. Single-flight lock keyed por shopDomain.
  const existing = inFlightRefreshes.get(shopDomain);
  if (existing) {
    return existing;
  }

  const promise = doRefresh(shopDomain, tienda.refreshToken);
  inFlightRefreshes.set(shopDomain, promise);
  try {
    return await promise;
  } finally {
    // Settle (éxito y error) — no wedgear el lock para futuros callers.
    inFlightRefreshes.delete(shopDomain);
  }
}

// ============================================================================
// TESTING HOOK — reset del Map (igual que ML).
// ============================================================================

export function __resetInFlightRefreshesForTests(): void {
  inFlightRefreshes.clear();
}
