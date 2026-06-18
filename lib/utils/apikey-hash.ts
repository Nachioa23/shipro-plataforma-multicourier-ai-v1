// ============================================================================
// HELPER — API KEY HASHING (TECH 1, 2026-06-18)
//
// Centraliza la logica de generacion y hashing de apiKeys del cliente.
//
// SEGURIDAD:
// - Las apiKeys se generan como tokens random de 16 bytes (32 chars hex)
//   prefijadas con "shipro_live_" (32 + 12 = 44 chars total).
// - Se almacenan en BD como HMAC-SHA256 hash usando APIKEY_HMAC_SECRET
//   (configurado en .env.local).
// - HMAC-SHA256 es determinista: mismo input + mismo secret = mismo hash.
//   Esto permite lookup eficiente via findUnique({where: {apiKeyHash}})
//   en proxy.ts authByApiKey.
// - Bcrypt NO se usa aqui porque no es determinista (no permite lookup).
//   Bcrypt es para passwords; HMAC-SHA256 es industry standard para API keys
//   (GitHub, Stripe, AWS).
//
// EL VALOR PLAIN SE EXPONE UNA SOLA VEZ al cliente al rotar la apiKey.
// Si el cliente la pierde, debe rotar (que invalida la anterior).
//
// USO TIPICO:
//
//   import { generateApiKey, hashApiKey, API_KEY_PREFIX } from "@/lib/utils/apikey-hash";
//
//   // Al rotar:
//   const { plain, hash, ultimos4 } = generateApiKey();
//   await prisma.empresa.update({
//     where: { id: empresaId },
//     data: { apiKeyHash: hash, apiKeyUltimos4: ultimos4, apiKeyActiva: true }
//   });
//   return { apiKey: plain };  // <- UNICA VEZ que el plain se expone
//
//   // Al validar (proxy.ts):
//   const hash = hashApiKey(incomingPlain);
//   const empresa = await prisma.empresa.findUnique({ where: { apiKeyHash: hash } });
// ============================================================================

import crypto from "crypto";

export const API_KEY_PREFIX = "shipro_live_";

/**
 * Hashea una apiKey plain usando HMAC-SHA256 con APIKEY_HMAC_SECRET.
 *
 * @param plain - apiKey en plain text (debe incluir prefijo "shipro_live_")
 * @returns Hash hexadecimal de 64 chars
 * @throws Error si APIKEY_HMAC_SECRET no esta configurado
 */
export function hashApiKey(plain: string): string {
  const secret = process.env.APIKEY_HMAC_SECRET;
  if (!secret) {
    throw new Error(
      "APIKEY_HMAC_SECRET no configurado en .env.local. " +
      "Generar con: openssl rand -hex 32"
    );
  }
  return crypto
    .createHmac("sha256", secret)
    .update(plain)
    .digest("hex");
}

/**
 * Genera una nueva apiKey: plain + hash + ultimos 4 chars para display UI.
 *
 * Estructura de la key:
 *   shipro_live_<32-char-hex>
 *
 * @returns { plain, hash, ultimos4 }
 *   - plain: valor completo, se devuelve UNA SOLA VEZ al cliente
 *   - hash: lo que se almacena en BD (Empresa.apiKeyHash)
 *   - ultimos4: ultimos 4 chars del plain, para display UI ("Tu API Key termina en ABCD")
 */
export function generateApiKey(): {
  plain: string;
  hash: string;
  ultimos4: string;
} {
  const random = crypto.randomBytes(16).toString("hex"); // 32 chars hex
  const plain = API_KEY_PREFIX + random;
  const hash = hashApiKey(plain);
  const ultimos4 = plain.slice(-4);
  return { plain, hash, ultimos4 };
}
