// ============================================================================
// HELPER — AUDITORIA DE DIRECCIONES
//
// Detecta problemas de calidad en direcciones de envios. Utilizado por la
// Metrica 3.1 "Auditoria de Direcciones".
//
// Tipos de problemas (decisiones director, 2026-06-10):
//   - Severidad ALTA: CALLE_VACIA, ALTURA_VACIA, INCONSISTENCIA_CP_PROVINCIA
//   - Severidad MEDIA: LOCALIDAD_VACIA, PROVINCIA_VACIA, CP_NO_NORMALIZADO,
//                      INCONSISTENCIA_CP_LOCALIDAD, PROVINCIA_NO_NORMALIZABLE
//
// Sistema de score:
//   - Base: 100 puntos.
//   - -20 por cada problema ALTA.
//   - -10 por cada problema MEDIA.
//   - Score minimo: 0.
//
// Categorias (decisiones director, 2026-06-10):
//   - 90-100: "limpia"
//   - 70-89: "aceptable"
//   - 50-69: "problematica"
//   - <50: "critica"
// ============================================================================

import { normalizarProvincia } from "@/lib/constants/normalizar-provincia";

export type TipoProblema =
  | "CALLE_VACIA"
  | "ALTURA_VACIA"
  | "LOCALIDAD_VACIA"
  | "PROVINCIA_VACIA"
  | "CP_NO_NORMALIZADO"
  | "INCONSISTENCIA_CP_PROVINCIA"
  | "INCONSISTENCIA_CP_LOCALIDAD"
  | "PROVINCIA_NO_NORMALIZABLE";

export type Severidad = "ALTA" | "MEDIA";

export type Categoria = "limpia" | "aceptable" | "problematica" | "critica";

// ============================================================
// CONSTANTES
// ============================================================

const PROBLEMAS_ALTA_SEVERIDAD: Set<TipoProblema> = new Set([
  "CALLE_VACIA",
  "ALTURA_VACIA",
  "INCONSISTENCIA_CP_PROVINCIA",
]);

const PESO_PROBLEMA_ALTA = 20;
const PESO_PROBLEMA_MEDIA = 10;

const UMBRAL_LIMPIA = 90;
const UMBRAL_ACEPTABLE = 70;
const UMBRAL_PROBLEMATICA = 50;

// ============================================================
// INTERFACES
// ============================================================

export interface DireccionParaAuditar {
  id: number;
  cp: string;
  calle: string | null;
  altura: string | null;
  localidad: string | null;
  provincia: string | null;
}

export interface ContextoNomenclador {
  // Map de CP -> Set de localidades validas.
  cpToLocalidades: Map<string, Set<string>>;
  // Map de CP -> Set de provincias validas (via Localidad -> Provincia).
  cpToProvincias: Map<string, Set<string>>;
}

export interface AuditoriaDireccion {
  direccionId: number;
  problemas: TipoProblema[];
  problemasAlta: number;
  problemasMedia: number;
  score: number;
  categoria: Categoria;
}

export interface ResumenAuditoria {
  totalDirecciones: number;
  totalConProblemas: number;
  tasaAuditoria: number; // % con al menos 1 problema
  distribucionCategorias: {
    limpia: number;
    aceptable: number;
    problematica: number;
    critica: number;
  };
  topProblemas: Array<{ tipo: TipoProblema; cantidad: number; porcentaje: number }>;
  scorePromedio: number;
}

// ============================================================
// HELPERS
// ============================================================

function esVacio(valor: string | null): boolean {
  return valor === null || valor.trim() === "";
}

function categoriaPorScore(score: number): Categoria {
  if (score >= UMBRAL_LIMPIA) return "limpia";
  if (score >= UMBRAL_ACEPTABLE) return "aceptable";
  if (score >= UMBRAL_PROBLEMATICA) return "problematica";
  return "critica";
}

function severidadDe(tipo: TipoProblema): Severidad {
  return PROBLEMAS_ALTA_SEVERIDAD.has(tipo) ? "ALTA" : "MEDIA";
}

// ============================================================
// AUDITORIA INDIVIDUAL
// ============================================================

/**
 * Audita una direccion individual.
 *
 * Detecta problemas de completitud + consistencia (vs nomenclador opcional).
 * Si no se pasa contexto de nomenclador, omite las validaciones semanticas.
 */
export function auditarDireccion(
  direccion: DireccionParaAuditar,
  contexto: ContextoNomenclador | null = null
): AuditoriaDireccion {
  const problemas: TipoProblema[] = [];

  // 1. Completitud.
  if (esVacio(direccion.calle)) problemas.push("CALLE_VACIA");
  if (esVacio(direccion.altura)) problemas.push("ALTURA_VACIA");
  if (esVacio(direccion.localidad)) problemas.push("LOCALIDAD_VACIA");
  if (esVacio(direccion.provincia)) problemas.push("PROVINCIA_VACIA");

  // 2. Provincia normalizable.
  if (!esVacio(direccion.provincia)) {
    const provNorm = normalizarProvincia(direccion.provincia);
    if (provNorm === null) {
      problemas.push("PROVINCIA_NO_NORMALIZABLE");
    }
  }

  // 3. Validaciones semanticas con nomenclador.
  if (contexto) {
    const cp = direccion.cp.trim();

    // CP existe en tabla?
    if (!contexto.cpToLocalidades.has(cp)) {
      problemas.push("CP_NO_NORMALIZADO");
    } else {
      // CP existe -> verificar consistencia.

      // CP <-> localidad declarada.
      if (!esVacio(direccion.localidad)) {
        const localidadesValidas = contexto.cpToLocalidades.get(cp)!;
        const locNormalizada = direccion.localidad!.toLowerCase().trim();
        const hayMatch = Array.from(localidadesValidas).some(
          l => l.toLowerCase().trim() === locNormalizada
        );
        if (!hayMatch) {
          problemas.push("INCONSISTENCIA_CP_LOCALIDAD");
        }
      }

      // CP <-> provincia declarada (a traves de Localidad).
      if (!esVacio(direccion.provincia)) {
        const provNorm = normalizarProvincia(direccion.provincia);
        if (provNorm !== null) {
          const provinciasValidas = contexto.cpToProvincias.get(cp);
          if (provinciasValidas) {
            const hayMatch = Array.from(provinciasValidas).some(
              p => normalizarProvincia(p) === provNorm
            );
            if (!hayMatch) {
              problemas.push("INCONSISTENCIA_CP_PROVINCIA");
            }
          }
        }
      }
    }
  }

  // 4. Calcular score.
  const problemasAlta = problemas.filter(p => severidadDe(p) === "ALTA").length;
  const problemasMedia = problemas.filter(p => severidadDe(p) === "MEDIA").length;

  const penalidad = (problemasAlta * PESO_PROBLEMA_ALTA) + (problemasMedia * PESO_PROBLEMA_MEDIA);
  const score = Math.max(0, 100 - penalidad);

  return {
    direccionId: direccion.id,
    problemas,
    problemasAlta,
    problemasMedia,
    score,
    categoria: categoriaPorScore(score),
  };
}

// ============================================================
// RESUMEN AGREGADO
// ============================================================

/**
 * Calcula el resumen agregado de un conjunto de auditorias.
 */
export function resumirAuditorias(auditorias: AuditoriaDireccion[]): ResumenAuditoria {
  const total = auditorias.length;
  const conProblemas = auditorias.filter(a => a.problemas.length > 0).length;

  const distribucion = { limpia: 0, aceptable: 0, problematica: 0, critica: 0 };
  let sumaScore = 0;
  const problemasFreq = new Map<TipoProblema, number>();

  for (const a of auditorias) {
    distribucion[a.categoria]++;
    sumaScore += a.score;
    for (const p of a.problemas) {
      problemasFreq.set(p, (problemasFreq.get(p) || 0) + 1);
    }
  }

  const totalProblemasReportados = Array.from(problemasFreq.values()).reduce((s, v) => s + v, 0);
  const topProblemas = Array.from(problemasFreq.entries())
    .map(([tipo, cantidad]) => ({
      tipo,
      cantidad,
      porcentaje: totalProblemasReportados > 0
        ? Math.round((cantidad / totalProblemasReportados) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    totalDirecciones: total,
    totalConProblemas: conProblemas,
    tasaAuditoria: total > 0 ? Math.round((conProblemas / total) * 1000) / 10 : 0,
    distribucionCategorias: distribucion,
    topProblemas,
    scorePromedio: total > 0 ? Math.round((sumaScore / total) * 10) / 10 : 0,
  };
}
