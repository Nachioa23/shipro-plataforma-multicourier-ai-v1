// ============================================================================
// HELPER — VERIFICACIÓN DE FIRMA HMAC DE WEBHOOKS DE SHOPIFY (Fase 3, 2026-10-15).
// ============================================================================
// Shopify firma cada webhook con HMAC-SHA256 usando el client_secret de la app
// (el mismo que se usa en el intercambio OAuth + en la verificación del HMAC
// del redirect del authorize). La firma viaja en el header:
//     x-shopify-hmac-sha256
// El encoding es BASE64 (NO hex, a diferencia de Tiendanube). Confirmado en
// la doc oficial de Shopify ("Verifying webhooks").
//
// SOURCES:
// - Secret: getShopifyApiSecretOrThrow() en @/lib/utils/shopify-config.
//   Fail-fast si SHOPIFY_API_SECRET falta. Un secret ausente es un ERROR duro
//   de configuración (throw); un mismatch de firma es un rechazo silencioso
//   (return false).
// - Data: el RAW body de la request tal como llegó — bytes exactos. El caller
//   DEBE leerlo una única vez como texto (await request.text()) ANTES de hacer
//   JSON.parse. Si se re-serializa, los bytes cambian y la firma NO valida.
//
// SEGURIDAD:
// - Comparación constant-time con crypto.timingSafeEqual (no ===).
// - Guard previo de shape (base64 de 44 chars terminando en "=") porque
//   timingSafeEqual tira ante buffers de distinta longitud. Un header basura
//   produce false, nunca crash de la request.
// ============================================================================

import crypto from "crypto";
import { getShopifyApiSecretOrThrow } from "@/lib/utils/shopify-config";

/**
 * Verifica la firma HMAC-SHA256 base64 de un webhook de Shopify.
 *
 * @param rawBody - Body de la request EN CRUDO (string o Buffer). NO parseado.
 * @param hmacHeader - Contenido del header `x-shopify-hmac-sha256` tal como
 *                     llegó (puede ser null si falta).
 * @returns true si la firma es válida; false ante header ausente, formato
 *          inválido, o mismatch.
 * @throws Error si SHOPIFY_API_SECRET no está configurado (fail-fast delegado
 *         a getShopifyApiSecretOrThrow).
 */
export function verifyShopifyWebhookHmac(
  rawBody: string | Buffer,
  hmacHeader: string | null,
): boolean {
  if (!hmacHeader) return false;
  const received = hmacHeader.trim();
  // Base64 estándar: [A-Za-z0-9+/] + padding; HMAC-SHA256 → 32 bytes → 44
  // chars base64 terminando en "=". Guard laxo pero suficiente para rechazar
  // basura antes de llegar a timingSafeEqual.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(received)) return false;

  const secret = getShopifyApiSecretOrThrow();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  // Ambos buffers son 32 bytes (SHA-256 digest) por construcción + guard.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "base64"),
      Buffer.from(received, "base64"),
    );
  } catch {
    return false;
  }
}
