// ============================================================================
// HELPER — Crear install-link OAuth de Mercado Libre (MEF Fase 1, self-service pieza).
//
// Este helper es PURO en el sentido de auth: recibe un `empresaId` ya validado
// por el caller (operator gate o session gate) y hace el core del install-link:
//   1. Env guards fail-fast (MERCADOLIBRE_CLIENT_ID + APP_URL).
//   2. Genera un token de vinculación aleatorio (192 bits base64url).
//   3. Persiste TokenVinculacionMercadoLibre con expiración a 7 días.
//   4. Arma la URL de authorize de ML con los params correctos + scope
//      `offline_access read write` (offline_access habilita el refresh_token).
//   5. Devuelve { url, expira }.
//
// EL CALLER TIENE LA RESPONSABILIDAD DEL AUTH:
// - `/api/mercadolibre/install/link` (operator) valida x-rol admin/operador_shipro
//   + empresaId del body.
// - `/api/empresa/mercadolibre/connect` (session self-service) valida token
//   NextAuth + rol de cliente + empresaId=token.empresaId (NUNCA del body).
//
// Ambos endpoints llaman a este helper con el `empresaId` ya validado. El
// helper no distingue entre operador y self-service — solo hace el core.
// Cero drift entre caminos porque el token + la URL vienen de acá.
// ============================================================================

import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { ML_AUTHORIZE_URL, ML_OAUTH_CALLBACK_PATH } from "@/lib/mercadolibre/tokens";

export type InstallLinkResult = { url: string; expira: Date };

/**
 * Crea un install-link OAuth de Mercado Libre para la empresa dada.
 *
 * @param empresaId - ID de empresa YA VALIDADO por el caller (existencia +
 *                    activo + autorización). Este helper confía en el input.
 * @returns { url, expira } — url de authorize de ML lista para redirect del
 *          browser + timestamp de expiración del token de vinculación.
 * @throws Error si MERCADOLIBRE_CLIENT_ID o APP_URL no están configuradas
 *         (fail-fast — deploy roto, no error de runtime silencioso).
 */
export async function crearInstallLinkMercadoLibre(
  empresaId: number,
): Promise<InstallLinkResult> {
  // 1. Env guard fail-fast: sin CLIENT_ID no se puede armar una URL válida.
  const clientId = process.env.MERCADOLIBRE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "MERCADOLIBRE_CLIENT_ID no configurada en el servidor. Setearla antes de generar el link.",
    );
  }

  // 2. APP_URL fail-fast: sin ella el redirect_uri queda inválido y el consent
  // se rompe (redirect_uri mismatch en el portal ML).
  const appUrl = getAppUrlOrThrow();

  // 3. Token de vinculación: 192 bits base64url (32 chars URL-safe). Expira
  // en 7 días — mismo default que el twin Tiendanube (diseño DEUDA 144).
  const token = randomBytes(24).toString("base64url");
  const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.tokenVinculacionMercadoLibre.create({
    data: { empresaId, token, expira },
  });

  // 4. Redirect URI: byte-idéntico entre install-link y callback. ML matchea
  // el redirect_uri del authorize con el redirect_uri del intercambio del code
  // como control de seguridad — cualquier diferencia rompe el flow.
  const redirectUri = `${appUrl}${ML_OAUTH_CALLBACK_PATH}`;

  // 5. Armar la URL de authorize. URLSearchParams garantiza URL-encoding
  // correcto (espacios en scope, caracteres especiales en redirect_uri, etc).
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: token,
    scope: "offline_access read write",
  });
  const url = `${ML_AUTHORIZE_URL}?${params.toString()}`;

  return { url, expira };
}
