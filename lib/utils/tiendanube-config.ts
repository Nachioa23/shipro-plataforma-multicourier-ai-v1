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
//   URL de authorize). Único necesario para generar el link (Momento 1).
//
// A medida que se construyan los siguientes momentos:
// - TIENDANUBE_CLIENT_ID  → callback OAuth (intercambio de code por token).
// - TIENDANUBE_CLIENT_SECRET → callback OAuth (idem).
// Cada uno con su propio getter y guard, para que el error sea localizable.
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
