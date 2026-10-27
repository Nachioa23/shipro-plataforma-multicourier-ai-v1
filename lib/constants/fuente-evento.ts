// ============================================================================
// FUENTE_EVENTO — origen del dato de un EventoTracking (DEUDA — núcleo
// compartido, pedido Chat D para timeline unificado de la etiqueta virtual
// Flex).
// ============================================================================
//
// SEMÁNTICA: la fuente indica **ORIGEN DEL DATO**, no quién hizo la acción
// física. La narración humana vive en `observacion`.
//
// REGLA PARA CASOS LÍMITE: ¿lo disparó una PERSONA (botón, link, acción
// manual) → OPERADOR; ¿la plataforma sola (cron/trigger automático/webhook de
// plataforma externa) → SISTEMA; ¿el dato viene de consultar al courier →
// COURIER; ¿el dato viene de ML Flex → ML.
// ============================================================================

export const FUENTE_EVENTO = {
  // Dato de un webhook/consulta a Mercado Libre (ningún writer lo usa todavía;
  // Chat D lo engancha en MEF cuando construya el timeline Flex).
  ML: "ML",

  // Dato de consultar al adapter del courier (cron de rastreo + rastreo manual
  // disparado por operador — en ambos casos el DATO viene del courier, no de
  // la NPMS).
  COURIER: "COURIER",

  // Evento generado automáticamente por la NPMS: bloqueos iniciales al crear
  // envío, retenciones por peaje, destrabes automáticos de bloqueos, reintentos
  // post-BLOQUEADO_PARCIAL, "Pendiente" inicial del flujo feliz, cancelaciones
  // disparadas por webhooks de plataforma externa (TN/ML/Shopify).
  SISTEMA: "SISTEMA",

  // Acción manual de una persona (operador Shipro, operador cliente, o
  // comprador final via link público): cancelación manual, corrección de
  // dirección post-peaje, logística inversa, excepción Andreani cargada a
  // mano. Enum amplio en v1 — si en el futuro se distingue comprador vs
  // operador merchant, se agrega variante.
  OPERADOR: "OPERADOR",
} as const;

export type FuenteEvento = typeof FUENTE_EVENTO[keyof typeof FUENTE_EVENTO];
