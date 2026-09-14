// ============================================================================
// HELPER — VERIFICACIÓN DE FIRMA DE WEBHOOKS DE MERCADO LIBRE (MEF Fase 1 step 4)
//
// Contrato ML (confirmado por Chat D contra docs oficiales):
//   - Header `x-signature: ts=<millis>,v1=<hex-sha256>` (compuesto, NO un hex plano
//     como Tiendanube).
//   - Header `x-request-id` — es parte del manifest.
//   - MANIFEST EXACTO a firmar:
//         `id:${resourceId};request-id:${xRequestId};ts:${ts};`
//     donde `resourceId = body.data.id` (NESTED — el id del RECURSO, ej.
//     shipmentId). ⚠️ NO es `body.id` (top-level), que es el notification id
//     que va a ser nuestra dedup key. Confundir ambos → toda firma falla
//     silenciosamente (401 permanente + ML retry loop, staging nunca persiste).
//   - Algoritmo: HMAC-SHA256(manifest, MERCADOLIBRE_CLIENT_SECRET) → hex.
//     Comparación constant-time contra `v1` con `crypto.timingSafeEqual`.
//
// SEGURIDAD:
//   - Comparación constant-time (no `===`) para no filtrar timing.
//   - Guard `/^[0-9a-f]{64}$/` sobre `v1` — un header basura NO debe crashear
//     la request (timingSafeEqual tira por length mismatch); rechazamos con
//     `false` limpio.
//   - Secret ausente → hard throw (config faltante = deploy roto). No se
//     confunde con mismatch (que es rechazo silencioso).
//
// USO TÍPICO:
//   const rawBody = await request.text();
//   const payload = JSON.parse(rawBody);
//   const ok = verifyMercadoLibreWebhookSignature({
//     payload,
//     xSignature: request.headers.get("x-signature"),
//     xRequestId: request.headers.get("x-request-id"),
//   });
//   if (!ok) return new Response("Invalid signature", { status: 401 });
// ============================================================================

import crypto from "crypto";

/**
 * Lee MERCADOLIBRE_CLIENT_SECRET con fail-fast. Local al helper para no crear
 * dependency circular con lib/mercadolibre/tokens.ts (que lo tiene privado).
 * La duplicación es mínima (~5 líneas) y preserva el scope aditivo de step 4.
 */
function getMlClientSecretOrThrow(): string {
  const v = process.env.MERCADOLIBRE_CLIENT_SECRET;
  if (!v) {
    throw new Error(
      "MERCADOLIBRE_CLIENT_SECRET no está configurada. Sin ella no se puede verificar la firma del webhook Flex.",
    );
  }
  return v;
}

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Mercado Libre.
 *
 * @param opts.payload   - Body ya parseado con JSON.parse. El manifest necesita
 *                         `payload.data.id` (NESTED). Si `data.id` falta →
 *                         rechazo silencioso (return false).
 * @param opts.xSignature - Header `x-signature` tal como llegó (puede ser null).
 * @param opts.xRequestId - Header `x-request-id` tal como llegó (puede ser null).
 * @returns true si la firma es válida; false en cualquier otro caso.
 * @throws Error si MERCADOLIBRE_CLIENT_SECRET falta (hard config error).
 */
export function verifyMercadoLibreWebhookSignature(opts: {
  payload: any;
  xSignature: string | null;
  xRequestId: string | null;
}): boolean {
  const { payload, xSignature, xRequestId } = opts;

  // 1. Headers obligatorios presentes.
  if (!xSignature || !xRequestId) return false;

  // 2. resourceId = payload.data.id (⚠️ NESTED — el id del recurso, ej.
  // shipmentId; NO body.id top-level). Sin data.id no se puede armar el
  // manifest — rechazo silencioso.
  const resourceId =
    payload?.data?.id != null ? String(payload.data.id) : null;
  if (!resourceId) return false;

  // 3. Parsear x-signature "ts=<millis>,v1=<hex>". Formato defensivo — si el
  // header no matchea el shape esperado (ej. viene "v1=..." sin ts, o al
  // revés), rechazo.
  const parts = xSignature.split(",").reduce<Record<string, string>>((acc, seg) => {
    const [k, ...rest] = seg.trim().split("=");
    if (k && rest.length > 0) acc[k.trim().toLowerCase()] = rest.join("=").trim();
    return acc;
  }, {});
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // 4. Guard shape sobre v1: SHA-256 hex = 64 lowercase chars. Sin este
  // guard, timingSafeEqual tiraría por length mismatch con headers basura.
  const v1Norm = v1.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(v1Norm)) return false;

  // 5. Armar el manifest EXACTO. Orden: id → request-id → ts. Separador ";"
  // al final. Cada campo termina con ";" (incluido el último).
  const manifest = `id:${resourceId};request-id:${xRequestId};ts:${ts};`;

  // 6. HMAC-SHA256 sobre el manifest con el CLIENT_SECRET.
  const secret = getMlClientSecretOrThrow();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  // 7. Comparación constant-time. Ambos buffers son 32 bytes (64 hex chars /
  // 2) por el guard del paso 4 + la definición de SHA-256 — timingSafeEqual
  // no tira por longitud.
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(v1Norm, "hex"),
  );
}
