// ============================================================================
// MEF Fase 1 step 2 (2026-09-14) — Librería de tokens Mercado Libre.
//
// Contrato con la API de ML:
//   POST https://api.mercadolibre.com/oauth/token
//     - grant_type=authorization_code (intercambio inicial post-callback)
//     - grant_type=refresh_token       (rotación cuando access expira)
//   access_token lifetime: 21600s (6h), campo expires_in.
//   refresh_token: SINGLE-USE + ROTA — el response siempre trae NUEVO access
//   AND NUEVO refresh. El viejo refresh queda MUERTO. Perder el nuevo refresh
//   antes de persistirlo = brickea la cuenta (requiere re-autorización).
//
// GARANTÍAS CRÍTICAS (money-adjacent, prevención de brick):
//
//   (a) PERSIST-BEFORE-RETURN: en cada refresh, `prisma.cuentaMercadoLibre.
//       update` con NUEVO access + NUEVO refresh + tokenExpiraEn corre ANTES
//       del `return`. Si el update falla, el throw se propaga — nunca
//       retornamos un access cuyo refresh no se salvó.
//
//   (b) SINGLE-FLIGHT LOCK: dos llamadas concurrentes a
//       `getMercadoLibreAccessToken(empresaId)` con token vencido comparten
//       el MISMO refresh en vuelo (Map keyed por empresaId). El primer caller
//       dispara la request a ML; los demás awaitean. El lock se libera en
//       `finally` (settle exitoso Y fallido), así un refresh fallido no
//       wedgea al empresaId.
//
// TOKEN STORAGE: accessToken + refreshToken están ENCRIPTADOS en la BD via
// `lib/utils/secret-crypto.encryptSecret` (AES-256-GCM). Este archivo es el
// único punto de decrypt/encrypt de esos campos — cualquier consumer llama
// `getMercadoLibreAccessToken(empresaId)` y recibe el plaintext ya
// desencriptado, listo para poner en `Authorization: Bearer <token>`.
//
// invalid_grant: si ML rechaza el refresh (refresh muerto — caso raro pero
// posible si algo lo consumió y el nuestro quedó desincronizado, o si el
// seller revocó la app), seteamos `estado="expirada"` y throweamos con
// mensaje claro. NO hay retry loop — la única salida es que el seller
// re-autorice (Fase 2 lo maneja).
// ============================================================================

import prisma from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/utils/secret-crypto";

const ML_API_BASE = "https://api.mercadolibre.com";
const OAUTH_TOKEN_PATH = "/oauth/token";

// Margen para refrescar antes de que el token expire realmente. 10 min cubre
// clock skew + latencia de red + procesamiento downstream.
const SAFETY_MARGIN_MS = 10 * 60 * 1000;

// ============================================================================
// TIPOS
// ============================================================================

export type MlTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  userId: number;
  scope: string;
};

// ============================================================================
// ENV GUARDS — fail-fast si CLIENT_ID/CLIENT_SECRET no están seteados. Mismo
// patrón que getAppUrlOrThrow (lib/utils/app-url.ts).
// ============================================================================

function getMercadoLibreClientId(): string {
  const v = process.env.MERCADOLIBRE_CLIENT_ID;
  if (!v) {
    throw new Error(
      "MERCADOLIBRE_CLIENT_ID no está configurada. Setearla en .env.local (dev) o en el env del server (prod) antes de operar la integración MEF.",
    );
  }
  return v;
}

function getMercadoLibreClientSecret(): string {
  const v = process.env.MERCADOLIBRE_CLIENT_SECRET;
  if (!v) {
    throw new Error(
      "MERCADOLIBRE_CLIENT_SECRET no está configurada. Setearla en .env.local (dev) o en el env del server (prod) antes de operar la integración MEF.",
    );
  }
  return v;
}

// ============================================================================
// SINGLE-FLIGHT LOCK — mismo patrón que los adapters courier (Intralog L53-90,
// Andreani L63-110), adaptado a multi-tenant con Map keyed por empresaId.
//
// Class-level `tokenPromise` de un adapter cubre un solo tenant (la credencial
// vive en la instancia). Acá el lock debe ser per-empresa: dos empresas
// distintas pueden refrescar en paralelo, pero dos llamadas concurrentes para
// LA MISMA empresa comparten el mismo promise. Map queda en memoria del
// proceso — sirve dentro del mismo Node.js server. Multi-server deploy futuro
// tiene que revisitar (probablemente lock distribuido en Redis o pesimista
// en BD); no aplica hoy (Shipro corre en un solo Node).
// ============================================================================

const inFlightRefreshes = new Map<number, Promise<string>>();

// ============================================================================
// LOW-LEVEL: POST /oauth/token
// ============================================================================

async function postOAuthToken(
  params: Record<string, string>,
): Promise<MlTokenResponse> {
  const body = new URLSearchParams({
    client_id: getMercadoLibreClientId(),
    client_secret: getMercadoLibreClientSecret(),
    ...params,
  });
  const res = await fetch(`${ML_API_BASE}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    // ML devuelve { error, message, status, cause } en errores.
    // Adjuntamos el error code al throw para que el caller pueda distinguir
    // invalid_grant (refresh dead) de otros errores (network, 5xx, etc.).
    const err = new Error(
      `ML oauth/token HTTP ${res.status}: ${data?.error ?? "unknown"}${
        data?.message ? ` — ${data.message}` : ""
      }`,
    );
    (err as any).mlErrorCode = data?.error ?? null;
    (err as any).mlHttpStatus = res.status;
    throw err;
  }
  // Validar shape mínimo — ML se supone que devuelve estos campos, pero
  // defense-in-depth: si algún día cambia el shape, fallamos limpio en vez
  // de persistir undefined.
  if (
    typeof data?.access_token !== "string" ||
    typeof data?.refresh_token !== "string" ||
    typeof data?.expires_in !== "number" ||
    typeof data?.user_id !== "number"
  ) {
    throw new Error(
      `ML oauth/token respondió con shape inesperado (falta access_token/refresh_token/expires_in/user_id).`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    userId: data.user_id,
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

// ============================================================================
// PUBLIC: exchangeCodeForToken — intercambio inicial (post-callback OAuth).
//
// PURE: fetch + parse + return. NO persiste. La persistencia del PRIMER par
// (access + refresh) es responsabilidad del callback OAuth (step 3), porque
// ese es quien también crea/upserea la CuentaMercadoLibre con mlUserId,
// scope, nickname, etc. Este helper solo hace la llamada a ML y devuelve el
// tipado. Idempotente por construcción.
// ============================================================================

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<MlTokenResponse> {
  return postOAuthToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

// ============================================================================
// INTERNAL: doRefresh — corre la rotación + persiste + retorna access.
//
// PERSIST-BEFORE-RETURN: la línea `await prisma.cuentaMercadoLibre.update`
// corre ANTES del `return nuevo.accessToken`. Si el update falla, throw se
// propaga y el caller ve un fallo — nunca ve un access token cuyo refresh
// no se salvó.
//
// invalid_grant: si ML rechaza el refresh, seteamos estado="expirada" (para
// evitar reintentos futuros que van a fallar igual) y throweamos con mensaje
// claro. El seller tiene que re-autorizar la app (nuevo OAuth flow).
// ============================================================================

async function doRefresh(
  empresaId: number,
  refreshTokenCiphertext: string,
): Promise<string> {
  const refreshPlain = decryptSecret(refreshTokenCiphertext);

  let nuevo: MlTokenResponse;
  try {
    nuevo = await postOAuthToken({
      grant_type: "refresh_token",
      refresh_token: refreshPlain,
    });
  } catch (e: any) {
    if (e?.mlErrorCode === "invalid_grant") {
      // Refresh token muerto. Marcamos la cuenta como "expirada" para que
      // futuros llamados fallen rápido con el mismo error de re-autorización,
      // sin re-golpear a ML. Best-effort: si el update falla, throweamos igual
      // el error original de invalid_grant — no bloqueamos el diagnóstico.
      try {
        await prisma.cuentaMercadoLibre.update({
          where: { empresaId },
          data: { estado: "expirada" },
        });
      } catch (updateErr) {
        console.error(
          `[MEF tokens] No pude marcar cuenta ML empresaId=${empresaId} como "expirada":`,
          updateErr,
        );
      }
      throw new Error(
        `Cuenta ML de empresa ${empresaId} tiene el refresh_token muerto (ML: invalid_grant). Requiere re-autorización del seller.`,
      );
    }
    throw e;
  }

  // PERSIST-BEFORE-RETURN — actualiza los 3 campos en UN update atómico.
  // Si esta línea throw, el flujo falla y el caller no recibe un access
  // huérfano cuyo refresh se perdió. Prisma envuelve el update en su propia
  // transacción implícita (single-row); no necesita $transaction explícito.
  await prisma.cuentaMercadoLibre.update({
    where: { empresaId },
    data: {
      accessToken: encryptSecret(nuevo.accessToken),
      refreshToken: encryptSecret(nuevo.refreshToken),
      tokenExpiraEn: new Date(Date.now() + nuevo.expiresIn * 1000),
      // estado queda "activa" — no lo tocamos acá.
    },
  });

  return nuevo.accessToken;
}

// ============================================================================
// PUBLIC: getMercadoLibreAccessToken(empresaId, opts?)
//
// Punto de entrada primario. Devuelve un access_token válido, refrescando
// lazy si hace falta. Idempotente + concurrent-safe.
//
// opts.force: si true, salta el chequeo de cache y fuerza refresh. Usado por
// `mlFetch` cuando recibe 401 (el token cache decía OK pero ML lo rechazó —
// probablemente clock skew o revocación side-band).
// ============================================================================

export async function getMercadoLibreAccessToken(
  empresaId: number,
  opts?: { force?: boolean },
): Promise<string> {
  // 1. Cargar la cuenta ML de la empresa.
  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: {
      accessToken: true,
      refreshToken: true,
      tokenExpiraEn: true,
      estado: true,
    },
  });
  if (!cuenta) {
    throw new Error(
      `No hay cuenta Mercado Libre conectada para empresa ${empresaId}. El seller debe completar el OAuth de instalación.`,
    );
  }
  if (cuenta.estado !== "activa") {
    throw new Error(
      `La cuenta Mercado Libre de empresa ${empresaId} está en estado "${cuenta.estado}" — requiere re-autorización del seller.`,
    );
  }
  if (!cuenta.accessToken || !cuenta.refreshToken || !cuenta.tokenExpiraEn) {
    throw new Error(
      `La cuenta Mercado Libre de empresa ${empresaId} está en estado "activa" pero sin tokens completos (row corrupto/OAuth incompleto). Requiere re-autorización.`,
    );
  }

  // 2. Cache hit — token todavía dentro del margen de seguridad.
  if (!opts?.force) {
    const nowMs = Date.now();
    const expiraMs = cuenta.tokenExpiraEn.getTime();
    if (expiraMs > nowMs + SAFETY_MARGIN_MS) {
      return decryptSecret(cuenta.accessToken);
    }
  }

  // 3. Refresh needed. Single-flight lock: si otro caller ya está refrescando
  // para esta empresa, esperamos su promise (no lanzamos otra request).
  const existing = inFlightRefreshes.get(empresaId);
  if (existing) {
    return existing;
  }

  const promise = doRefresh(empresaId, cuenta.refreshToken);
  inFlightRefreshes.set(empresaId, promise);
  try {
    return await promise;
  } finally {
    // Cleared on settle — SUCCESS AND FAILURE. Un refresh fallido no debe
    // wedgear el lock para futuros callers (que van a re-cargar la cuenta y
    // ver el nuevo estado="expirada" o lo que corresponda).
    inFlightRefreshes.delete(empresaId);
  }
}

// ============================================================================
// TESTING HOOK — reset del Map, solo para tests que necesitan estado limpio.
// No exportado por default: los consumers regulares NO deben tocarlo.
// ============================================================================

export function __resetInFlightRefreshesForTests(): void {
  inFlightRefreshes.clear();
}
