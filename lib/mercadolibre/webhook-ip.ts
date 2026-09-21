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
 * Recomendado: false durante shakedown (Nacho ve logs y actualiza IPs cuando
 * aparezcan nuevas de ML); a true después de estabilizar.
 */
function isMlWebhookIpEnforced(): boolean {
  return process.env.ML_WEBHOOK_IP_ENFORCE === "true";
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
