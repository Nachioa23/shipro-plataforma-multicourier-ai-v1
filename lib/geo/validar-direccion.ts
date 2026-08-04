// ==========================================================================
// DEUDA 106 pieza 2 mov 3 (2026-08-04): validación server-side de dirección
// para envío. Extraído del bloque inline en lib/envios/crear.ts (la "regla
// del peaje", líneas 242-305 pre-refactor).
//
// Reproduce EXACTAMENTE los 5 checks del bloque inline, en el mismo orden y
// con los mismos strings, para que el refactor sea behavior-preserving:
//   (a) calle vacía                                → inválida
//   (b) falta altura y no hay palabra clave        → inválida
//   (c) Google ZERO_RESULTS                        → inválida
//   (d) Google OK pero result no-street-level y sin keyword de tolerancia → inválida
//   (e) CP primeros 2 dígitos ≠ CP de Google       → inválida
//
// Otras semánticas preservadas (todas hacían al envío quedar "válido" en el
// inline; se reproducen tal cual):
//   - `GOOGLE_MAPS_API_KEY` no seteada → NO se valida, retorna { valida: true }.
//     Old inline: si no había key, saltaba todo el bloque de Google (Pendiente).
//   - Fetch a Google lanza excepción → console.warn + retorna { valida: true }.
//     Old inline: try/catch, mismo warn, seguía. Falla de API NO bloquea envío.
//   - Google status !== "OK" && !== "ZERO_RESULTS" (OVER_QUERY_LIMIT,
//     REQUEST_DENIED, INVALID_REQUEST, etc.) o "OK" con results vacío → retorna
//     { valida: true }. Old inline no manejaba esos casos → envío Pendiente.
//
// SEMANTIC DELTA vs inline (documentado + intencional):
//   - Env var. Inline leía `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY`.
//     La NEXT_PUBLIC_* se bundlea al browser (leak). Este helper es server-side y
//     usa SÓLO `GOOGLE_MAPS_API_KEY`. En prod donde `GOOGLE_MAPS_API_KEY` está
//     seteada, behavior es idéntico. En un dev env que sólo tenga NEXT_PUBLIC_*
//     seteada, este helper salta la validación (igual comportamiento que el old
//     inline cuando NO había ninguna key configurada).
//
// URL query shape (`?address=...&key=...`, SIN `components=country:AR`):
//   Copiado verbatim del inline. Nota: existe `lib/geo/geocodificar-direccion.ts`
//   con URL similar pero con `components=country:AR`. Ese helper devuelve solo
//   coords, no el raw result con types + address_components que estos checks
//   necesitan — por eso duplicamos el fetch aquí. No mezclamos el `components`
//   guard para preservar parity con el inline (si en el futuro se decide
//   agregarlo, es un cambio de behavior, no un refactor).
// ==========================================================================

interface ValidarDireccionParams {
  calle: string | null | undefined;
  altura: string | number | null | undefined;
  cp: string | number;
  localidad: string | null | undefined;
  provincia: string | null | undefined;
}

// Discriminated union — TypeScript enforce que `motivo` está presente cuando
// `valida: false`. El caller obtiene un string, no un `string | undefined`.
export type ValidarDireccionResult =
  | { valida: true }
  | { valida: false; motivo: string };

// Keyword list — copiada verbatim del inline (líneas 248 pre-refactor).
const KEYWORDS_TOLERANCIA = ["lote", "ruta", "km", "barrio", "manzana", "country", "s/n", "sin numero", "parcela"];

export async function validarDireccionEnvio(
  params: ValidarDireccionParams
): Promise<ValidarDireccionResult> {
  const { calle, altura, cp, localidad, provincia } = params;
  const calleLower = (calle || "").toLowerCase();
  const alturaStr = altura?.toString().trim() || "";
  const tienePalabraClave = KEYWORDS_TOLERANCIA.some((kw) => calleLower.includes(kw));

  // (a) calle vacía
  if (!calle || calle.trim() === "") {
    return { valida: false, motivo: "El nombre de la calle está vacío." };
  }

  // (b) falta altura sin keyword de tolerancia
  if (!alturaStr && !tienePalabraClave) {
    return { valida: false, motivo: "Falta altura y no posee palabras clave de excepción." };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    // Sin key → no se valida en Google. Igual que old inline sin key.
    return { valida: true };
  }

  try {
    const direccionQuery = `${calle} ${alturaStr}, ${localidad}, ${provincia}, Argentina`;
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccionQuery)}&key=${apiKey}`
    );
    const geoData = await geoRes.json();

    // (c) ZERO_RESULTS
    if (geoData.status === "ZERO_RESULTS") {
      return { valida: false, motivo: "Google Maps no pudo ubicar esta dirección en el mapa." };
    }

    // (d) + (e) sólo si Google devolvió resultados usables.
    if (geoData.status === "OK" && geoData.results.length > 0) {
      const primerResultado = geoData.results[0];

      const isStreetLevel =
        primerResultado.types.includes("street_address") ||
        primerResultado.types.includes("route") ||
        primerResultado.types.includes("premise") ||
        primerResultado.types.includes("intersection");

      // (d) result no-street-level y sin keyword
      if (!isStreetLevel && !tienePalabraClave) {
        return {
          valida: false,
          motivo: "La calle no parece ser válida. Google solo encontró la zona o localidad.",
        };
      }

      // (e) CP primeros 2 dígitos ≠ CP de Google
      let cpGoogle = "";
      for (const comp of primerResultado.address_components) {
        if (comp.types.includes("postal_code")) {
          cpGoogle = comp.long_name.replace(/\D/g, "");
        }
      }
      const cpUserLimpio = String(cp).replace(/\D/g, "");
      if (cpGoogle && cpUserLimpio && cpGoogle.substring(0, 2) !== cpUserLimpio.substring(0, 2)) {
        return {
          valida: false,
          motivo: "Discrepancia geográfica: El CP ingresado difiere de la zona real.",
        };
      }
    }

    // Cualquier otro status (OVER_QUERY_LIMIT, REQUEST_DENIED, INVALID_REQUEST,
    // OK con results vacío) → válida. Mismo behavior que old inline.
    return { valida: true };
  } catch (geoErr) {
    // Fetch/API failures NO bloquean creación. Old inline: console.warn, seguía.
    console.warn("Error en Geocoding API.");
    return { valida: true };
  }
}
