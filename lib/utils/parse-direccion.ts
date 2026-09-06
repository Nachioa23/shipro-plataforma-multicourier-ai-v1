// ============================================================================
// Helper: parseAltura(calle) → { calle, altura } (2026-09-06)
// ============================================================================
// Extrae la altura numérica desde el string `calle` cuando el caller (plugin,
// checkout) manda todo junto. WooCommerce por default no separa street/number
// — envía `shipping_address_1: "Rector Eufemio Uballes 6802"` con `address_2`
// típicamente vacío o con "Depto 4B". Andreani (y la mayoría de los adapters)
// necesitan altura separada para armar la etiqueta física.
//
// FILOSOFÍA: CONSERVADOR. Extrae la altura SOLO cuando puede identificarla con
// confianza razonable. Cuando el string es ambiguo → devuelve `altura: null`
// → el flow de crear.ts deja altura vacía → validar-direccion.ts:71-74 dispara
// RETENIDO por peaje (Google Maps + check "falta altura + sin keyword") → el
// comprador corrige via link. UNA ALTURA INCORRECTA EN LA ETIQUETA FÍSICA ES
// PEOR QUE UN RETENIDO — el paquete no llega. RETENIDO es 100% recuperable
// (mail al comprador con link autoservicio).
//
// REGLAS (por orden de aplicación):
//
//   1. Detectar "S/N", "s/n", "sin número" → altura null (calle sin altura
//      por diseño; validar-direccion tolera con la keyword "s/n"/"sin numero"
//      y el envío pasa sin altura al adapter).
//
//   2. Detectar "km"/"kilómetro" (rutas rurales, ej. "Ruta 8 Km 5") → altura
//      null. El "5" NO es altura de calle urbana — es un marker de kilómetro
//      en ruta. validar-direccion también tiene "km" como keyword tolerada.
//
//   3. Strip de suffix de piso/depto/oficina antes de extraer el número:
//      "Av. Corrientes 1234 Piso 5" → strip "Piso 5" → "Av. Corrientes 1234"
//      Sin strip, la regex trailing-number tomaría "5" (el piso) en vez de
//      "1234" (la altura real). Keywords manejados: Piso / PB / Planta Baja /
//      Depto / Dpto / Dep / Of / Oficina / Casa / Torre / Unidad / Apto / Apt
//      / Bloque / Edif(icio) — cada uno seguido opcionalmente de un
//      identificador (número o combo alfanumérico tipo "4B").
//
//   4. Extraer el último grupo de dígitos consecutivos como altura candidata.
//      Si no hay ningún dígito → altura null.
//
//   5. Calcular `calle limpia` = original sin el número extraído + suffix.
//      Trim + collapse spaces.
//
//   6. Bias conservador para nombres de calle numéricos: si `calle limpia`
//      es EXACTAMENTE 1 token Y ese token es una "palabra genérica de calle"
//      (Calle / Avenida / Av / Bv / Boulevard / Ruta), es probable que el
//      número extraído sea parte del NOMBRE de la calle (ej. "Calle 50" en
//      La Plata), no la altura. → altura null.
//
//      Casos que PASAN esta regla:
//        "Rivadavia 100" → calle limpia "Rivadavia" (1 token específico) → OK
//        "Rector Eufemio Uballes 6802" → 3 tokens → OK
//        "25 de Mayo 100" → "25 de Mayo" (3 tokens) → OK
//      Casos que la regla RECHAZA (bias RETENIDO):
//        "Calle 50" → "Calle" (1 token genérico) → altura null
//        "Avenida 9" → "Avenida" (1 token genérico) → altura null
//        "Boulevard 25" → "Boulevard" (1 token genérico) → altura null
//        "Ruta 8" → detectado antes en regla 2 (contiene "ruta"), pero por
//                  las dudas queda cubierto también acá.
//
//   7. Si calle limpia queda vacía (input era solo un número) → altura null.
//      Sin nombre de calle no hay dirección válida.
//
// EJEMPLOS ESPERADOS (tests mentales — no unit tests reales acá):
//   "Rector Eufemio Uballes 6802"    → { calle: "Rector Eufemio Uballes", altura: "6802" }
//   "Av. Corrientes 1234 Piso 5"     → { calle: "Av. Corrientes",          altura: "1234" }
//   "Av. Corrientes 1234 Depto 4B"   → { calle: "Av. Corrientes",          altura: "1234" }
//   "9 de Julio 500 PB"              → { calle: "9 de Julio",              altura: "500"  }
//   "Ruta 8 Km 5"                    → { calle: <input unchanged>,          altura: null   }
//   "Rivadavia S/N"                  → { calle: <input unchanged>,          altura: null   }
//   "Calle 50"                       → { calle: <input unchanged>,          altura: null   }
//   "Rivadavia 100"                  → { calle: "Rivadavia",               altura: "100"  }
//   ""                               → { calle: "",                        altura: null   }
//   "6802"                           → { calle: <input unchanged>,          altura: null   } (todo número, sin nombre)
//
// UBICACIÓN: núcleo (lib/utils/). Aplicado en `lib/envios/crear.ts` post-
// destructure del input, SOLO si el caller mandó altura vacía y calle con
// contenido. Los adapters (Chat B) reciben altura ya extraída — nunca se
// tocan.
// ============================================================================

// Palabras genéricas de calle que indican "el número que sigue es probable
// nombre, no altura". Todo en lowercase para matching case-insensitive.
const PALABRAS_GENERICAS_CALLE = new Set<string>([
  "calle",
  "av",
  "av.",
  "avenida",
  "avda",
  "avda.",
  "bv",
  "bv.",
  "boulevard",
  "blvd",
  "blvd.",
  "ruta",
]);

// Regex para detectar suffix de piso/depto al final del string. Match:
// espacio + keyword + espacio opcional + identificador opcional (alfanum + "-")
// hasta fin de string. Case-insensitive.
const REGEX_SUFFIX_PISO_DEPTO = /\s+(piso|pb|planta\s+baja|depto?|dpto|dep|of\.?|oficina|casa|torre|unidad|apto|apt|bloque|block|edif(?:icio)?)\.?(?:\s+[\wáéíóúñ0-9-]+)?\s*$/i;

// Regex para detectar "S/N" o "sin número". Boundary + variantes.
const REGEX_SIN_NUMERO = /\b(?:s\/?n\.?|sin\s+n[uú]mero)\b/i;

// Regex para detectar "km"/"kilómetro" (rutas). Boundary.
const REGEX_KM = /\b(?:km|kil[oó]metro)\b/i;

// Regex para extraer el último grupo de dígitos consecutivos.
const REGEX_TRAILING_NUMBER = /(\d+)(?:\D*)$/;

export interface ParsedDireccion {
  /** Calle sin el número (y sin el suffix piso/depto si se strippeó). */
  calle: string;
  /** Altura extraída, o null si no se pudo determinar con confianza. */
  altura: string | null;
}

/**
 * Parsea la altura desde el string `calle`. Conservador — devuelve null
 * cuando el input es ambiguo. Ver comentarios de reglas arriba.
 */
export function parseAltura(calleInput: string): ParsedDireccion {
  const trimmed = (calleInput ?? "").trim();
  if (trimmed === "") {
    return { calle: "", altura: null };
  }

  // Regla 1: "S/N" o "sin número" → sin altura por diseño.
  if (REGEX_SIN_NUMERO.test(trimmed)) {
    return { calle: trimmed, altura: null };
  }

  // Regla 2: "Km" o "kilómetro" → dirección rural, número es marker de km
  // no altura urbana.
  if (REGEX_KM.test(trimmed)) {
    return { calle: trimmed, altura: null };
  }

  // Regla 3: strip de suffix piso/depto/etc. Iterativo por si el input tiene
  // dos suffixes (raro pero posible, ej. "Av. X 100 Piso 5 Depto B").
  let sinSuffix = trimmed;
  for (let i = 0; i < 3; i++) {
    const next = sinSuffix.replace(REGEX_SUFFIX_PISO_DEPTO, "").trim();
    if (next === sinSuffix) break;
    sinSuffix = next;
  }

  // Regla 4: extraer el último grupo de dígitos.
  const match = sinSuffix.match(REGEX_TRAILING_NUMBER);
  if (!match) {
    return { calle: trimmed, altura: null };
  }
  const altura = match[1];

  // Regla 5: calle limpia = sinSuffix sin el número al final. Trim + collapse.
  const calleLimpia = sinSuffix.slice(0, sinSuffix.lastIndexOf(altura))
    .replace(/[,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Regla 7: sin nombre de calle (input era solo un número) → null.
  if (calleLimpia === "") {
    return { calle: trimmed, altura: null };
  }

  // Regla 6: bias conservador para calles con nombre numérico.
  const tokens = calleLimpia.split(/\s+/);
  if (tokens.length === 1 && PALABRAS_GENERICAS_CALLE.has(tokens[0].toLowerCase())) {
    return { calle: trimmed, altura: null };
  }

  return { calle: calleLimpia, altura };
}
