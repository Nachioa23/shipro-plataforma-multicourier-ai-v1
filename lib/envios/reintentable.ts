// ============================================================================
// HELPER — IDENTIFICADOR DE ENVÍOS REINTENTABLES (Sub-fase 3 Pieza 1, 2026-09-10)
//
// Cross-refs: TODOs pre-existentes en `lib/envios/crear.ts:944` y
// `lib/envios/dispatch.ts:558-560` declaran esta obra ("reintento automático
// para tramos huérfanos, procesar-bloqueados-parcial similar al patrón
// saldo/depósito").
//
// PIEZA 1 (esta) — SÓLO IDENTIFICACIÓN. Cero ejecución:
//   - NO despacha (no llama a despacharCourier).
//   - NO debita (no toca MovimientoFinanciero, saldoActivo, ni el helper P1).
//   - NO cambia estados (no muta Envio).
//   - NO tiene concurrencia (funciones puras + una query filter estática).
//
// Es el inventario de "¿qué envíos se REINTENTARÍAN si el cron estuviera vivo?".
// Las piezas siguientes (cron endpoint + handler + idempotency courier-side)
// consumen este identificador para ejecutar los retries efectivamente. La
// separación de piezas mantiene los cambios money-critical aislados.
//
// CRITERIO REINTENTABLE (Nacho):
//   1. `estadoActual === "BLOQUEADO_PARCIAL"` — el estado terminal de falla
//      transitoria de dispatch (crear.ts:946 lo setea cuando dispatchResult
//      falla mid-flight).
//   2. `retryCount < MAX_REINTENTOS` — cap duro para evitar loops infinitos
//      cuando la causa es en realidad permanent (fallback contra un
//      whitelist transient imperfecto).
//   3. `errorTramo` matchea un patrón TRANSIENT conocido — timeout, connection
//      down, red inestable. Los patrones vienen de recon Pieza 5 de DEUDA 174:
//      solo `CourierTimeout:` está tipado; el resto se detecta por keywords.
//
// SEÑAL DE ERROR:
//   `errorTramo` HOY no vive como campo estructurado en `Envio` — se persiste
//   solamente como texto libre en `EventoTracking.observacion` cuando el
//   envío nace BLOQUEADO_PARCIAL (crear.ts:1200). Este helper NO consulta
//   `EventoTracking`; recibe `errorTramo` como parámetro del caller. Los
//   callers futuros (cron/handler) extraerán el último error del envío desde
//   `EventoTracking` o (idealmente, en una pieza posterior) desde un field
//   estructurado que se agregue a `Envio`. Por ahora, el identifier es puro
//   sobre lo que se le pasa.
//
// CAP + COOLDOWN:
//   MAX_REINTENTOS = 5 (tunable). COOLDOWN queda para el cron/handler siguiente
//   (chequeará `ultimoReintento` contra `now - COOLDOWN_MINUTES`). Este piece
//   solo ofrece el cap por count.
// ============================================================================

import { Prisma } from "@prisma/client";

/**
 * Cap duro de intentos por envío. Después del retryCount llega a este número,
 * el envío deja de ser reintentable y queda para resolución manual (misma UX
 * que hoy — BLOQUEADO_PARCIAL manual, pero con contador registrado).
 */
export const MAX_REINTENTOS = 5;

/**
 * Patrones que identifican un error TRANSIENT (retryable): timeout de red,
 * conexión rechazada, courier caído puntual. Case-insensitive.
 *
 * Solo `CourierTimeout:` está tipado explícitamente por los 6 adapters
 * (Andreani, Mocis, Intralog, HopEnvios, OCA, CorreoArgentino). El resto son
 * keywords que aparecen naturalmente en los `err.message` cuando la causa es
 * de red (Node fetch, undici). Los errores permanentes (CredencialesPropias,
 * 4xx del courier, factory error) NO matchean ninguno de estos patrones →
 * skip retry.
 */
export const PATRONES_TRANSITORIOS: RegExp[] = [
  /couriertimeout/i,
  /\btimeout\b/i,
  /econnrefused/i,
  /etimedout/i,
  /econnreset/i,
  /fetch failed/i,
  /networkerror/i,
];

/**
 * Determina si un mensaje de error de dispatch corresponde a una falla
 * TRANSIENT (retryable). Función pura sobre el string.
 *
 * @param errorTramo - Mensaje del `dispatchResult.error` persistido para el
 *                     envío. Puede ser null (envío sin error registrado — trata
 *                     como no-transient, safe default).
 * @returns true si al menos un patrón transient matchea.
 */
export function esFalloTransitorio(errorTramo: string | null | undefined): boolean {
  if (!errorTramo) return false;
  return PATRONES_TRANSITORIOS.some((patron) => patron.test(errorTramo));
}

/**
 * Vista mínima de un envío para decidir si se reintentaría. El caller
 * construye este objeto con los fields relevantes desde `prisma.envio` +
 * (opcional) el último `EventoTracking.observacion` que trae el errorTramo.
 */
export interface EnvioReintentableInput {
  estadoActual: string;
  retryCount: number;
  errorTramo: string | null;
}

/**
 * ¿El envío es reintentable AHORA? Función pura, sin side effects.
 *
 * Criterio (los 3 tienen que ser true):
 *   1. estadoActual === "BLOQUEADO_PARCIAL".
 *   2. retryCount < MAX_REINTENTOS.
 *   3. esFalloTransitorio(errorTramo).
 *
 * NO consulta BD, NO despacha, NO debita, NO cambia estado. Se usa en el cron
 * futuro (pieza siguiente) para filtrar la lista de candidatos post-findMany.
 *
 * @param envio - Vista mínima con los fields necesarios.
 * @returns true si califica para reintento; false en cualquier otro caso.
 */
export function esReintentable(envio: EnvioReintentableInput): boolean {
  if (envio.estadoActual !== "BLOQUEADO_PARCIAL") return false;
  if (envio.retryCount >= MAX_REINTENTOS) return false;
  return esFalloTransitorio(envio.errorTramo);
}

/**
 * `where` clause de Prisma que pre-filtra los envíos candidatos (los que
 * Prisma puede filtrar sin lectura de `EventoTracking`). El caller final DEBE
 * aplicar `esReintentable` sobre cada resultado con el `errorTramo` extraído
 * del último EventoTracking para completar la decisión.
 *
 * Uso típico (pieza siguiente, cron):
 *   const candidatos = await prisma.envio.findMany({
 *     where: filtroReintentablesPrisma(),
 *     include: { eventos: { where: { estado: "BLOQUEADO_PARCIAL" }, orderBy: { fecha: "desc" }, take: 1 } },
 *   });
 *   for (const envio of candidatos) {
 *     const errorTramo = envio.eventos[0]?.observacion ?? null;
 *     if (esReintentable({ estadoActual: envio.estadoActual, retryCount: envio.retryCount, errorTramo })) { ... }
 *   }
 *
 * @returns objeto pasable a `prisma.envio.findMany({ where })`.
 */
export function filtroReintentablesPrisma(): Prisma.EnvioWhereInput {
  return {
    estadoActual: "BLOQUEADO_PARCIAL",
    retryCount: { lt: MAX_REINTENTOS },
  };
}
