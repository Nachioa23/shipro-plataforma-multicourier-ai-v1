// ============================================================================
// Capa de PREPARACIÓN v1 (global) — 2026-11-11.
// ============================================================================
// Días hábiles entre que entra el pedido y sale del depósito (order→despacho).
// Se suma SOLO en display (promesa al comprador = end-to-end) en:
//   - lib/cotizador.ts calcularFechaEstimada  → OpcionTarifa.fechaEstimadaString
//   - lib/shopify/rates.ts mapearCotizacionAShopify → min/max_delivery_date
//
// El storage (Envio.slaPromesaHs / diasPrometidosCheckout) sigue guardando
// SOLO tránsito — los 6 readers de on-time miden fechaImpresion→fechaEntrega
// (tránsito real) contra la promesa persistida (tránsito) → consistente, no
// se tocan. Agregar la prep al storage sin tocar los readers inflaría
// cumplimiento artificialmente.
//
// Default global v1. Roadmap:
//   - v2: por depósito (Deposito.diasPreparacion columna nueva).
//   - v3: medido real (P75 de `fechaCreacionPedido → fechaImpresion` cuando el
//     origen dé ese timestamp).
// ============================================================================

export const DIAS_PREPARACION_DEFAULT = 1;
