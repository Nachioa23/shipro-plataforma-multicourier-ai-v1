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
