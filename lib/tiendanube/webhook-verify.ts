// ============================================================================
// HELPER — VERIFICACIÓN DE FIRMA HMAC DE WEBHOOKS DE TIENDANUBE (DEUDA 104)
//
// Tiendanube firma cada webhook con HMAC-SHA256 usando el client_secret de la
// app (el mismo que se usa en el intercambio OAuth). La firma viaja en el
// header:
//     x-linkedstore-hmac-sha256
// El algoritmo es HMAC-SHA256 y el encoding es HEX MINÚSCULA (64 chars),
// NO base64 — confirmado en la doc oficial
// (tiendanube.github.io/api-documentation/resources/webhook "Verifying a
// webhook"). El ejemplo canónico en PHP usa:
//     hash_hmac('sha256', $data, APP_SECRET)
// que devuelve por default binary=false → lowercase hex, y hay que compararla
// contra el header con hash_equals (constant-time). Este helper es el
// equivalente en Node: createHmac("sha256", secret).update(raw).digest("hex")
// + crypto.timingSafeEqual.
//
// SOURCES:
// - Secret: getTiendanubeClientSecretOrThrow() en @/lib/utils/tiendanube-config.
//   Fail-fast si TIENDANUBE_CLIENT_SECRET falta. Un secret ausente es un ERROR
//   duro de configuración (hard throw); un mismatch de firma es un rechazo
//   silencioso (return false). NO se confunden.
// - Data: el RAW body de la request tal como llegó — bytes exactos. El caller
//   DEBE leerlo una única vez como texto (await request.text()) ANTES de hacer
//   JSON.parse. Si se pasa por request.json() y después se re-serializa con
//   JSON.stringify, los bytes cambian (whitespace/order/escapes) y la firma
//   NUNCA valida. Este error es silencioso y muy frustrante — siempre leer raw.
//
// SEGURIDAD:
// - Comparación constant-time con crypto.timingSafeEqual (no ===) para no
//   filtrar información sobre la firma esperada vía timing side-channel.
// - Guard previo de shape (/^[0-9a-f]{64}$/) porque timingSafeEqual tira si
//   los buffers difieren en longitud — y NO queremos que un header basura
//   crashee la request, sólo queremos rechazarla con false.
//
// USO TIPICO:
//
//   import { verifyTiendanubeWebhookSignature } from "@/lib/tiendanube/webhook-verify";
//
//   export async function POST(request: Request) {
//     const raw = await request.text();                        // 1. leer raw
//     const sig = request.headers.get("x-linkedstore-hmac-sha256");
//     if (!verifyTiendanubeWebhookSignature(raw, sig)) {
//       return new Response("Invalid signature", { status: 401 });
//     }
//     const payload = JSON.parse(raw);                         // 2. parse
//     // ... manejar el evento ...
//   }
// ============================================================================

import crypto from "crypto";
import { getTiendanubeClientSecretOrThrow } from "@/lib/utils/tiendanube-config";

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Tiendanube.
 *
 * @param rawBody - Body de la request EN CRUDO (string o Buffer). NO parseado
 *                  ni re-serializado. Leerlo con `await request.text()` antes
 *                  de cualquier `JSON.parse`.
 * @param signatureHeader - Contenido del header `x-linkedstore-hmac-sha256`
 *                          tal como llegó (puede ser null si el header falta).
 * @returns true si la firma es válida; false en cualquier otro caso (header
 *          ausente, formato inválido, mismatch).
 * @throws Error si TIENDANUBE_CLIENT_SECRET no está configurado (delegado
 *         desde getTiendanubeClientSecretOrThrow — un secret ausente es un
 *         error duro de deploy, no un rechazo silencioso).
 */
export function verifyTiendanubeWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null,
): boolean {
  // 1. Header ausente o vacío → rechazo silencioso.
  if (!signatureHeader) return false;

  // 2. Normalizar + validar shape. Sin este guard, timingSafeEqual tiraría
  //    "Input buffers must have the same byte length" ante cualquier header
  //    mal-formado — y NO queremos que un header basura crashee la request,
  //    sólo rechazarla con false.
  const received = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;

  // 3. Secret. Fail-fast: config faltante = deploy roto = throw. NO se
  //    confunde con mismatch (que es rechazo silencioso con false).
  const secret = getTiendanubeClientSecretOrThrow();

  // 4. Calcular la firma esperada sobre el raw body, mismo algoritmo y
  //    encoding que Tiendanube (SHA-256 → hex lowercase de 64 chars).
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // 5. Comparación constant-time. Ambos buffers son 32 bytes (16 bytes por
  //    cada 32 chars hex × 2) por el guard del paso 2 y por definición del
  //    digest de SHA-256, así que la comparación nunca tira por longitud.
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}
