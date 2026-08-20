// =============================================================================
// DEUDA 104 (Movimiento 1/3) — Mapeo de estados Shipro → Tiendanube tracking.
// =============================================================================
// Cuando el cron detecta un movimiento nuevo de un envío originado en
// Tiendanube, tenemos que empujar ese evento al timeline del comprador vía la
// API de fulfillment orders. El endpoint (POST tracking-events) acepta un set
// FIJO de statuses (FulfillmentOrderTrackingEventStatus del contrato oficial),
// más un "custom_{status}" para lo nuestro que no encaje.
//
// Mapeo autoritativo (decisión Nacho) de los 11 ESTADOS_COURIER canónicos
// (lib/utils/estados.ts) al vocabulario Tiendanube:
//
//   ETIQUETA_CREADA         → dispatched
//   PAQUETE_RECOLECTADO     → received_by_post_office
//   EN_TRANSITO_A_DESTINO   → in_transit
//   EN_SUCURSAL_DE_DESTINO  → in_transit               (colapsa con tránsito)
//   EN_SUCURSAL_DE_ENTREGA  → ready_for_pickup
//   EN_DISTRIBUCION         → out_for_delivery
//   ENTREGADO               → delivered                (ver nota en tracking-api.ts)
//   VISITA_FALLIDA          → delivery_attempt_failed
//   CANCELADO               → custom_cancelado         (no hay nativo)
//   DEVUELTO_AL_REMITENTE   → returned_to_sender
//   INCIDENCIA              → delayed                  (bidireccional; mejor
//                                                        aproximación no-terminal)
//
// EXHAUSTIVIDAD: `Record<EstadoCourierKey, string>` obliga a mapear los 11.
// Si mañana se agrega un estado a ESTADOS_COURIER sin sumarlo acá, tsc rompe.
//
// `estadoTiendanube(str)` es tolerante: acepta cualquier string (el cron podría,
// en teoría, escribir un legacy fuera del catálogo courier) y devuelve `null`
// cuando ese estado NO se pushea a Tiendanube — incluye TODOS los ESTADOS_INTERNOS
// (IMPRESO, RETENIDO, BLOQUEADO, PENDIENTE) que nunca deben llegar al timeline
// del comprador. El caller de Movimiento 2 usa el null como señal "skip push".
// =============================================================================

import type { EstadoCourierKey } from "@/lib/utils/estados";

export const MAPEO_ESTADO_TIENDANUBE: Record<EstadoCourierKey, string> = {
  ETIQUETA_CREADA: "dispatched",
  PAQUETE_RECOLECTADO: "received_by_post_office",
  EN_TRANSITO_A_DESTINO: "in_transit",
  EN_SUCURSAL_DE_DESTINO: "in_transit",
  EN_SUCURSAL_DE_ENTREGA: "ready_for_pickup",
  EN_DISTRIBUCION: "out_for_delivery",
  ENTREGADO: "delivered",
  VISITA_FALLIDA: "delivery_attempt_failed",
  CANCELADO: "custom_cancelado",
  DEVUELTO_AL_REMITENTE: "returned_to_sender",
  INCIDENCIA: "delayed",
};

export function estadoTiendanube(estadoShipro: string): string | null {
  return (MAPEO_ESTADO_TIENDANUBE as Record<string, string>)[estadoShipro] ?? null;
}
