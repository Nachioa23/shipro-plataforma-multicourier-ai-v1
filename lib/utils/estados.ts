// ============================================================================
// CATÁLOGO CANÓNICO DE ESTADOS DE ENVÍO (Foundations of Tracking F1, 2026-06-09)
//
// Dos planos simultáneos: cada envío tiene un estado en cada plano.
//
// 1. ESTADO INTERNO: lo que ve el cliente Shipro en Bandeja de Pedidos y
//    Centro de Etiquetas. Lo gestiona la Plataforma.
//
// 2. ESTADO COURIER: lo que ve el destinatario en su tracking. Lo gestiona
//    el courier. Solo aplica cuando el envío fue impreso (etiqueta entregada
//    al courier).
//
// Decisión: helper de normalización on-the-fly. NO migración de BD.
// Schema sigue con Envio.estadoActual single field. Helpers traducen al leer.
// El refactor completo a 2 campos separados es DEUDA 50 (sesión dedicada).
// ============================================================================

// ====================================================
// CATÁLOGO 1 — ESTADO INTERNO (Plataforma)
// ====================================================

export const ESTADOS_INTERNOS = {
  PENDIENTE: { key: "PENDIENTE", display: "Pendiente de impresión" },
  RETENIDO: { key: "RETENIDO", display: "Retenido" },
  BLOQUEADO: { key: "BLOQUEADO", display: "Bloqueado" },
  IMPRESO: { key: "IMPRESO", display: "Impreso" },
  CANCELADO: { key: "CANCELADO", display: "Cancelado" },
} as const;

export type EstadoInternoKey = keyof typeof ESTADOS_INTERNOS;
export type EstadoInterno = typeof ESTADOS_INTERNOS[EstadoInternoKey];

// ====================================================
// CATÁLOGO 2 — ESTADO COURIER (visible al destinatario)
// ====================================================
// Orden lógico: 1-7 son progresión exitosa, 8 es transitorio (no terminal),
// 9-11 son cierres del ciclo. INCIDENCIA es bidireccional con salvedad
// (puede revertirse a ENTREGADO si paquete "perdido" reaparece).

export const ESTADOS_COURIER = {
  ETIQUETA_CREADA: { key: "ETIQUETA_CREADA", display: "Etiqueta creada" },
  PAQUETE_RECOLECTADO: { key: "PAQUETE_RECOLECTADO", display: "Paquete recolectado" },
  EN_TRANSITO_A_DESTINO: { key: "EN_TRANSITO_A_DESTINO", display: "En tránsito a destino" },
  EN_SUCURSAL_DE_DESTINO: { key: "EN_SUCURSAL_DE_DESTINO", display: "En sucursal de destino" },
  EN_SUCURSAL_DE_ENTREGA: { key: "EN_SUCURSAL_DE_ENTREGA", display: "En sucursal de entrega" },
  EN_DISTRIBUCION: { key: "EN_DISTRIBUCION", display: "En distribución" },
  ENTREGADO: { key: "ENTREGADO", display: "Entregado" },
  VISITA_FALLIDA: { key: "VISITA_FALLIDA", display: "Visita fallida" },
  CANCELADO: { key: "CANCELADO", display: "Cancelado" },
  DEVUELTO_AL_REMITENTE: { key: "DEVUELTO_AL_REMITENTE", display: "Devuelto al remitente" },
  INCIDENCIA: { key: "INCIDENCIA", display: "Incidencia" },
} as const;

export type EstadoCourierKey = keyof typeof ESTADOS_COURIER;
export type EstadoCourier = typeof ESTADOS_COURIER[EstadoCourierKey];

// ====================================================
// CATÁLOGO 3 — ESTADO NOTIFICACION FLEX (staging de webhooks ML)
// ====================================================
// Estados del ciclo de vida de una fila en NotificacionFlex — el staging
// table de webhooks Mercado Envíos Flex ([[DEUDA 180]] MEF Fase 1).
//
// Distinto plano de los otros dos catálogos: NO es estado de envío (Envio)
// ni estado courier (ETIQUETA_CREADA/etc). Es el estado del PROCESAMIENTO
// interno de la notificación entrante desde ML.
//
// Se centraliza acá (mismo archivo que ESTADOS_INTERNOS/COURIER) siguiendo
// [[DEUDA 173]] (centralización de literales de estado); el receiver
// (app/api/mercadolibre/webhooks/route.ts) importa las keys de este catálogo
// en vez de hardcodear strings.
//
// Semántica:
//   recibida                   — persistida inicial; seller resuelto por
//                                CuentaMercadoLibre.mlUserId. Aún no
//                                clasificada por el GET al shipment.
//   valido                     — GET autenticado /shipments/{id} → 200. El
//                                shipment existe en la cuenta del seller
//                                → notificación auténtica de ML.
//   huerfana                   — seller mlUserId NO existe en
//                                CuentaMercadoLibre. Persistimos igual con
//                                empresaId=null para audit (webhook de un
//                                seller que no gestionamos).
//   get_fallido_reintentable   — GET al shipment falló por network / 5xx /
//                                timeout. Transitorio; Fase 3 worker retry.
//   get_shipment_no_existe     — GET al shipment → 404. Suele ser race
//                                condition (webhook llega ANTES de que ML
//                                termine de crear el shipment) — reintentable
//                                por Fase 3 worker, NO tratar como spoof.
//                                El lock anti-spoof es el GET en sí (que un
//                                atacante no puede fabricar).
export const ESTADOS_NOTIFICACION_FLEX = {
  recibida: { key: "recibida", display: "Recibida (sin verificar aún)" },
  valido: { key: "valido", display: "Válido — GET al shipment OK" },
  huerfana: { key: "huerfana", display: "Huérfana — seller no gestionado" },
  get_fallido_reintentable: { key: "get_fallido_reintentable", display: "GET falló (reintentable)" },
  get_shipment_no_existe: { key: "get_shipment_no_existe", display: "Shipment no existe todavía (reintentable — race con ML)" },
} as const;

export type EstadoNotificacionFlexKey = keyof typeof ESTADOS_NOTIFICACION_FLEX;
export type EstadoNotificacionFlex = typeof ESTADOS_NOTIFICACION_FLEX[EstadoNotificacionFlexKey];

// Estados de NotificacionFlex que pueden reintentarse por el worker de
// Fase 3 (todavía no accionamos downstream; falta info para clasificar).
export const ESTADOS_NOTIFICACION_FLEX_REINTENTABLES: EstadoNotificacionFlexKey[] = [
  "get_fallido_reintentable",
  "get_shipment_no_existe",
];

// ====================================================
// CATÁLOGO 4 — CAUSAS DE NOTIFICACIÓN FLEX NO RUTEABLE (MEF Fase 2.3.c, 2026-09-23)
// ====================================================
// [[DEUDA 173]] centralización de literales.
//
// **Estas son CAUSAS DE NotificacionFlex, no estados de Envío.** Restructure
// Chat D 2026-09-23: una venta Flex NO ruteable NO se convierte en Envío. Se
// queda en el buzón `NotificacionFlex` con `estado="accion_requerida"` +
// `causaFlex=<key>` para que el vendedor la vea + destrabe (agregar zona,
// asignar courier, etc.); cuando destraba, la próxima corrida del worker Flex
// la re-escanea y (si ahora es ruteable) crea el Envío real con crearEnvio.
//
// Los envíos SÓLO se crean vía crearEnvio con un courier REAL en `Courier`. No
// hay envíos "placeholder" ni con causa Flex — ese carril fue rechazado por
// Chat D en la revisión money-critical.
//
// El worker Flex (lib/mercadolibre/crear-envio-flex.ts) escribe estas keys en
// NotificacionFlex.causaFlex. La UI del buzón (futura) mostrará el display.
//
// Semántica:
//   flex_fuera_cobertura     — la cuenta ML tiene zonas activas pero NINGUNA
//                              cubre el CP destino del shipment (resolver
//                              motivo="cp_no_matchea"). Se destraba cuando el
//                              vendedor agrega el CP a una zona en el portal ML.
//   flex_zona_sin_courier    — el CP matcheó una zona activa PERO el cliente
//                              no le asignó courier en /configuracion/couriers-flex
//                              (resolver motivo="zona_sin_courier"). Se destraba
//                              asignando courier en la pantalla Fase 2.2.
//   flex_sin_config          — la cuenta ML tiene CERO zonas activas (vendedor
//                              no configuró Flex en el portal ML, o deshabilitó
//                              todas). Resolver motivo="sin_zonas_flex".
//   flex_cp_no_extraido      — el receiver Fase 1 no pudo extraer
//                              receiver_address.zip_code del payload del
//                              shipment (shape ML diferente al esperado).
//                              cpDestino=null en ShipmentFlex → sin CP no se
//                              puede rutear. Se destraba con re-fetch del
//                              shipment (Fase 3 refresh + shape ML).
//   flex_anomalo             — resolver motivo="anomalo": >1 zona activa
//                              matcheó el mismo CP (GN dice imposible; drift
//                              a investigar). Fail-fast: NO ruteamos silenciosa.
//   flex_datos_incompletos   — el ShipmentFlex.payloadRaw no tenía los campos
//                              críticos (destinatario/peso) para construir el
//                              CrearEnvioInput. Distinto de flex_cp_no_extraido
//                              (que es CP específicamente).
export const ESTADOS_BLOQUEO_FLEX = {
  flex_fuera_cobertura: { key: "flex_fuera_cobertura", display: "Fuera de cobertura Flex (CP)" },
  flex_zona_sin_courier: { key: "flex_zona_sin_courier", display: "Zona Flex sin courier asignado" },
  flex_sin_config: { key: "flex_sin_config", display: "Flex no configurado por el vendedor" },
  flex_cp_no_extraido: { key: "flex_cp_no_extraido", display: "CP destino no pudo extraerse del shipment ML" },
  flex_anomalo: { key: "flex_anomalo", display: "Anomalía de ruteo Flex (drift ML)" },
  flex_datos_incompletos: { key: "flex_datos_incompletos", display: "Datos incompletos en el shipment ML" },
} as const;

export type CausaNotificacionFlexKey = keyof typeof ESTADOS_BLOQUEO_FLEX;
export type CausaNotificacionFlex = typeof ESTADOS_BLOQUEO_FLEX[CausaNotificacionFlexKey];

// ====================================================
// SUB-CATÁLOGO — CAUSAS RE-ESCANEABLES vs ESTANCADAS (MEF Fase 2.3.c fix, 2026-09-24)
// ====================================================
// [[DEUDA 173]] centralización.
//
// CRITERIO Chat D: "se destraba con una acción ESPERABLE" (config del
// vendedor en pantalla 2.2 / portal ML, O fix nuestro del extractor de
// payload ML). Si sí → RE-ESCANEABLE (el worker las lifta cada corrida;
// cuando la acción llega, la próxima corrida rutea). Si no → ESTANCADA
// (el worker NO las lifta; requiere intervención manual — botón admin,
// investigación, o fix Chat D).
//
// Anti-starvation: el worker escanea SOLO estado="accion_requerida" +
// "valido" (ver ESTADOS_NOTIF_A_PROCESAR en crear-envio-flex.ts). Las
// estancadas viven en estado="accion_requerida_estancada" y NO entran al
// batch → nunca ocupan slots del `take=100` frente a notifs nuevas.
export const CAUSAS_REESCANEABLES: ReadonlySet<CausaNotificacionFlexKey> = new Set([
  // Se destraban con config del vendedor:
  "flex_zona_sin_courier", // Vendedor asigna courier en /configuracion/couriers-flex (Fase 2.2).
  "flex_sin_config",        // Vendedor configura Flex en portal ML + sync 2.1 trae zonas.
  // Se destraban con fix NUESTRO del extractor de payload ML (shape pending):
  // ⚠️ IMPORTANTE: son RE-ESCANEABLES porque el shape del receiver_address /
  // shipping_items ML está sujeto a ajuste con webhooks reales. Cuando
  // ajustemos el extractor (crear-envio-flex.ts extractión defensiva o el
  // receiver retrofit), la próxima corrida re-evalúa el ShipmentFlex.
  // payloadRaw (no cambió, seguimos leyendo lo mismo) — CON el extractor
  // corregido — y las rutea. Moverlas a ESTANCADAS las mataría justo cuando
  // arreglemos el shape.
  "flex_cp_no_extraido",
  "flex_datos_incompletos",
] as const);

export const CAUSAS_ESTANCADAS: ReadonlySet<CausaNotificacionFlexKey> = new Set([
  // Drift ML — "imposible" per GN (>1 zona activa matchea el mismo CP).
  // Requiere investigación manual antes de re-processar; auto-lift enmascara.
  "flex_anomalo",
  // CP legítimamente fuera de la cobertura del vendedor. Config estable —
  // no se destraba solo. Nacho pending final call; queda ESTANCADA por default
  // (si Nacho decide re-escaneable, mover al set de arriba — cero migración).
  "flex_fuera_cobertura",
] as const);

/**
 * Helper canónico. `true` si la causa se destraba con acción esperable →
 * worker la lifta cada corrida (estado="accion_requerida"). `false` si
 * requiere intervención manual → worker NO la lifta (estado="accion_requerida_estancada").
 */
export function esCausaReescaneable(causa: CausaNotificacionFlexKey): boolean {
  return CAUSAS_REESCANEABLES.has(causa);
}

// Subconjunto de estados courier que NO son terminales.
// Un envío puede seguir avanzando hacia ENTREGADO desde estos.
export const ESTADOS_COURIER_EN_CICLO: EstadoCourierKey[] = [
  "ETIQUETA_CREADA",
  "PAQUETE_RECOLECTADO",
  "EN_TRANSITO_A_DESTINO",
  "EN_SUCURSAL_DE_DESTINO",
  "EN_SUCURSAL_DE_ENTREGA",
  "EN_DISTRIBUCION",
  "VISITA_FALLIDA",
];

// Estados courier finales (cierran el ciclo).
// INCIDENCIA es bidireccional con salvedad — podría revertirse a ENTREGADO
// pero por convención de cierre se trata como final.
export const ESTADOS_COURIER_FINALES: EstadoCourierKey[] = [
  "ENTREGADO",
  "CANCELADO",
  "DEVUELTO_AL_REMITENTE",
  "INCIDENCIA",
];

// Estados courier "repetibles": cada rastreo del cron crea un nuevo
// EventoTracking aunque el estado sea igual al anterior. Permite contar
// intentos de visita para Metrica 2.2 (Efectividad de Primera Visita).
// Solo aplica a estados donde el courier puede emitir el mismo estado
// varias veces durante el ciclo del paquete.
export const ESTADOS_COURIER_REPETIBLES: EstadoCourierKey[] = [
  "EN_DISTRIBUCION",   // Repetidas visitas al domicilio del comprador
  "VISITA_FALLIDA",    // Mocis u otros couriers pueden marcar varias
  "INCIDENCIA",        // Bidireccional: puede aparecer y desaparecer
];

// Cutoff temporal para el cron de rastreo: ningun envio se pollea despues
// de este numero de dias desde la impresion. Despues del cutoff, solo se
// actualiza manualmente desde la UI. Evita rastreo infinito de envios
// abandonados (paquetes perdidos, devoluciones nunca cerradas, INCIDENCIA
// sin resolver). Es la red de seguridad temporal complementaria al filtro
// de estados terminales (ENTREGADO, CANCELADO, DEVUELTO).
export const DIAS_MAXIMO_RASTREO = 45;

// ====================================================
// NORMALIZADOR DE STRINGS LEGACY → CATÁLOGO INTERNO
// ====================================================
// Mapea strings que circulan en BD/código (Pendiente, BLOQUEADO_SALDO, etc.)
// al catálogo interno canónico.

function quitarTildesYNormalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function normalizarEstadoInterno(legacy: string | null | undefined): EstadoInternoKey | null {
  if (!legacy) return null;

  const norm = quitarTildesYNormalizar(legacy);

  if (norm === "pendiente") return "PENDIENTE";
  if (norm === "retenido") return "RETENIDO";
  if (norm === "impreso" || norm === "impreso / listo" || norm === "impreso/listo") return "IMPRESO";
  if (norm === "cancelado") return "CANCELADO";

  // Todos los BLOQUEADO_* colapsan a BLOQUEADO canónico.
  if (norm.startsWith("bloqueado")) return "BLOQUEADO";

  return null; // string desconocido (caso de Excel importado)
}

// ====================================================
// NORMALIZADOR DE STRINGS LEGACY → CATÁLOGO COURIER
// ====================================================

export function normalizarEstadoCourier(legacy: string | null | undefined, modalidadEnvio?: string | null): EstadoCourierKey | null {
  if (!legacy) return null;

  const norm = quitarTildesYNormalizar(legacy);

  // Estados terminales primero (más específicos).
  if (norm === "entregado") return "ENTREGADO";
  if (norm === "incidencia" || norm.startsWith("s_fallida") || norm.startsWith("s_siniestro")) return "INCIDENCIA";
  if (norm === "devuelto" || norm === "devuelto al remitente") return "DEVUELTO_AL_REMITENTE";
  if (norm === "cancelado") return "CANCELADO";
  if (norm === "visita fallida" || norm === "visita_fallida" || norm === "no_entregado" || norm === "no entregado") return "VISITA_FALLIDA";

  // Estados de progresión.
  if (norm === "etiqueta creada" || norm === "etiqueta_creada") return "ETIQUETA_CREADA";
  if (norm === "colectado" || norm === "recolectado" || norm === "despachado" || norm === "paquete_recolectado" || norm === "paquete recolectado") return "PAQUETE_RECOLECTADO";
  if (norm === "transito" || norm === "en_transito" || norm === "en transito" || norm === "en_transito_a_destino" || norm === "en transito a destino") return "EN_TRANSITO_A_DESTINO";
  if (norm === "en_reparto" || norm === "en reparto" || norm === "en_distribucion" || norm === "en distribucion") return "EN_DISTRIBUCION";

  // EN_SUCURSAL ambiguo: depende de la modalidad del envío.
  if (norm === "en_sucursal" || norm === "en sucursal" || norm === "en_sucursal_de_destino" || norm === "en sucursal de destino") {
    // Si la modalidad indica retiro, es sucursal de entrega.
    if (modalidadEnvio) {
      const modNorm = quitarTildesYNormalizar(modalidadEnvio);
      if (modNorm.includes("retiro en sucursal") || modNorm.includes("retiro en punto")) {
        return "EN_SUCURSAL_DE_ENTREGA";
      }
    }
    return "EN_SUCURSAL_DE_DESTINO";
  }
  if (norm === "en_sucursal_de_entrega" || norm === "en sucursal de entrega") return "EN_SUCURSAL_DE_ENTREGA";

  return null; // string desconocido
}

// ====================================================
// MAPEO ENTRE PLANOS (reglas de transición)
// ====================================================
// Cuando el estado interno determina el estado courier directamente.
// (RETENIDO o BLOQUEADO → sin estado courier porque etiqueta nunca llegó.)

export function getEstadoCourierDesdeInterno(estadoInterno: EstadoInternoKey | null, estadoCourierActual: EstadoCourierKey | null): EstadoCourierKey | null {
  // Si está en RETENIDO o BLOQUEADO, no hay plano courier.
  if (estadoInterno === "RETENIDO" || estadoInterno === "BLOQUEADO") return null;

  // Si está PENDIENTE (etiqueta creada en BD pero no impresa), courier no tiene
  // estado todavía (Shipro generó tracking pero etiqueta no se entregó).
  if (estadoInterno === "PENDIENTE") return null;

  // Si fue IMPRESO o CANCELADO, courier ya puede tener estado.
  // Devolvemos el estado courier actual si existe, sino ETIQUETA_CREADA.
  if (estadoInterno === "IMPRESO" || estadoInterno === "CANCELADO") {
    return estadoCourierActual ?? "ETIQUETA_CREADA";
  }

  return null;
}

// ====================================================
// HELPER PARA DERIVACIÓN AMBOS PLANOS DESDE Envio.estadoActual
// ====================================================
// Dado el campo Envio.estadoActual (single string, legacy) + modalidad,
// retorna tupla [estadoInterno, estadoCourier].
//
// La heurística:
// - Primero intenta interpretar como estado interno.
// - Si no matchea interno, intenta courier.
// - Si matchea courier, el interno se asume IMPRESO (porque solo se reportan
//   estados courier si la etiqueta fue impresa).

export function derivarPlanos(envioEstadoActual: string | null | undefined, modalidadEnvio?: string | null): {
  interno: EstadoInternoKey | null;
  courier: EstadoCourierKey | null;
} {
  // Intento 1: ¿es estado interno?
  const interno = normalizarEstadoInterno(envioEstadoActual);
  if (interno) {
    // Si es interno, derivamos courier por regla.
    const courier = getEstadoCourierDesdeInterno(interno, null);
    return { interno, courier };
  }

  // Intento 2: ¿es estado courier?
  const courier = normalizarEstadoCourier(envioEstadoActual, modalidadEnvio);
  if (courier) {
    // Si es courier, asumimos plano interno IMPRESO.
    return { interno: "IMPRESO", courier };
  }

  // Caso fallback: string desconocido. Default razonable.
  return { interno: "IMPRESO", courier: "ETIQUETA_CREADA" };
}

// ====================================================
// UTILIDADES DE DISPLAY
// ====================================================

export function displayInterno(key: EstadoInternoKey | null): string {
  if (!key) return "—";
  return ESTADOS_INTERNOS[key].display;
}

export function displayCourier(key: EstadoCourierKey | null): string {
  if (!key) return "—";
  return ESTADOS_COURIER[key].display;
}
