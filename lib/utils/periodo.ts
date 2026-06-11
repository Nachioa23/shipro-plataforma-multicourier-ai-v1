// ============================================================================
// HELPER — Periodo trimestral
//
// Convierte fechas a string canonico "YYYY-Qn" para la metrica NPS Cliente
// Empresa. Cadencia trimestral confirmada por director (2026-06-11).
//
// Trimestres canonicos:
// - Q1: enero-marzo (meses 1-3)
// - Q2: abril-junio (meses 4-6)
// - Q3: julio-septiembre (meses 7-9)
// - Q4: octubre-diciembre (meses 10-12)
// ============================================================================

export function calcularPeriodoActual(fecha: Date = new Date()): string {
  const year = fecha.getFullYear();
  const month = fecha.getMonth() + 1;  // getMonth() es 0-indexed
  const trimestre = Math.ceil(month / 3);
  return `${year}-Q${trimestre}`;
}

export function calcularPeriodoAnterior(fecha: Date = new Date()): string {
  const year = fecha.getFullYear();
  const month = fecha.getMonth() + 1;
  const trimestreActual = Math.ceil(month / 3);

  if (trimestreActual === 1) {
    return `${year - 1}-Q4`;
  }
  return `${year}-Q${trimestreActual - 1}`;
}

export function parsearPeriodo(periodo: string): { year: number; trimestre: number } | null {
  const match = periodo.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    trimestre: parseInt(match[2], 10),
  };
}

export function describirPeriodo(periodo: string): string {
  const parsed = parsearPeriodo(periodo);
  if (!parsed) return periodo;

  const meses: Record<number, string> = {
    1: "enero-marzo",
    2: "abril-junio",
    3: "julio-septiembre",
    4: "octubre-diciembre",
  };

  return `${meses[parsed.trimestre]} ${parsed.year}`;
}
