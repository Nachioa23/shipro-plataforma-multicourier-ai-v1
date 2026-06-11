// ============================================================================
// HELPER — NPS Cliente Empresa (Metrica 1.3)
//
// El gerente/operador de cada empresa cliente Shipro califica trimestralmente
// a Shipro como plataforma logistica. NPS clasico 0-10 con 4 preguntas
// complementarias (Q2 satisfaccion plataforma, Q3 calidad soporte, Q4
// fortaleza, Q5 sugerencia).
//
// Fuente de data: EncuestaNPSEmpresa (poblada via cron disparador + POST
// del usuario desde el form publico).
//
// DECISION CLAVE (director 2026-06-11): ponderacion por empresa.
// Cada empresa pesa igual en el NPS global sin importar cuantos usuarios
// voten. Razon: empresas grandes con 10 usuarios no deben distorsionar
// el NPS global vs empresas chicas con 1 usuario.
//
// Calculo del NPS global ponderado:
// 1. Agrupar votos por empresaId.
// 2. Para cada empresa, calcular su NPS interno (sobre sus votos).
// 3. Promediar los NPS de cada empresa = NPS global ponderado.
//
// Complementariamente exponemos npsScoreRaw (sobre todos los votos
// individuales) para comparacion analitica.
// ============================================================================

export const SCORE_DETRACTOR_MAX = 6;
export const SCORE_PASIVO_MAX = 8;

export type CategoriaNPS = "PROMOTOR" | "PASIVO" | "DETRACTOR";

export function clasificarScore(score: number): CategoriaNPS {
  if (score <= SCORE_DETRACTOR_MAX) return "DETRACTOR";
  if (score <= SCORE_PASIVO_MAX) return "PASIVO";
  return "PROMOTOR";
}

export interface EncuestaVotada {
  score: number;
  categoria: string;
  empresaId: number;
  satisfaccionPlataforma: number | null;
  calidadSoporte: number | null;
}

export interface ResumenNPSEmpresa {
  totalEncuestasEnviadas: number;
  totalEncuestasVotadas: number;
  totalEmpresasConVoto: number;
  tasaRespuesta: number;  // % votadas / enviadas

  // NPS ponderado por empresa (principal segun decision director D2-B).
  npsScorePonderado: number;  // -100 a +100

  // NPS raw (sin ponderar, complementario).
  npsScoreRaw: number;
  scorePromedioRaw: number;  // 0-10

  // Cantidades raw.
  totalPromotores: number;
  totalPasivos: number;
  totalDetractores: number;

  // Satisfacciones complementarias (promedios sobre votos validos).
  satisfaccionPlataformaPromedio: number | null;
  calidadSoportePromedio: number | null;

  periodo: string;
}

function calcularNPSDeGrupo(votos: EncuestaVotada[]): number {
  if (votos.length === 0) return 0;
  let p = 0, d = 0;
  for (const v of votos) {
    if (v.categoria === "PROMOTOR") p++;
    else if (v.categoria === "DETRACTOR") d++;
  }
  const pPct = (p / votos.length) * 100;
  const dPct = (d / votos.length) * 100;
  return Math.round(pPct - dPct);
}

export function calcularNPSEmpresa(
  encuestas: EncuestaVotada[],
  totalEnviadas: number,
  periodo: string
): ResumenNPSEmpresa {
  const votadas = encuestas.length;

  if (votadas === 0) {
    return {
      totalEncuestasEnviadas: totalEnviadas,
      totalEncuestasVotadas: 0,
      totalEmpresasConVoto: 0,
      tasaRespuesta: totalEnviadas > 0 ? 0 : 0,
      npsScorePonderado: 0,
      npsScoreRaw: 0,
      scorePromedioRaw: 0,
      totalPromotores: 0,
      totalPasivos: 0,
      totalDetractores: 0,
      satisfaccionPlataformaPromedio: null,
      calidadSoportePromedio: null,
      periodo,
    };
  }

  // Agregaciones raw.
  let promotores = 0, pasivos = 0, detractores = 0;
  let sumaScores = 0;
  let sumaSatisfaccion = 0, countSatisfaccion = 0;
  let sumaSoporte = 0, countSoporte = 0;

  for (const e of encuestas) {
    sumaScores += e.score;
    if (e.categoria === "PROMOTOR") promotores++;
    else if (e.categoria === "PASIVO") pasivos++;
    else if (e.categoria === "DETRACTOR") detractores++;

    if (e.satisfaccionPlataforma !== null) {
      sumaSatisfaccion += e.satisfaccionPlataforma;
      countSatisfaccion++;
    }
    if (e.calidadSoporte !== null) {
      sumaSoporte += e.calidadSoporte;
      countSoporte++;
    }
  }

  const promotoresPct = (promotores / votadas) * 100;
  const detractoresPct = (detractores / votadas) * 100;
  const npsScoreRaw = Math.round(promotoresPct - detractoresPct);
  const scorePromedioRaw = Math.round((sumaScores / votadas) * 10) / 10;

  // NPS ponderado por empresa: agrupar y promediar.
  const porEmpresa = new Map<number, EncuestaVotada[]>();
  for (const e of encuestas) {
    if (!porEmpresa.has(e.empresaId)) porEmpresa.set(e.empresaId, []);
    porEmpresa.get(e.empresaId)!.push(e);
  }

  const npsPorEmpresa: number[] = [];
  for (const [, votosEmpresa] of porEmpresa) {
    npsPorEmpresa.push(calcularNPSDeGrupo(votosEmpresa));
  }

  const npsScorePonderado = npsPorEmpresa.length > 0
    ? Math.round(npsPorEmpresa.reduce((a, b) => a + b, 0) / npsPorEmpresa.length)
    : 0;

  return {
    totalEncuestasEnviadas: totalEnviadas,
    totalEncuestasVotadas: votadas,
    totalEmpresasConVoto: porEmpresa.size,
    tasaRespuesta: totalEnviadas > 0
      ? Math.round((votadas / totalEnviadas) * 1000) / 10
      : 0,
    npsScorePonderado,
    npsScoreRaw,
    scorePromedioRaw,
    totalPromotores: promotores,
    totalPasivos: pasivos,
    totalDetractores: detractores,
    satisfaccionPlataformaPromedio: countSatisfaccion > 0
      ? Math.round((sumaSatisfaccion / countSatisfaccion) * 10) / 10
      : null,
    calidadSoportePromedio: countSoporte > 0
      ? Math.round((sumaSoporte / countSoporte) * 10) / 10
      : null,
    periodo,
  };
}

export interface NPSPorEmpresa {
  empresaId: number;
  empresaNombre: string;
  totalVotos: number;
  npsScore: number;
  scorePromedio: number;
  promotores: number;
  pasivos: number;
  detractores: number;
}

export function calcularNPSPorEmpresa(
  encuestas: (EncuestaVotada & { empresaNombre: string })[]
): NPSPorEmpresa[] {
  const mapa = new Map<number, (EncuestaVotada & { empresaNombre: string })[]>();

  for (const e of encuestas) {
    if (!mapa.has(e.empresaId)) mapa.set(e.empresaId, []);
    mapa.get(e.empresaId)!.push(e);
  }

  const resultado: NPSPorEmpresa[] = [];
  for (const [empresaId, votos] of mapa) {
    const npsScore = calcularNPSDeGrupo(votos);
    const sumaScores = votos.reduce((a, b) => a + b.score, 0);
    let p = 0, pas = 0, d = 0;
    for (const v of votos) {
      if (v.categoria === "PROMOTOR") p++;
      else if (v.categoria === "PASIVO") pas++;
      else if (v.categoria === "DETRACTOR") d++;
    }

    resultado.push({
      empresaId,
      empresaNombre: votos[0].empresaNombre,
      totalVotos: votos.length,
      npsScore,
      scorePromedio: Math.round((sumaScores / votos.length) * 10) / 10,
      promotores: p,
      pasivos: pas,
      detractores: d,
    });
  }

  return resultado.sort((a, b) => b.npsScore - a.npsScore);
}
