// =============================================================================
// OAuth Tiendanube — intercambio del code de autorización por el access_token
// permanente (DEUDA 144, Momento 1 — contrato verificado en DEUDA 130).
// =============================================================================
// Cuando el cliente instala la app y acepta permisos, Tiendanube redirige al
// callback con ?code=xxx&state=<token de vinculación>. Este módulo hace el
// segundo paso: POST al endpoint de Tiendanube con el code + las credenciales
// de la app, y recibe el access_token permanente + user_id.
//
// user_id de Tiendanube ES el store_id (Tiendanube trata al owner del OAuth
// como "usuario", pero para nuestros efectos es la tienda). El valor va
// directo a TiendaTiendanube.storeId.
//
// El access_token es PERMANENTE (sin expiración, sin refresh_token). Hay que
// guardarlo encriptado (usar lib/utils/secret-crypto encryptSecret) porque
// permite hacer llamadas AUTORIZADAS a la tienda del cliente.
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import {
  getTiendanubeClientIdOrThrow,
  getTiendanubeClientSecretOrThrow,
  getTiendanubeTokenUrl,
} from "@/lib/utils/tiendanube-config";

export interface ExchangeResult {
  accessToken: string;
  storeId: number; // Tiendanube lo llama user_id, pero ES el store_id.
}

/**
 * Intercambia el authorization code por el access_token permanente + store_id.
 *
 * @param code - el `code` que Tiendanube envió en el redirect al callback.
 *               Expira en 5 minutos (DEUDA 130).
 * @returns { accessToken, storeId } — el token en PLAINTEXT (el caller lo
 *               encripta antes de persistir).
 * @throws Error si la request falla (status no-2xx), la respuesta no es JSON,
 *               o faltan access_token / user_id válidos.
 */
export async function exchangeCodeForToken(code: string): Promise<ExchangeResult> {
  const body = {
    client_id: getTiendanubeClientIdOrThrow(),
    client_secret: getTiendanubeClientSecretOrThrow(),
    grant_type: "authorization_code",
    code,
  };
  const res = await fetchTiendanube(getTiendanubeTokenUrl(), {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data) {
    console.error("[tiendanube/oauth] exchange falló:", res.status, data);
    throw new Error(`Intercambio con Tiendanube falló (status ${res.status})`);
  }
  const accessToken: string | undefined = data.access_token;
  const storeId = Number(data.user_id);
  if (!accessToken || !Number.isInteger(storeId)) {
    throw new Error("Respuesta de Tiendanube sin access_token o user_id válido");
  }
  return { accessToken, storeId };
}
