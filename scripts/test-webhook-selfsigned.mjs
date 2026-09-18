#!/usr/bin/env node
// ============================================================================
// 🚨 THROWAWAY — DELETE POST-PRUEBA (git rm + commit + push).
//
// Test self-signed del receiver MEF (Camino 2 — Prueba A).
//
// Corre EN EL SERVER DE PROD (donde MERCADOLIBRE_CLIENT_SECRET vive en el
// .env de Shipro). NUNCA imprime el secret. Firma un POST a
// /api/mercadolibre/webhooks byte-a-byte como el receiver lo verifica
// (mismo manifest, misma HMAC recipe, mismo formato de x-signature) — un
// false 401 es imposible por construcción.
//
// Ejecuta 2 POSTs:
//   1. POSITIVE: firma válida → esperado 200 + persiste en NotificacionFlex
//                con estado="recibida" + empresaId NOT NULL (BigInt OK).
//   2. NEGATIVE: v1 tampered → esperado 401 + NO persiste (control).
//
// Recipe mirror exacta de lib/mercadolibre/webhook-verify.ts:64-116.
//
// Uso:
//   cd /var/www/shipro && node scripts/test-webhook-selfsigned.mjs
//
// Cleanup obligatorio post-test:
//   rm scripts/test-webhook-selfsigned.mjs
//   git add -A && git commit -m "chore(dev): borra script throwaway"
// ============================================================================

import crypto from "node:crypto";
import fs from "node:fs";

const APP_URL = "https://pm.shipro.pro";
const ENDPOINT = "/api/mercadolibre/webhooks";
const ML_USER_ID = 3686169320;          // test seller (mlUserId real ya vinculado)
const APP_ID = 666832293265716;         // application_id de la app MEF
const ENV_PATH = "/var/www/shipro/.env";

// ---------------------------------------------------------------------------
// Load MERCADOLIBRE_CLIENT_SECRET. Primero busca en process.env (si el shell
// ya lo exportó); si no, parsea el .env de prod. NUNCA imprime el secret;
// solo su longitud como sanity check.
// ---------------------------------------------------------------------------
function loadClientSecret() {
  if (process.env.MERCADOLIBRE_CLIENT_SECRET) {
    return process.env.MERCADOLIBRE_CLIENT_SECRET;
  }
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (k !== "MERCADOLIBRE_CLIENT_SECRET") continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  throw new Error(
    `MERCADOLIBRE_CLIENT_SECRET no encontrado en process.env ni en ${ENV_PATH}`,
  );
}

const SECRET = loadClientSecret();
if (!SECRET || SECRET.length < 8) {
  console.error("[abort] SECRET vacío o sospechosamente corto.");
  process.exit(1);
}
console.log(`[setup] secret cargado (${SECRET.length} chars, contenido NO impreso).`);

// ---------------------------------------------------------------------------
// Construir un POST firmado.
//
// Manifest EXACTO del receiver (webhook-verify.ts:100):
//   `id:${resourceId};request-id:${xRequestId};ts:${ts};`
//
// Donde:
//   - resourceId = String(payload.data.id)  ⚠️ NESTED (NO body.id top-level)
//   - xRequestId = valor literal del header x-request-id
//   - ts         = millis epoch como string
//
// HMAC (webhook-verify.ts:103-107):
//   crypto.createHmac("sha256", SECRET).update(manifest).digest("hex")
//   → 64 chars lowercase hex.
//
// x-signature (webhook-verify.ts:81-91 parser):
//   "ts=<ts>,v1=<hex>"  (parser hace split(",") + split("="), keys lowercase)
// ---------------------------------------------------------------------------
function buildSignedRequest({ tamperV1 = false } = {}) {
  const notificacionId = `PRUEBA-SELFSIGNED-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const resourceId = String(Date.now()) + Math.floor(Math.random() * 1000);
  const xRequestId = crypto.randomUUID();
  const ts = String(Date.now());

  const body = {
    id: notificacionId,                        // top-level = dedup key en el receiver
    topic: "shipments",                        // gatilla el regex /shipments/(\d+)
    resource: `/shipments/${resourceId}`,      // shipmentId se extrae de acá
    data: { id: resourceId },                  // ⚠️ NESTED — para el manifest
    user_id: ML_USER_ID,                       // test seller — BigInt lookup lo resuelve
    application_id: APP_ID,
    attempts: 1,
    sent: new Date().toISOString(),
    received: new Date().toISOString(),
  };

  const manifest = `id:${resourceId};request-id:${xRequestId};ts:${ts};`;

  const validV1 = crypto
    .createHmac("sha256", SECRET)
    .update(manifest)
    .digest("hex");

  // Tampered: 64 zeros hex — pasa el shape regex del receiver pero falla el
  // timingSafeEqual → 401.
  const v1 = tamperV1 ? "0".repeat(64) : validV1;

  return {
    url: `${APP_URL}${ENDPOINT}`,
    body,
    headers: {
      "content-type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": xRequestId,
    },
    notificacionId,
    resourceId,
  };
}

// ---------------------------------------------------------------------------
// Ejecutar UN POST + reportar (sin leaks del secret).
// ---------------------------------------------------------------------------
async function doPost(kind, tamperV1) {
  const req = buildSignedRequest({ tamperV1 });
  const res = await fetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(req.body),
  });
  const text = await res.text().catch(() => "");
  console.log("");
  console.log(`===== ${kind} =====`);
  console.log(`  URL: ${req.url}`);
  console.log(`  notificacionId: ${req.notificacionId}`);
  console.log(`  resourceId/shipmentId: ${req.resourceId}`);
  console.log(`  x-request-id: ${req.headers["x-request-id"]}`);
  console.log(`  HTTP ${res.status}`);
  console.log(`  response body: ${text || "(vacío)"}`);
  return {
    status: res.status,
    body: text,
    notificacionId: req.notificacionId,
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const pos = await doPost("POSITIVO (firma válida — esperado 200)", false);
  const neg = await doPost("NEGATIVO (firma tampered — esperado 401)", true);

  const posOk = pos.status === 200;
  const negOk = neg.status === 401;

  console.log("");
  console.log("===== RESULT =====");
  console.log(`  positivo: ${posOk ? "OK ✅ (200)" : `FAIL ❌ (${pos.status})`}`);
  console.log(`  negativo: ${negOk ? "OK ✅ (401)" : `FAIL ❌ (${neg.status})`}`);
  console.log(`  overall:  ${posOk && negOk ? "PASS ✅✅" : "FAIL ❌"}`);
  console.log("");
  console.log("Verificar en la BD que:");
  console.log(`  - Fila con notificacionId='${pos.notificacionId}' EXISTE, estado='recibida', empresaId NOT NULL.`);
  console.log(`  - Fila con notificacionId='${neg.notificacionId}' NO EXISTE (rechazada por firma).`);
  process.exit(posOk && negOk ? 0 : 1);
}

main().catch((e) => {
  console.error("[script error]", e?.message ?? e);
  process.exit(1);
});
