// ============================================================================
// Helper: resolverProvinciaDesdeCP (2026-09-06)
// ============================================================================
// Extrae del route handler `app/api/geografia/buscar/route.ts` la lógica pura
// de "dado un CP argentino, devuelve provincia (canonical) + localidades
// dominantes desde la BD oficial". Fuente autoritativa: modelos `CodigoPostal`
// / `Localidad` / `Provincia` de Prisma (cargados desde `prisma/data/codigos.csv`
// via seed).
//
// USADO POR:
//   1. `app/api/geografia/buscar/route.ts` (endpoint HTTP consumido por
//      /nuevo-envio, /corregir, /auditoria — refactorizado para consumir este
//      helper y evitar duplicación).
//   2. `lib/envios/crear.ts` — path e-commerce (WooCommerce y otros plugins):
//      resuelve la provincia canonical desde el CP en vez de confiar en el
//      string que manda el plugin (que puede ser el código ISO "B" o cualquier
//      variante). Chat B adapters NUNCA se tocan — reciben el nombre canonical
//      ya resuelto.
//
// DEUDA 26 (Fase F, 2026-06-03) — provincia dominante: la realidad postal AR
// permite que un CP cubra localidades en MÁS de 1 provincia (92 casos, tipo
// Delta del Paraná, Bariloche/Isla Victoria, NEA). Se agrupa por provincia y
// se elige la dominante (más localidades). Tie-breaker: orden de inserción del
// Map (viene del orden de id de Localidad en Prisma).
//
// CANONICALIZATION: la provincia raw de BD llega en MAYÚSCULAS sin acentos
// ("CIUDAD AUTONOMA DE BUENOS AIRES", "CORDOBA", "TUCUMAN") — se pasa por
// `normalizarProvincia` para obtener el nombre canonical del codebase ("CABA",
// "Córdoba", "Tucumán") — mismo output que el endpoint HTTP viene devolviendo.
// ============================================================================

import prisma from "@/lib/prisma";
import { normalizarProvincia } from "@/lib/constants/normalizar-provincia";

export interface ResolucionCP {
  provincia: string;      // canonical (ej. "Buenos Aires", "CABA", "Córdoba")
  localidades: string[];  // localidades de la provincia dominante bajo ese CP
}

/**
 * Resuelve un CP argentino al nombre canonical de provincia + localidades
 * dominantes desde la BD oficial. Devuelve `null` si el CP no existe en la
 * BD, o si la provincia no matchea ningún ALIAS conocido (raw basura del CSV
 * limpiada por DEUDA 26 — defensa).
 *
 * NO hace normalización de input — asume que `cp` viene sanitizado (string
 * numérico de 4 dígitos, formato CPA legacy). Un `cp` con formato inválido
 * simplemente no matchea el @unique y retorna null.
 *
 * @param cp - Código postal como string (formato 4 dígitos).
 * @returns { provincia canonical, localidades[] } o null si CP no encontrado.
 */
export async function resolverProvinciaDesdeCP(cp: string): Promise<ResolucionCP | null> {
  if (!cp) return null;

  const codigoData = await prisma.codigoPostal.findUnique({
    where: { codigo: cp },
    include: {
      localidades: { include: { provincia: true } },
    },
  });

  if (!codigoData || codigoData.localidades.length === 0) {
    return null;
  }

  // Agrupar localidades por provincia + elegir la dominante (DEUDA 26 Fase F).
  const byProvincia = new Map<string, typeof codigoData.localidades>();
  for (const loc of codigoData.localidades) {
    const key = loc.provincia.nombre;
    const bucket = byProvincia.get(key) ?? [];
    bucket.push(loc);
    byProvincia.set(key, bucket);
  }

  const ordenadas = [...byProvincia.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  const [provinciaRaw, localidadesDominantes] = ordenadas[0];
  const provincia = normalizarProvincia(provinciaRaw);

  if (!provincia) return null;

  return {
    provincia,
    localidades: localidadesDominantes.map((loc) => loc.nombre),
  };
}
