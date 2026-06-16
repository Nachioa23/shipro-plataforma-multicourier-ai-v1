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

// ============================================================================
// ORQUESTACION SCOPE-AWARE — calcularNpsCompradorAnalitica(ctx)
//
// Phase 2.3.b (Panel cliente migration, 2026-06-15).
// Agrega orquestador analitico scope-aware al helper, sin romper los 9
// exports existentes (primitivas + aggregators usados por endpoint Torre
// actual y por nps-empresa).
//
// SEMANTICA: extrae al helper la logica que estaba inline en el endpoint
// /api/torre-de-control/nps-comprador. La migracion del endpoint a
// delegate-al-helper sucede en Phase 2.3.c.
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.encuestaNPS por ctx.empresaId
//   (campo directo en EncuestaNPS, no via envio.empresaId).
//   Retorna shape "cliente" sin porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): sin filtro
//   de empresa. Retorna shape "shipro" con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): filtra a esa
//   empresa. Retorna shape "shipro" sin porEmpresa.
//
// Decisiones de producto (director 2026-06-15):
// D1 - Nombre: calcularNpsCompradorAnalitica (claro vs futuro
//      calcularNpsClienteEmpresaAnalitica de nps-empresa.ts).
// D2 - Discriminated union estricto: porEmpresa solo en shape Shipro.
// D3 - Top comentarios separados: topPromotores + topDetractores
//      (Panel cliente los muestra separados verde/rojo).
// D4 - Provincia/modalidad: leidos directo de EncuestaNPS.provincia y
//      EncuestaNPS.modalidad (desnormalizados, no via envio.destino).
// D5 - sugerenciaMejora preservada en topDetractores items.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT_NPS = 90;

export interface ComentarioNPSItem {
  envioId: number;
  score: number;
  categoria: CategoriaNPS;
  comentario: string;
  experienciaEntrega: string | null;
  satisfaccionProducto: number | null;
  probabilidadRecompra: number | null;
  sugerenciaMejora: string | null;
  courierNombre: string | null;
  empresaNombre: string | null;
  provincia: string | null;
  modalidad: string | null;
  fechaVoto: Date;
}

export interface MesNPSItem {
  mes: string;
  totalEncuestas: number;
  npsScore: number;
  promotoresPct: number;
  pasivosPct: number;
  detractoresPct: number;
}

export interface CalidadDatosNPS {
  ventanaDias: number;
  totalEntregados: number;
  totalEncuestas: number;
  cobertura: string;
  fuente: string;
}

export interface ResultadoNPSBase {
  resumen: ResumenNPS;
  porCourier: GrupoNPS[];
  porProvincia: GrupoNPS[];
  porModalidad: GrupoNPS[];
  porMes: MesNPSItem[];
  friccionEntrega: FriccionEntrega[];
  cruceSLA: CruceSLA;
  topPromotores: ComentarioNPSItem[];
  topDetractores: ComentarioNPSItem[];
  calidadDatos: CalidadDatosNPS;
}

export interface ResultadoNPSCliente extends ResultadoNPSBase {
  scope: "cliente";
}

export interface ResultadoNPSShipro extends ResultadoNPSBase {
  porEmpresa: GrupoNPS[];
  scope: "shipro";
}

export type ResultadoNPS = ResultadoNPSCliente | ResultadoNPSShipro;

export async function calcularNpsCompradorAnalitica(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT_NPS
): Promise<ResultadoNPS> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause scope-aware (empresaId directo en EncuestaNPS).
  const whereClause: any = {
    fechaVoto: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  // Fetch encuestas con includes simplificados (empresaId directo).
  const encuestas = await prisma.encuestaNPS.findMany({
    where: whereClause,
    include: {
      courier: { select: { id: true, nombre: true } },
      empresa: { select: { id: true, nombre: true } },
    },
    orderBy: { fechaVoto: "desc" },
  });

  // Total entregados (denominador para tasaRespuesta), tambien scope-aware.
  const entregadosWhere: any = {
    fechaImpresion: { gte: ventanaInicio },
    estadoActual: "ENTREGADO",
  };
  if (!ctx.modoDios) {
    entregadosWhere.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    entregadosWhere.empresaId = ctx.empresaId;
  }
  const totalEntregados = await prisma.envio.count({ where: entregadosWhere });

  // Build encuestas para helpers (shape minimo).
  const encuestasParaHelper: EncuestaParaResumir[] = encuestas.map(e => ({
    score: e.score,
    categoria: e.categoria,
    slaCumplido: e.slaCumplido,
    experienciaEntrega: e.experienciaEntrega,
  }));

  // Resumen global.
  const resumen = calcularNPS(encuestasParaHelper, totalEntregados);

  // Cortes por dimension.
  const porCourier = agruparPorDimension(encuestas, (e: any) => e.courier?.nombre ?? "Sin courier");
  const porProvincia = agruparPorDimension(encuestas, (e: any) => e.provincia ?? "Sin provincia");
  const porModalidad = agruparPorDimension(encuestas, (e: any) => e.modalidad ?? "Sin modalidad");

  // Friccion + Cruce SLA.
  const friccionEntrega = calcularFriccion(encuestasParaHelper);
  const cruceSLA = calcularCruceSLA(encuestasParaHelper);

  // Top promotores (score >= 9) y top detractores (score <= 6), con comentario no vacio.
  const conComentario = encuestas.filter(e => e.comentario && e.comentario.trim() !== "");

  const buildComentarioItem = (e: any): ComentarioNPSItem => ({
    envioId: e.envioId,
    score: e.score,
    categoria: clasificarScore(e.score),
    comentario: e.comentario ?? "",
    experienciaEntrega: e.experienciaEntrega,
    satisfaccionProducto: e.satisfaccionProducto,
    probabilidadRecompra: e.probabilidadRecompra,
    sugerenciaMejora: e.sugerenciaMejora,
    courierNombre: e.courier?.nombre ?? null,
    empresaNombre: e.empresa?.nombre ?? null,
    provincia: e.provincia,
    modalidad: e.modalidad,
    fechaVoto: e.fechaVoto,
  });

  const topPromotores: ComentarioNPSItem[] = conComentario
    .filter(e => e.score >= 9)
    .slice(0, 10)
    .map(buildComentarioItem);

  const topDetractores: ComentarioNPSItem[] = conComentario
    .filter(e => e.score <= SCORE_DETRACTOR_MAX)
    .slice(0, 10)
    .map(buildComentarioItem);

  // porMes: agrupar por YYYY-MM via fechaVoto.
  const mesMap = new Map<string, EncuestaParaResumir[]>();
  for (const e of encuestas) {
    const mesKey = `${e.fechaVoto.getFullYear()}-${String(e.fechaVoto.getMonth() + 1).padStart(2, "0")}`;
    if (!mesMap.has(mesKey)) mesMap.set(mesKey, []);
    mesMap.get(mesKey)!.push({
      score: e.score,
      categoria: e.categoria,
      slaCumplido: e.slaCumplido,
      experienciaEntrega: e.experienciaEntrega,
    });
  }
  const porMes: MesNPSItem[] = Array.from(mesMap.entries())
    .map(([mes, encs]) => {
      const r = calcularNPS(encs);
      return {
        mes,
        totalEncuestas: r.totalEncuestas,
        npsScore: r.npsScore,
        promotoresPct: r.promotoresPct,
        pasivosPct: r.pasivosPct,
        detractoresPct: r.detractoresPct,
      };
    })
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const calidadDatos: CalidadDatosNPS = {
    ventanaDias,
    totalEntregados,
    totalEncuestas: encuestas.length,
    cobertura: totalEntregados > 0
      ? `${Math.round((encuestas.length / totalEntregados) * 100)}% de envios entregados con encuesta`
      : "Sin envios entregados en la ventana",
    fuente: "EncuestaNPS post-entrega (Q1 score 0-10)",
  };

  const base: ResultadoNPSBase = {
    resumen,
    porCourier,
    porProvincia,
    porModalidad,
    porMes,
    friccionEntrega,
    cruceSLA,
    topPromotores,
    topDetractores,
    calidadDatos,
  };

  if (!ctx.modoDios) {
    return { ...base, scope: "cliente" };
  }

  const porEmpresa = agruparPorDimension(encuestas, (e: any) => e.empresa?.nombre ?? "Sin empresa");

  return { ...base, porEmpresa, scope: "shipro" };
}
