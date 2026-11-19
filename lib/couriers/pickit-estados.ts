import type { EstadoCourierKey } from "@/lib/utils/estados";

// =============================================================================
// Mapeo Pickit → canónico Shipro.
// Fuente: catálogo oficial developers.pickit.net/api/webhook (Workflow × Estado
// × Sub-Estado). Keys en lowercase. NO inventar tags: sólo los del catálogo.
// Reusable por PickitAdapter.traducirEstado() y por el receptor de webhook.
// =============================================================================
const MAPA_PICKIT: Record<string, EstadoCourierKey> = {
  retired: "PAQUETE_RECOLECTADO", retiredlastmile: "PAQUETE_RECOLECTADO",
  dispatched: "EN_TRANSITO_A_DESTINO", confirmed: "EN_TRANSITO_A_DESTINO",
  hold: "EN_TRANSITO_A_DESTINO", free: "EN_TRANSITO_A_DESTINO",
  waiting: "EN_TRANSITO_A_DESTINO", crossdock: "EN_TRANSITO_A_DESTINO",
  inpikcitpoint: "EN_SUCURSAL_DE_DESTINO",
  availableforcollect: "EN_SUCURSAL_DE_ENTREGA",
  availableforcollectdopoint: "EN_SUCURSAL_DE_ENTREGA",
  availableforcollectdomk: "EN_SUCURSAL_DE_ENTREGA",
  pointdistribution: "EN_DISTRIBUCION", homedistribution: "EN_DISTRIBUCION",
  retailerdistribution: "EN_DISTRIBUCION", delivery: "EN_DISTRIBUCION",
  deliverylastmile: "EN_DISTRIBUCION", repeat: "EN_DISTRIBUCION",
  delivered: "ENTREGADO",
  notdelivery: "VISITA_FALLIDA", deliveryimpossible: "VISITA_FALLIDA",
  returntosender: "DEVUELTO_AL_REMITENTE", returnedtosender: "DEVUELTO_AL_REMITENTE",
  returnedtosenderretailer: "DEVUELTO_AL_REMITENTE", refundretailer: "DEVUELTO_AL_REMITENTE",
  ended: "DEVUELTO_AL_REMITENTE", endedreturn: "DEVUELTO_AL_REMITENTE",
  cancel: "CANCELADO", canceled: "CANCELADO", cancelled: "CANCELADO",
  canceledcourier: "CANCELADO", cancelation: "CANCELADO",
  lost: "INCIDENCIA", damaged: "INCIDENCIA", stolen: "INCIDENCIA",
  finaldisposition: "INCIDENCIA", expired: "INCIDENCIA",
  inretailer: "ETIQUETA_CREADA", indropoffpoint: "ETIQUETA_CREADA",
  availablefordropretailer: "ETIQUETA_CREADA", availablefordropdropoff: "ETIQUETA_CREADA",
  availablefordrop: "ETIQUETA_CREADA", availablefordropbuyer: "ETIQUETA_CREADA",
};

function norm(tag: unknown): string {
  return String(tag ?? "").trim().toLowerCase();
}

// Traduce UN tag; desconocido → devuelve el crudo (drift Nomenclador, igual que el resto de los couriers).
export function traducirEstadoPickit(tag: string): string {
  const n = norm(tag);
  return MAPA_PICKIT[n] ?? String(tag ?? "").trim();
}

// Resuelve el canónico desde el objeto `state` del webhook: subState.tag (granular) primero, state.tag después.
export function resolverEstadoPickitDesdePayload(
  state: { tag?: unknown; subState?: { tag?: unknown } | null } | null | undefined,
): string {
  const sub = norm(state?.subState?.tag);
  const main = norm(state?.tag);
  if (sub && MAPA_PICKIT[sub]) return MAPA_PICKIT[sub];
  if (main && MAPA_PICKIT[main]) return MAPA_PICKIT[main];
  return (state?.subState?.tag != null ? String(state.subState.tag) : String(state?.tag ?? "")).trim();
}
