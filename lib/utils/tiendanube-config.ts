// =============================================================================
// HELPER — Config de la app de Shipro en Tiendanube (DEUDA 144, Momento 1+).
// =============================================================================
// Lee las credenciales/identificadores de la app de Shipro registrada en el
// panel de Partners de Tiendanube. Vienen de variables de entorno; NO se
// commitean. Estilo fail-fast (mirror lib/utils/app-url.ts getAppUrlOrThrow):
// los endpoints de instalación/OAuth son operativos (admin) y deben romper
// claro si falta la config, no seguir con una URL o llamada inválida.
//
// Piezas:
// - TIENDANUBE_APP_ID: id numérico de la app en Tiendanube (para construir la
//   URL de authorize).
// - TIENDANUBE_CLIENT_ID / _SECRET: identifican a Shipro en el intercambio del code
//   por el access_token (callback OAuth, DEUDA 130).
// - TIENDANUBE_TOKEN_URL: override opcional del endpoint de intercambio (para tests
//   contra mock local). Default: la URL real de Tiendanube.
// - APP_URL: se reutiliza para armar el User-Agent obligatorio (sin él, Tiendanube
//   responde 400 a cualquier llamada — ver DEUDA 130).
//
// Cada credencial secreta tiene su propio getter con guard, para que el error sea
// localizable a la variable que falta.
// =============================================================================

/**
 * Lee el app_id de la app de Shipro registrada en Tiendanube. Fail-fast: los
 * endpoints de instalación/OAuth son operativos (admin) y deben romper claro
 * si falta la config, no seguir con una URL inválida.
 *
 * @returns El app_id como string (Tiendanube lo trata como opaco).
 * @throws Error si TIENDANUBE_APP_ID no está configurado.
 */
export function getTiendanubeAppIdOrThrow(): string {
  const appId = process.env.TIENDANUBE_APP_ID;
  if (!appId) {
    throw new Error(
      "TIENDANUBE_APP_ID no configurado en .env.local. Obtener del panel de la app en Tiendanube (Partners)."
    );
  }
  return appId;
}

/**
 * client_id de la app de Shipro en Tiendanube. Fail-fast: si falta, el intercambio
 * OAuth no puede correr y rompe claro en lugar de mandar una request incompleta.
 */
export function getTiendanubeClientIdOrThrow(): string {
  const v = process.env.TIENDANUBE_CLIENT_ID;
  if (!v) {
    throw new Error(
      "TIENDANUBE_CLIENT_ID no configurado en .env.local. Obtener del panel de la app en Tiendanube (Partners)."
    );
  }
  return v;
}

/**
 * client_secret de la app de Shipro en Tiendanube. Fail-fast: si falta, el intercambio
 * OAuth no puede correr y rompe claro en lugar de mandar una request incompleta.
 */
export function getTiendanubeClientSecretOrThrow(): string {
  const v = process.env.TIENDANUBE_CLIENT_SECRET;
  if (!v) {
    throw new Error(
      "TIENDANUBE_CLIENT_SECRET no configurado en .env.local. Obtener del panel de la app en Tiendanube (Partners)."
    );
  }
  return v;
}

/**
 * User-Agent obligatorio en TODA llamada a la API de Tiendanube (sin él → 400 —
 * DEUDA 130). Formato pedido por Tiendanube: "NombreApp (email_o_url)". Usamos
 * APP_URL como contacto, con fallback para no romper si APP_URL no está seteado
 * (el fetch no debería fallar por falta de contacto — mejor un fallback razonable).
 */
export function getTiendanubeUserAgent(): string {
  const contacto = process.env.APP_URL || "https://shipro.pro";
  return `Shipro (${contacto})`;
}

/**
 * URL del intercambio de code por token. Default = la real de Tiendanube; override
 * por env (TIENDANUBE_TOKEN_URL) para apuntar a un mock local en tests.
 */
export function getTiendanubeTokenUrl(): string {
  return process.env.TIENDANUBE_TOKEN_URL || "https://www.tiendanube.com/apps/authorize/token";
}
