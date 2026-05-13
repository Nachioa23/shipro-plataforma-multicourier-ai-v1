// ==========================================================================
// DEUDA 29 Sub-fase 2.B.0 — Geocodificación de direcciones vía Google Maps.
//
// Helper puro (sin Prisma, sin side-effects más allá del fetch + logs).
// Recibe los campos de una dirección argentina y devuelve { latitud, longitud }
// o null si Google no puede resolverla. NUNCA lanza — todos los caminos de
// error son `return null` con log para visibilidad.
//
// Usado por:
//   - app/api/depositos/route.ts (POST: geocoding al crear)
//   - app/api/depositos/[id]/route.ts (PUT: re-geocoding si cambia la dirección)
//   - scripts/backfill-coordenadas-depositos.ts (backfill de filas legacy)
// ==========================================================================

interface GeocodificarParams {
  direccionCalle: string;
  direccionAltura: string;
  codigoPostal: string;
  localidad: string;
  provincia: string;
  pais?: string;
}

interface Coordenadas {
  latitud: number;
  longitud: number;
}

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const TIMEOUT_MS = 5000;

export async function geocodificarDireccion(params: GeocodificarParams): Promise<Coordenadas | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("[geo] ERROR: GOOGLE_MAPS_API_KEY no configurada en el entorno. Geocoding deshabilitado.");
    return null;
  }

  const pais = params.pais || "Argentina";
  const direccionLegible = `${params.direccionCalle} ${params.direccionAltura}, ${params.codigoPostal} ${params.localidad}, ${params.provincia}, ${pais}`;

  // components=country:AR previene falsos positivos en nombres compartidos
  // ("Córdoba" existe en Argentina y España, "Mendoza" en Argentina y Estados Unidos, etc.).
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(direccionLegible)}&components=country:AR&key=${apiKey}`;

  // Timeout via AbortController. 5s es suficiente para Google Geocoding
  // típicamente (~200-500ms) sin colgar la creación del depósito si el servicio cae.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.warn(`[geo] WARN: timeout ${TIMEOUT_MS}ms al geocodificar "${direccionLegible}".`);
    } else {
      console.error(`[geo] ERROR: fallo de red al geocodificar "${direccionLegible}": ${e.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    console.warn(`[geo] WARN: HTTP ${response.status} ${response.statusText} al geocodificar "${direccionLegible}".`);
    return null;
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e: any) {
    console.error(`[geo] ERROR: response no es JSON válido para "${direccionLegible}": ${e.message}`);
    return null;
  }

  const status = data?.status;

  if (status === "OK" && Array.isArray(data.results) && data.results.length > 0) {
    const loc = data.results[0]?.geometry?.location;
    const lat = typeof loc?.lat === "number" ? loc.lat : NaN;
    const lng = typeof loc?.lng === "number" ? loc.lng : NaN;
    if (!isFinite(lat) || !isFinite(lng)) {
      console.warn(`[geo] WARN: respuesta OK pero lat/lng inválidos para "${direccionLegible}".`);
      return null;
    }
    console.log(`[geo] OK: "${direccionLegible}" → ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    return { latitud: lat, longitud: lng };
  }

  if (status === "ZERO_RESULTS") {
    console.warn(`[geo] WARN: ZERO_RESULTS para "${direccionLegible}".`);
    return null;
  }

  if (status === "OVER_QUERY_LIMIT" || status === "REQUEST_DENIED" || status === "INVALID_REQUEST") {
    console.error(`[geo] ERROR: status=${status} para "${direccionLegible}". errorMessage=${data?.error_message || "(sin detalle)"}`);
    return null;
  }

  console.warn(`[geo] WARN: status desconocido "${status}" para "${direccionLegible}".`);
  return null;
}
