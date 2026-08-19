// =============================================================================
// DEUDA 144 (Momento 3 Parte 3) — Módulo común de acceso a la API de Tiendanube.
// =============================================================================
// Helpers compartidos por TODOS los módulos que consumen la API de administración
// de Tiendanube: carrier (shipping_carriers), labels (PATCH fulfillment-orders/
// {ffo}/labels/{id}), tracking/fulfillment events (futuro), webhooks (futuro).
//
// Extraídos de carrier.ts (MOVE 1 de 2 del Refactor Momento 3 Parte 3). Fueron
// funciones private de ese archivo hasta que otro módulo (labels PATCH) las
// necesitó: consolidar en un solo lugar es mejor que duplicarlas.
//
// Golden rule del MOVE: byte-identical. Mismo return, mismo formato de URL,
// mismos headers. Cualquier caller que las usaba antes sigue funcionando igual.
// =============================================================================

import {
  getTiendanubeApiBaseUrl,
  getTiendanubeApiVersion,
} from "@/lib/utils/tiendanube-config";

/**
 * Arma la URL de un endpoint de la API de administración de Tiendanube.
 * Formato: `{base}/{version}/{store_id}/{path}` (sin doble slash intermedio).
 *
 * Compartido (DEUDA 144 Momento 3 Parte 3): lo usan carrier, labels, tracking,
 * webhooks. Base y versión configurables via env (TIENDANUBE_API_URL,
 * TIENDANUBE_API_VERSION) — útil para tests contra mocks.
 */
export function apiUrl(storeId: number, path: string): string {
  return `${getTiendanubeApiBaseUrl()}/${getTiendanubeApiVersion()}/${storeId}/${path}`;
}

/**
 * Header `Authorization: Bearer <token>` para calls autenticadas a la API. El
 * caller pasa el accessToken PLAINTEXT (ya descifrado con decryptSecret). Este
 * módulo NO descifra — separación de responsabilidades: la crypto vive en
 * lib/utils/secret-crypto; la comunicación HTTP con Tiendanube vive acá.
 *
 * `fetchTiendanube` NO inyecta Authorization (sólo User-Agent + Content-Type
 * opcional). Todo caller que quiera autenticarse debe pasar este header.
 */
export function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}
