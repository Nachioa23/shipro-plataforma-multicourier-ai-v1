// ============================================================================
// Normalización de códigos ISO 3166-2:AR → nombre canónico de provincia
// (2026-09-06). WooCommerce/VTEX/Shopify y otros plugins e-commerce mandan
// `shipping_state` como código ISO de 1-2 letras ("B" = Buenos Aires) por
// convención internacional. Los adapters de courier (AndreaniAdapter en particular)
// esperan el nombre COMPLETO en la etiqueta física — sin normalización la
// etiqueta sale con `region: "B"` (dato malo, silent degradation).
//
// Este helper mapea código → nombre canónico, con PASS-THROUGH seguro para
// inputs que ya son nombres completos ("Buenos Aires") o valores desconocidos
// (no rompe envíos que ya mandan bien).
//
// UBICACIÓN: núcleo. Se aplica en `lib/envios/crear.ts` al inicio (post-destructure
// del input), ANTES de que la data fluya a Direccion (BD) + validar-direccion
// (peaje) + dispatch (payload al adapter). Los adapters (Chat B) NO se tocan.
//
// DECISIÓN DE CANONICAL PARA CABA: `"CABA"` (short form) — matchea la fuente de
// verdad ya establecida en `lib/constants/provincias-ar.ts` L11 (PROVINCIAS_AR)
// y el output de `lib/constants/normalizar-provincia.ts` (que canonicaliza
// "Ciudad Autónoma de Buenos Aires" y "Ciudad de Buenos Aires" → "CABA").
// Consistente con el resto del codebase.
//
// FUENTE DEL MAPA: ISO 3166-2:AR (Wikipedia), verificado contra AFIP + Andreani.
// Cerrado, fijo — no cambia. 25 entradas = 24 provincias + CABA.
// ============================================================================

import { PROVINCIAS_AR } from "@/lib/constants/provincias-ar";

// Códigos ISO 3166-2:AR → nombre canónico (según PROVINCIAS_AR).
// Keys en MAYÚSCULAS (canonicaliamos el input a upper antes del lookup).
const CODIGO_ISO_A_PROVINCIA: Record<string, string> = {
  B: "Buenos Aires",
  C: "CABA",
  K: "Catamarca",
  H: "Chaco",
  U: "Chubut",
  X: "Córdoba",
  W: "Corrientes",
  E: "Entre Ríos",
  P: "Formosa",
  Y: "Jujuy",
  L: "La Pampa",
  F: "La Rioja",
  M: "Mendoza",
  N: "Misiones",
  Q: "Neuquén",
  R: "Río Negro",
  A: "Salta",
  J: "San Juan",
  D: "San Luis",
  Z: "Santa Cruz",
  S: "Santa Fe",
  G: "Santiago del Estero",
  V: "Tierra del Fuego",
  T: "Tucumán",
};

// Set de nombres canónicos ya conocidos — usado para reconocer "ya es un nombre
// completo" y devolverlo tal cual sin tocar. Deriva de PROVINCIAS_AR para
// mantener una sola fuente de verdad.
const NOMBRES_CANONICOS = new Set<string>(PROVINCIAS_AR as readonly string[]);

/**
 * Normaliza el input a un nombre canónico de provincia argentina.
 *
 * Reglas:
 *   1. Si el input matchea un CÓDIGO ISO (1 letra, case-insensitive) → devuelve
 *      el nombre canónico ("B" → "Buenos Aires", "b" → "Buenos Aires").
 *   2. Si el input ya es un nombre canónico ("Buenos Aires", "CABA") → lo
 *      devuelve unchanged.
 *   3. Cualquier otro input (null, undefined, string desconocida, nombre
 *      variante tipo "BUENOS AIRES" o "bs as") → PASS-THROUGH unchanged.
 *      No es rol de este helper canonicalizar nombres — para eso ya existe
 *      `lib/constants/normalizar-provincia.ts` (ALIAS con variantes de case+
 *      acento). Este helper es específico para el gap "código → nombre".
 *
 * @param input - Valor de provincia recibido del caller (plugin, form, etc.).
 * @returns Nombre canónico si el input era un código; el input unchanged en
 *          cualquier otro caso.
 */
export function normalizarProvinciaAR(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  const trimmed = input.trim();
  if (trimmed === "") return trimmed;

  // (1) ¿Es un código ISO? Solo aplica a strings de 1 char (los códigos AR son
  //     todos de 1 letra). Códigos multi-char (ej. "AR-B" de ISO extendido)
  //     no se manejan hoy — pass-through. Se podría strippar el prefix "AR-"
  //     acá si algún plugin lo enviara; queda como TODO si aparece el caso.
  if (trimmed.length === 1) {
    const canonico = CODIGO_ISO_A_PROVINCIA[trimmed.toUpperCase()];
    if (canonico) return canonico;
  }

  // (2) ¿Ya es un nombre canónico? Devolver unchanged.
  if (NOMBRES_CANONICOS.has(trimmed)) return trimmed;

  // (3) Pass-through. Cualquier otra cosa (nombre en variante case/acento,
  //     valor desconocido, código de 2+ chars no mapeado). NO rompemos
  //     envíos que ya mandaban bien — el downstream (validar-direccion,
  //     adapter) decide qué hacer con el string.
  return trimmed;
}
