// =============================================================================
// DEUDA 32+37: Registro de servicios soportados por cada courier (nivel courier).
// =============================================================================
//
// Fuente de verdad de QUE servicios comerciales puede mapear el admin para cada
// courier. Mapea cada codigoServicio al tipoEntrega tecnico que el adapter sabe
// ejecutar HOY. null = el adapter no soporta ese servicio (switch bloqueado en UI).
//
// Se lee SIN instanciar el adapter (no requiere credenciales) — por eso vive en
// un modulo aparte y no como metodo de instancia. Lo consumen: el seed, el
// endpoint admin, y el asistente de alta de courier.
//
// NOTA (DEUDA futura — rediseno de taxonomia de tipos de entrega): el modelo
// actual de tipoEntrega (domicilio/sucursal/inversa/cambio/devolucion) mezcla
// conceptos. El modelo correcto seria 3 grupos (domicilio/sucursal/inversa) con
// subtipos. Cuando se rediseñe, este mapeo apunta a la nueva taxonomia. Por
// ahora apunta al tipoEntrega vigente.
//
// NOTA (DEUDA futura — espacio cliente): este registro es nivel-courier (que
// ofrece Shipro). La disponibilidad por cliente (interseccion con los contratos
// de cada cliente, Modelo A/B) es una capa distinta que vive en CredencialCourier.
//
// inversa_devolucion_dropoff_sucursal mapea a "sucursal" (no a "devolucion")
// porque es una composicion: reutiliza el contrato sucursal->domicilio en sentido
// inverso. Requiere que el courier tenga sucursales.
// =============================================================================

import { normalizarParaComparacion } from "./normalizar";

// Nombres de display por courier (lo que ve el admin en la UI). Las keys son
// los nombres canonicos normalizados (mismas que SERVICIOS_SOPORTADOS). Cuando
// se integre un courier nuevo: agregar aca su display + adapter + servicios.
export const NOMBRES_DISPLAY: Record<string, string> = {
  andreani: "Andreani",
  mocis: "Moci's",
};

// Helper: devuelve el nombre de display de un courier, con fallback a la
// version capitalizada del canonico si no esta mapeado (defensa).
export function displayCourier(nombreCanonico: string): string {
  return (
    NOMBRES_DISPLAY[nombreCanonico] ??
    nombreCanonico.charAt(0).toUpperCase() + nombreCanonico.slice(1)
  );
}

// Codigos de los 8 servicios comerciales (identificadores estables).
export const CODIGOS_SERVICIO = [
  "entrega_domicilio_estandar",
  "entrega_domicilio_express",
  "entrega_sucursal",
  "entrega_punto_retiro",
  "entrega_elocker",
  "inversa_cambio",
  "inversa_devolucion_retiro_domicilio",
  "inversa_devolucion_dropoff_sucursal",
] as const;

export type CodigoServicio = (typeof CODIGOS_SERVICIO)[number];

// Labels en espanol para mostrar en UI. Conviven con los codigos (fuente unica
// de verdad). Cuando se agrega un servicio nuevo, se actualizan ambos juntos.
export const LABELS_SERVICIO: Record<CodigoServicio, string> = {
  entrega_domicilio_estandar: "Entrega a domicilio (Estandar)",
  entrega_domicilio_express: "Entrega a domicilio (Express)",
  entrega_sucursal: "Entrega en sucursal",
  entrega_punto_retiro: "Entrega en punto de retiro",
  entrega_elocker: "Entrega en e-locker",
  inversa_cambio: "Cambio",
  inversa_devolucion_retiro_domicilio: "Devolucion con retiro a domicilio",
  inversa_devolucion_dropoff_sucursal: "Devolucion con drop-off en sucursal",
};

// Helper: devuelve el label de un codigo, o el codigo crudo si no esta mapeado
// (defensa para codigos viejos/desconocidos sin romper la UI).
export function labelServicio(codigo: string): string {
  return LABELS_SERVICIO[codigo as CodigoServicio] ?? codigo;
}

// Mapeo por courier: codigoServicio -> capacidad tecnica (tipoEntrega) | null.
// null = el adapter no soporta ese servicio (candado en UI).
// La clave es el nombre canonico del courier (igual que CourierFactory).
export const SERVICIOS_SOPORTADOS: Record<string, Partial<Record<CodigoServicio, string | null>>> = {
  andreani: {
    entrega_domicilio_estandar: "domicilio",
    entrega_domicilio_express: null,
    entrega_sucursal: "sucursal",
    entrega_punto_retiro: null,
    entrega_elocker: null,
    inversa_cambio: "cambio",
    inversa_devolucion_retiro_domicilio: "devolucion",
    inversa_devolucion_dropoff_sucursal: "sucursal",
  },
  mocis: {
    entrega_domicilio_estandar: "domicilio",
    entrega_domicilio_express: null,
    entrega_sucursal: null,
    entrega_punto_retiro: null,
    entrega_elocker: null,
    inversa_cambio: "cambio",
    inversa_devolucion_retiro_domicilio: "devolucion",
    inversa_devolucion_dropoff_sucursal: null,
  },
};

// Devuelve la capacidad tecnica mapeada para un courier+servicio, o null si no
// esta soportado. Usa normalizarParaComparacion (misma normalizacion que
// CourierFactory) para tolerar apostrofes/acentos/espacios: "Moci's" -> "mocis".
export function capacidadTecnica(
  courierNombre: string,
  codigoServicio: string
): string | null {
  const mapa = SERVICIOS_SOPORTADOS[normalizarParaComparacion(courierNombre)];
  if (!mapa) return null;
  return mapa[codigoServicio as CodigoServicio] ?? null;
}

// Devuelve true si el courier tiene declarado soporte para el servicio.
export function soportaServicio(courierNombre: string, codigoServicio: string): boolean {
  return capacidadTecnica(courierNombre, codigoServicio) !== null;
}
