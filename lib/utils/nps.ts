// ============================================================================
// HELPER — NPS Comprador (Metrica 1.2)
//
// El comprador final del e-commerce recibe un email post-entrega con una
// grilla 0-10 para puntuar su experiencia. Cada voto se persiste como
// EncuestaNPS con categoria (PROMOTOR/PASIVO/DETRACTOR), comentario
// libre + 4 dimensiones de contexto (experienciaEntrega, satisfaccion
// producto, probabilidadRecompra, sugerenciaMejora) + slaCumplido.
//
// Fuente de data: EncuestaNPS (poblada via /api/nps cuando el comprador
// vota desde el email enviado por enviarMailEntregadoNPS en lib/mailer.ts).
//
// IMPORTANTE: el disparo del email post-entrega NO esta activo aun
// (DEUDA 59). En V1, la metrica funciona via seed sintetico.
//
// Decisiones:
// - Categorias canonicas: PROMOTOR (9-10), PASIVO (7-8), DETRACTOR (0-6).
// - NPS score = %Promotores - %Detractores (escala -100 a +100).
// - Categoria viene pre-computada en BD por /api/nps; el helper la respeta
//   pero tambien expone clasificarScore() para validacion / recomputo.
// ============================================================================

export const SCORE_DETRACTOR_MAX = 6;
export const SCORE_PASIVO_MAX = 8;

export type CategoriaNPS = "PROMOTOR" | "PASIVO" | "DETRACTOR";

export function clasificarScore(score: number): CategoriaNPS {
  if (score <= SCORE_DETRACTOR_MAX) return "DETRACTOR";
  if (score <= SCORE_PASIVO_MAX) return "PASIVO";
  return "PROMOTOR";
}

export interface EncuestaParaResumir {
  score: number;
  categoria: string;
  experienciaEntrega: string | null;
  slaCumplido: boolean | null;
}

export interface ResumenNPS {
  totalEncuestas: number;
  promotores: number;
  pasivos: number;
  detractores: number;
  promotoresPct: number;
  pasivosPct: number;
  detractoresPct: number;
  npsScore: number;  // -100 a +100
  scorePromedio: number;  // 0 a 10
  tasaRespuesta: number | null;  // null si no se provee total entregados
}

export function calcularNPS(
  encuestas: EncuestaParaResumir[],
  totalEntregados?: number
): ResumenNPS {
  const total = encuestas.length;

  if (total === 0) {
    return {
      totalEncuestas: 0,
      promotores: 0,
      pasivos: 0,
      detractores: 0,
      promotoresPct: 0,
      pasivosPct: 0,
      detractoresPct: 0,
      npsScore: 0,
      scorePromedio: 0,
      tasaRespuesta: totalEntregados && totalEntregados > 0 ? 0 : null,
    };
  }

  let promotores = 0;
  let pasivos = 0;
  let detractores = 0;
  let sumaScores = 0;

  for (const enc of encuestas) {
    sumaScores += enc.score;
    if (enc.categoria === "PROMOTOR") promotores++;
    else if (enc.categoria === "PASIVO") pasivos++;
    else if (enc.categoria === "DETRACTOR") detractores++;
  }

  const promotoresPct = Math.round((promotores / total) * 1000) / 10;
  const pasivosPct = Math.round((pasivos / total) * 1000) / 10;
  const detractoresPct = Math.round((detractores / total) * 1000) / 10;
  const npsScore = Math.round(promotoresPct - detractoresPct);
  const scorePromedio = Math.round((sumaScores / total) * 10) / 10;

  const tasaRespuesta = totalEntregados && totalEntregados > 0
    ? Math.round((total / totalEntregados) * 1000) / 10
    : null;

  return {
    totalEncuestas: total,
    promotores,
    pasivos,
    detractores,
    promotoresPct,
    pasivosPct,
    detractoresPct,
    npsScore,
    scorePromedio,
    tasaRespuesta,
  };
}

// Agrupa por dimension generica (courier, empresa, provincia, modalidad).
// Retorna NPS por grupo + cantidad por categoria.
export interface GrupoNPS {
  nombre: string;
  totalEncuestas: number;
  promotores: number;
  pasivos: number;
  detractores: number;
  npsScore: number;
  scorePromedio: number;
}

export function agruparPorDimension(
  encuestas: EncuestaParaResumir[],
  keyFn: (e: EncuestaParaResumir) => string | null
): GrupoNPS[] {
  const mapa = new Map<string, EncuestaParaResumir[]>();

  for (const enc of encuestas) {
    const key = keyFn(enc);
    if (!key) continue;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key)!.push(enc);
  }

  return Array.from(mapa.entries())
    .map(([nombre, grupo]) => {
      const r = calcularNPS(grupo);
      return {
        nombre,
        totalEncuestas: r.totalEncuestas,
        promotores: r.promotores,
        pasivos: r.pasivos,
        detractores: r.detractores,
        npsScore: r.npsScore,
        scorePromedio: r.scorePromedio,
      };
    })
    .sort((a, b) => b.npsScore - a.npsScore);  // mejor NPS primero
}

// Friccion de entrega: distribucion de experienciaEntrega (Q3).
export interface FriccionEntrega {
  motivo: string;
  cantidad: number;
  porcentaje: number;
}

export function calcularFriccion(encuestas: EncuestaParaResumir[]): FriccionEntrega[] {
  const conMotivo = encuestas.filter(e => e.experienciaEntrega);
  const total = conMotivo.length;

  if (total === 0) return [];

  const mapa = new Map<string, number>();
  for (const enc of conMotivo) {
    const motivo = enc.experienciaEntrega!;
    mapa.set(motivo, (mapa.get(motivo) || 0) + 1);
  }

  return Array.from(mapa.entries())
    .map(([motivo, cantidad]) => ({
      motivo,
      cantidad,
      porcentaje: Math.round((cantidad / total) * 1000) / 10,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

// Cruce SLA: NPS de envios con slaCumplido=true vs false.
export interface CruceSLA {
  conSlaCumplido: ResumenNPS;
  sinSlaCumplido: ResumenNPS;
  sinDatoSLA: number;  // encuestas sin contexto de SLA
}

export function calcularCruceSLA(encuestas: EncuestaParaResumir[]): CruceSLA {
  const con = encuestas.filter(e => e.slaCumplido === true);
  const sin = encuestas.filter(e => e.slaCumplido === false);
  const sinDato = encuestas.filter(e => e.slaCumplido === null).length;

  return {
    conSlaCumplido: calcularNPS(con),
    sinSlaCumplido: calcularNPS(sin),
    sinDatoSLA: sinDato,
  };
}
