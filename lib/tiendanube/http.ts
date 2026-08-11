// =============================================================================
// Cliente HTTP de Tiendanube (DEUDA 144).
// =============================================================================
// Centraliza dos cosas que TODA llamada a la API de Tiendanube necesita:
// (1) el User-Agent obligatorio (sin él → 400, ver DEUDA 130), y
// (2) un timeout (AbortController) para no dejar requests colgados.
//
// Todas las llamadas a Tiendanube (exchange OAuth, registro de carrier, labels,
// fulfillment events) deben pasar por acá. Si se saltea el helper y se usa fetch
// crudo, el User-Agent falta y Tiendanube responde 400.
//
// Cousin de lib/couriers/{Andreani,Mocis}Adapter.ts::fetchConTimeout. Compartir
// un helper único cross-provider queda como cleanup futuro (DEUDA 145 — timeout
// parametrizable por-call). Por ahora, cada provider tiene su copia con sus
// propias reglas (Tiendanube exige User-Agent; los couriers no).
// =============================================================================

import { getTiendanubeUserAgent } from "@/lib/utils/tiendanube-config";

const TIENDANUBE_TIMEOUT_MS = 8000;

/**
 * fetch() a la API de Tiendanube con User-Agent obligatorio inyectado + timeout.
 *
 * @param url - endpoint absoluto de Tiendanube (o mock via TIENDANUBE_TOKEN_URL).
 * @param init - RequestInit estándar. Si trae body y no trae Content-Type, se
 *               setea Content-Type: application/json (DEUDA 130 lo exige en POST/PUT).
 * @returns la Response cruda (el caller chequea res.ok y parsea el body).
 * @throws Error("TiendanubeTimeout: ...") si la request excede el timeout.
 */
export async function fetchTiendanube(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIENDANUBE_TIMEOUT_MS);
  try {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", getTiendanubeUserAgent()); // obligatorio en Tiendanube
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`TiendanubeTimeout: no respondió en ${TIENDANUBE_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
