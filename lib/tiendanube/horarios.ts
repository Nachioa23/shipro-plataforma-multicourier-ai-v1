// =============================================================================
// DEUDA 144 — Traductor de horarios de sucursal.
// =============================================================================
// Convierte texto libre en español (Andreani) al formato estructurado que
// Tiendanube exige en rates de pickup (day 0-6 + start/end "HHMM"). El texto de
// entrada viene de SucursalCourier.horariosJson, que se popula VERBATIM de la
// respuesta de la API de Andreani (lib/sucursales/sync.ts: horariosJson =
// suc.horarioDeAtencion). En rates type=pickup, Tiendanube exige `hours` con al
// menos UNA franja — si falta o está vacío, la rate se descarta silenciosamente.
//
// COBERTURA REAL medida sobre 151 sucursales cargadas localmente:
//   - 13 valores distintos, 149 caen en UN patrón regular
//       ("Lunes a viernes de HH:MM a HH:MM [–|-] Sábados[ de]? HH:MM a HH:MM[Hs]")
//   - 1 caso con doble franja lun-vie ("... 10:00 a 14:00 y 18:00 a 22:00")
//   - 1 outlier sin día explícito ("9 a 17hs") → cae al genérico
//   - 3 sucursales sin horariosJson → caen al genérico
//
// NOMBRE ENGAÑOSO: la columna se llama horariosJson pero NUNCA fue JSON — es
// texto libre humano-legible tal como Andreani lo publica. Se conserva el nombre
// por retrocompatibilidad con las escrituras existentes.
//
// Andreani no publica domingos ni feriados; el parser NO intenta inferirlos.
// Días que no aparecen en el texto quedan implícitamente cerrados (Tiendanube
// interpreta ausencia como "cerrado ese día").
// =============================================================================

export interface HorarioTiendanube {
  /** Día de la semana en la convención de Tiendanube: 0=domingo .. 6=sábado. */
  day: number;
  /** Hora de apertura como "HHMM" (24h, cero-padded, sin dos-puntos). */
  start: string;
  /** Hora de cierre como "HHMM". */
  end: string;
}

/**
 * Fallback genérico: Lun-Vie 09:00-18:00, Sáb 09:00-13:00. Referencia razonable
 * para sucursales sin horario cargado o con un texto que no se pudo traducir
 * — Tiendanube exige al menos una franja para que la rate de pickup no se
 * descarte, así que preferimos publicar horarios de referencia antes que dejar
 * la sucursal fuera del checkout.
 */
export const HORARIOS_GENERICOS: HorarioTiendanube[] = [
  { day: 1, start: "0900", end: "1800" },
  { day: 2, start: "0900", end: "1800" },
  { day: 3, start: "0900", end: "1800" },
  { day: 4, start: "0900", end: "1800" },
  { day: 5, start: "0900", end: "1800" },
  { day: 6, start: "0900", end: "1300" },
];

/**
 * Extrae TODAS las franjas horarias "HH(:MM)? a HH(:MM)?" de un segmento de
 * texto ya normalizado (lowercase, en-dash normalizado, espacios colapsados).
 * Si la hora viene sin minutos ("9 a 17"), asume ":00". Padea a 2 dígitos.
 * Devuelve [] si el segmento no contiene ningún rango.
 */
function extraerFranjas(segmento: string): { start: string; end: string }[] {
  const franjas: { start: string; end: string }[] = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*a\s*(\d{1,2})(?::(\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segmento)) !== null) {
    const start = m[1].padStart(2, "0") + (m[2] ?? "00");
    const end = m[3].padStart(2, "0") + (m[4] ?? "00");
    franjas.push({ start, end });
  }
  return franjas;
}

/**
 * Traduce el texto libre de horarios a franjas estructuradas de Tiendanube.
 *
 * Estrategia (aprovecha lo regular del formato Andreani):
 *   1. Normaliza: lowercase, en-dash (U+2013) → hyphen, colapsa espacios.
 *   2. Segmento "lunes a viernes ... [antes de sábado o fin]" → días 1..5.
 *   3. Segmento "sábado(s) ... [hasta fin]" → día 6.
 *   4. Extrae TODAS las franjas de cada segmento (soporta doble turno del tipo
 *      "10:00 a 14:00 y 18:00 a 22:00" — el "y" no interrumpe el regex).
 *   5. Si no se extrae ninguna franja con día explícito → HORARIOS_GENERICOS.
 *
 * NO adivina días para textos sin marcador (ej. "9 a 17hs"): caen al genérico.
 * NO publica domingos/feriados (Andreani no los expone).
 *
 * @param texto - Contenido de SucursalCourier.horariosJson (puede ser null).
 * @returns Franjas ya en formato Tiendanube (orden no garantizado; el API acepta cualquier orden).
 */
export function parsearHorarios(texto: string | null | undefined): HorarioTiendanube[] {
  if (!texto || !texto.trim()) return HORARIOS_GENERICOS;
  const norm = texto
    .toLowerCase()
    .replace(/–/g, "-") // en-dash → hyphen (unifica separadores del corpus real)
    .replace(/\s+/g, " ")
    .trim();

  const resultado: HorarioTiendanube[] = [];

  // Segmento lunes-a-viernes: capturamos entre "lunes a viernes" y "sábado" (o fin).
  // Non-greedy para que si el texto trae después "sábados ...", no se lo devore.
  const lunVie = norm.match(/lunes a viernes(.*?)(?=s[áa]bado|$)/);
  if (lunVie) {
    for (const f of extraerFranjas(lunVie[1])) {
      for (const dia of [1, 2, 3, 4, 5]) resultado.push({ day: dia, start: f.start, end: f.end });
    }
  }

  // Segmento sábado(s): desde el token hasta el fin del texto.
  const sab = norm.match(/s[áa]bados?(.*)$/);
  if (sab) {
    for (const f of extraerFranjas(sab[1])) {
      resultado.push({ day: 6, start: f.start, end: f.end });
    }
  }

  return resultado.length > 0 ? resultado : HORARIOS_GENERICOS;
}
