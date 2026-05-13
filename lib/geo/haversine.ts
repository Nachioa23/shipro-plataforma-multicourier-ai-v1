// ==========================================================================
// Cálculo de distancia entre 2 puntos geográficos usando la fórmula de
// Haversine (asumiendo Tierra esférica de radio R = 6371 km).
//
// Función pura, sin side-effects ni dependencias. Reutilizable desde
// cualquier capa (API routes, scripts, helpers).
//
// Nota: la fórmula tiene un error inherente de ~0.5% por la suposición de
// esfericidad (la Tierra es un geoide oblato). Suficiente para ranking
// por cercanía en este contexto. Si en algún momento necesitamos mayor
// precisión (< 0.1%) podemos cambiar a Vincenty.
// ==========================================================================

const RADIO_TIERRA_KM = 6371;

export function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_KM * c;
}
