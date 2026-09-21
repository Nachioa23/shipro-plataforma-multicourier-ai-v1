// ============================================================================
// MEF Fase 1 fix (2026-09-21) — IP allowlist para webhooks del marketplace ML.
//
// El marketplace de ML (topics: shipments, questions, items, flex-handshakes,
// etc.) NO firma sus webhooks — autentica por IP de origen + HTTPS + validación
// server-side vía GET autenticado del recurso. El header x-signature/HMAC es
// de Mercado Pago. Este helper implementa la defensa-en-profundidad por IP:
// fail-open-but-loud + enforce flag env-driven.
//
// Los locks REALES del receiver son:
//   1. seller resolution (CuentaMercadoLibre.findUnique by mlUserId).
//   2. GET autenticado /shipments/{id} con x-format-new (post-persist).
// La IP allowlist es capa adicional para reducir superficie de ataque + log
// forense (identificar IPs que no reconocemos y actualizar el env).
//
// SPOOFABILITY caveat: x-forwarded-for es un header cliente-controlable si
// nginx no está configurado con set_real_ip_from + real_ip_header. La lock
// hard sigue siendo el GET autenticado del recurso — IP allowlist es solo
// defense-in-depth.
// ============================================================================

/**
 * Lista precargada de IPs de Mercado Libre para el marketplace (por doc oficial
 * ML vía Chat D). Estas IPs CAMBIAN sin aviso — override con env var
 * ML_WEBHOOK_IPS cuando ML publique cambios.
 *
 * Fuente: doc oficial de seguridad ML, capturada 2026-09-21.
 */
const DEFAULT_ML_WEBHOOK_IPS: readonly string[] = [
  "54.88.218.97",
  "18.215.140.160",
  "18.213.114.129",
  "18.206.34.84",
  "35.236.253.169",
  "35.245.91.34",
  "35.245.20.104",
  "35.186.182.146",
  "13.223.210.67",
  "54.160.66.146",
  "44.212.229.114",
  "52.204.14.181",
  "13.223.210.140",
  "54.236.191.153",
];

/**
 * Lista de IPs ML autorizadas. Prioridad: env var ML_WEBHOOK_IPS (comma-sep)
 * si viene, sino la lista precargada.
 */
function getMlWebhookIps(): Set<string> {
  const raw = process.env.ML_WEBHOOK_IPS;
  const list =
    raw && raw.trim().length > 0
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : DEFAULT_ML_WEBHOOK_IPS;
  return new Set(list);
}

/**
 * Enforce flag. Default false (fail-open + log ruidoso).
 *   ML_WEBHOOK_IP_ENFORCE=true → 401 si la IP no está en allowlist.
 *
 * ⚠️ TODO SEGURIDAD-HONESTIDAD (2026-09-21): antes de subir enforce=true en
 * prod, CONFIRMAR que nginx tiene configurado:
 *   - `set_real_ip_from <rango-Akamai>;`  para cada rango CIDR de Akamai
 *     (los edge nodes que reciben el request público antes de proxy-pasarlo
 *     a Next). La lista canónica de rangos Akamai vive en su portal.
 *   - `real_ip_header X-Forwarded-For;`  para que nginx re-escriba el
 *     $remote_addr con el primer IP de la chain que provino de Akamai (y
 *     descarte los que puso el cliente).
 *
 * SIN esa config de nginx, `x-forwarded-for` es CLIENTE-CONTROLABLE: cualquier
 * atacante puede setear el header con una IP de la allowlist y el receiver
 * lo aceptaría como legítimo. Enforce=true en ese estado da FALSA SEGURIDAD.
 *
 * Los LOCKS REALES del receiver son:
 *   1. Seller resolution — CuentaMercadoLibre.findUnique by mlUserId BigInt.
 *   2. GET autenticado /shipments/{id} con x-format-new — un atacante no puede
 *      fabricar un shipment que existe en la cuenta ML del seller.
 * La IP allowlist es defense-in-depth, NO el lock hard. No confiar en enforce
 * hasta que nginx esté verificado.
 *
 * Recomendado: enforce=false (default) durante todo shakedown; a true SOLO
 * después de: (a) confirmar la config de nginx, (b) estabilizar la allowlist
 * con datos de webhooks reales, (c) monitorear logs "IP no matchea" durante
 * ~2 semanas para ver que no aparezcan IPs legítimas de ML fuera de la lista.
 */
function isMlWebhookIpEnforced(): boolean {
  const enforced = process.env.ML_WEBHOOK_IP_ENFORCE === "true";
  if (enforced) {
    // Warn ruidoso cada vez que enforce=true rechaza — costo de log mínimo,
    // asegura visibilidad si el flag se subió antes de verificar nginx.
    // Es aceptable warn por request (no over-engineer con once-only
    // bootstrap): pocos rechazos esperados en operación normal, y el warn
    // solo aparece en el path del 401, no en el fail-open común.
    console.warn(
      "[ml-webhook-ip] ⚠️ ENFORCE=true pero la confiabilidad de x-forwarded-for NO está confirmada (nginx set_real_ip_from). Si la IP es spoofeable, enforce da FALSA seguridad. Verificar nginx antes de confiar.",
    );
  }
  return enforced;
}

/**
 * Extrae la IP client de un Next.js Request behind Akamai + nginx.
 *
 * ⚠️ IMPORTANTE — proxy.ts:111 retorna early para paths PUBLIC (los webhooks
 * son public), así que NO llega enriquecido con x-ip-origen. Este helper lee
 * los raw headers directo, mismo patrón que proxy.ts:148-151:
 *   x-forwarded-for primer entry → x-real-ip fallback.
 *
 * Order de preferencia (basado en headers reales vistos en el capture de
 * 2026-09-21 — sin true-client-ip presente):
 *   1. x-forwarded-for (split por coma, primer entry = client origen).
 *   2. x-real-ip (nginx lo setea desde xff[0]).
 *
 * @returns IP string trimmed, o null si no hay ningún header presente.
 */
export function extractClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) {
    const trimmed = xRealIp.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Chequea la IP contra la allowlist. Fail-open-loud por diseño: siempre
 * retorna el resultado sin efectos; el caller decide qué hacer con
 * `allowed` + `enforce`.
 */
export function checkMlWebhookIpAllowlist(request: Request): {
  ip: string | null;
  allowed: boolean;
  enforce: boolean;
  allowlistSize: number;
} {
  const ip = extractClientIp(request);
  const allowlist = getMlWebhookIps();
  const enforce = isMlWebhookIpEnforced();
  const allowed = ip !== null && allowlist.has(ip);
  return { ip, allowed, enforce, allowlistSize: allowlist.size };
}
