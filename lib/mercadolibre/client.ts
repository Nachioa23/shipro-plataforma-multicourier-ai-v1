// ============================================================================
// MEF Fase 1 step 2 (2026-09-14) — Cliente HTTP para la API de Mercado Libre.
//
// mlFetch(empresaId, path, init?) es el punto de entrada primario para hablarle
// a la API de ML autenticado como una empresa Shipro determinada. Trae el
// access_token vigente (o lo refresca lazy) via `getMercadoLibreAccessToken`,
// arma el header `Authorization: Bearer …`, y hace la llamada.
//
// Recuperación 401 (revocación side-band o clock skew): si ML rechaza con 401
// pese a que el token estaba dentro del cache-margin, forzamos UN refresh
// (opts.force=true → salta el chequeo de tiempo) y reintentamos UNA vez. Si el
// segundo intento también da 401, propagamos — probablemente la cuenta está
// revocada real y el problema no es token stale (get* ya habría marcado
// "expirada" en ese caso via invalid_grant).
//
// SIN LOOP DE REINTENTOS más allá del retry-1: fallar rápido, no ocultar
// problemas. El caller (Chat D's worker de Fase 3) decide política de retry
// a nivel más alto (backoff, DLQ, etc.) si aplica.
// ============================================================================

import { getMercadoLibreAccessToken } from "@/lib/mercadolibre/tokens";

const ML_API_BASE = "https://api.mercadolibre.com";

/**
 * Fetch autenticado contra la API de Mercado Libre para una empresa Shipro.
 *
 * @param empresaId - Shipro empresa id (la cuenta ML se resuelve via
 *   CuentaMercadoLibre.empresaId, unique 1—1).
 * @param path - Path relativo (ej. "/users/me", "/shipments/12345"). Debe
 *   arrancar con "/".
 * @param init - Overrides de RequestInit (method, body, headers extra). El
 *   Authorization header se setea acá — no lo mandes.
 * @returns Response de fetch — el caller decide qué hacer con status/body.
 */
export async function mlFetch(
  empresaId: number,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${ML_API_BASE}${path}`;

  const doFetch = async (token: string): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    // ML espera JSON por default en la mayoría de sus endpoints. Si el caller
    // quiere otro Content-Type (ej. form-urlencoded), lo setea en init.headers
    // — al usar Headers acá abajo respetamos su valor.
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    return fetch(url, { ...init, headers });
  };

  // 1er intento con el token del cache (o refrescado lazy por expiración).
  let token = await getMercadoLibreAccessToken(empresaId);
  let res = await doFetch(token);

  // 401: token rechazado por ML aunque el cache lo daba por vivo. Forzamos
  // un refresh y reintentamos UNA vez. Si el nuevo access también rebota,
  // dejamos que el caller vea el 401 del segundo intento.
  if (res.status === 401) {
    token = await getMercadoLibreAccessToken(empresaId, { force: true });
    res = await doFetch(token);
  }

  return res;
}
