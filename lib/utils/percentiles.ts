// ============================================================================
// HELPER DE PERCENTILES Y ESTADISTICOS — Torre de Control (DEUDA 39)
// ============================================================================
//
// Calcula percentiles y estadisticos agregados sobre arrays de numeros.
// Diseñado para alimentar metricas de la Torre de Control que requieren
// medianas, P95, promedios y deteccion de outliers (P50/P95) sobre ventanas
// temporales de envios, tickets, eventos, etc.
//
// Razon de existir:
//   - SQLite (motor de BD del proyecto) NO soporta PERCENTILE_CONT/DISC
//     nativos. Los percentiles se computan en aplicacion.
//   - Multiples metricas de la Torre de Control necesitan la misma logica
//     (2.1 Tiempos Colecta, 2.2 Efectividad, 4.4 Salud Financiera, 5.1 NPS).
//     Centralizar evita duplicacion.
//
// Convencion de honestidad estadistica:
//   - Si la muestra es menor al umbral minimo, devuelve null.
//   - El frontend debe comunicar "muestra insuficiente" en lugar de mostrar
//     numeros engañosos. Es consistente con el principio "Honestidad en
//     estado vacio" del documento maestro Torre de Control.
//
// Ejemplo de uso:
//   const horasDespacho = envios.map(e => (e.fechaColecta - e.fechaImpresion) / 3600000);
//   const stats = calcularEstadisticos(horasDespacho, 1);
//   if (stats === null) {
//     // muestra insuficiente
//   } else {
//     console.log(`Mediana: ${stats.p50}h, P95: ${stats.p95}h`);
//   }
// ============================================================================

export interface EstadisticosResult {
  p50: number;       // Mediana (caso tipico)
  p95: number;       // Percentil 95 (peor caso razonable)
  promedio: number;  // Media aritmetica
  min: number;       // Valor minimo en la muestra
  max: number;       // Valor maximo en la muestra
  cantidad: number;  // Tamaño de la muestra
}

/**
 * Calcula estadisticos agregados (P50, P95, promedio, min, max, cantidad)
 * sobre un array de numeros.
 *
 * Devuelve null si:
 *   - El array esta vacio.
 *   - El array tiene menos elementos que el umbral minimo configurado.
 *
 * No modifica el array de entrada (clona y ordena internamente).
 *
 * @param valores Array de numeros sobre el cual calcular estadisticos.
 * @param umbralMinimo Cantidad minima de elementos para considerar la muestra
 *                     suficiente. Default 1 (cualquier muestra no vacia).
 *                     Para metricas con significancia estadistica (ej: NPS),
 *                     conviene un umbral mayor (ej: 30).
 * @returns EstadisticosResult con los 6 estadisticos, o null si muestra insuficiente.
 */
export function calcularEstadisticos(
  valores: number[],
  umbralMinimo: number = 1
): EstadisticosResult | null {
  if (!Array.isArray(valores) || valores.length < umbralMinimo) {
    return null;
  }

  // Clonar y ordenar ascendente. No mutar el input.
  const ordenados = [...valores].sort((a, b) => a - b);
  const n = ordenados.length;

  // Percentiles por indexacion. Para n pequeño esto es suficiente.
  // Para muestras gigantes habria que interpolar, pero no es el caso aqui.
  const indiceP50 = Math.floor(n * 0.5);
  const indiceP95 = Math.floor(n * 0.95);

  // Indices seguros: si n=1, indiceP95 podria ser 0 (por floor de 0.95).
  // Math.min evita out-of-bounds en casos limite.
  const p50 = ordenados[Math.min(indiceP50, n - 1)];
  const p95 = ordenados[Math.min(indiceP95, n - 1)];

  // Suma para promedio. Reduce sobre el ordenado (mismo resultado que sobre
  // el original; lo hacemos sobre el ordenado para no recorrer 2 veces).
  const suma = ordenados.reduce((acc, val) => acc + val, 0);
  const promedio = suma / n;

  return {
    p50,
    p95,
    promedio,
    min: ordenados[0],
    max: ordenados[n - 1],
    cantidad: n,
  };
}

/**
 * Helper de conveniencia para formatear un valor en horas de manera
 * adaptativa: si el valor supera 48 horas, lo muestra en dias con 1 decimal.
 * Sino, en horas con 0 decimales.
 *
 * Usado por componentes UI de la Torre de Control para presentar tiempos
 * de manera intuitiva.
 *
 * Ejemplos:
 *   formatearHoras(34)   => "34h"
 *   formatearHoras(76)   => "3.2 dias"
 *   formatearHoras(0.5)  => "1h" (redondea hacia arriba para evitar "0h")
 *
 * @param horas Valor en horas.
 * @returns String formateado para display.
 */
export function formatearHoras(horas: number): string {
  if (horas < 1) return "1h";
  if (horas < 48) return `${Math.round(horas)}h`;
  const dias = horas / 24;
  return `${dias.toFixed(1)} dias`;
}
