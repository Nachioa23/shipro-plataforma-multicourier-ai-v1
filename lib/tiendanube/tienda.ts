// =============================================================================
// DEUDA 144 — Datos de la tienda de Tiendanube.
// =============================================================================
// obtenerDatosTienda hace GET /store y extrae el nombre (multi-idioma → español)
// + el dominio (original_domain). Best-effort: devuelve null en cualquier fallo
// (nunca throwea). Lo consume el callback OAuth al instalar para enriquecer la
// fila de TiendaTiendanube (nombre legible en el panel de Plataformas + link
// directo a la tienda en la página de éxito de instalación).
//
// Contrato oficial verificado:
//   GET {base}/{version}/{storeId}/store
//   → { id, name: {es,pt,en,...}, main_language, original_domain, domains, ... }
//   `name` es un objeto por-idioma en la mayoría de las tiendas; en algunos
//   casos (tiendas viejas / mono-idioma) puede venir como string plano —
//   soportamos ambos. `original_domain` siempre presente si la tienda existe.
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import {
  getTiendanubeApiBaseUrl,
  getTiendanubeApiVersion,
} from "@/lib/utils/tiendanube-config";

export interface DatosTienda {
  nombre: string | null;
  dominio: string | null;
}

/**
 * Trae nombre + dominio de la tienda vía GET /store. Best-effort: devuelve null
 * si la request falla, la respuesta no es JSON, o el shape es inesperado. El
 * caller pasa el accessToken en plaintext (ya descifrado).
 *
 * Estrategia de resolución del `name` (multi-idioma):
 *   1. main_language de la respuesta (si existe y hay valor no vacío ahí).
 *   2. es → pt → en (fallbacks razonables para AR/LATAM).
 *   3. Primer valor no vacío que aparezca en el objeto.
 * Si viene como string plano, se usa tal cual.
 *
 * Estrategia del `dominio`:
 *   1. original_domain (el que Tiendanube marca como principal).
 *   2. domains[0] como fallback (algunas tiendas exponen dominios propios ahí).
 */
export async function obtenerDatosTienda(
  storeId: number,
  accessToken: string,
): Promise<DatosTienda | null> {
  try {
    const url = `${getTiendanubeApiBaseUrl()}/${getTiendanubeApiVersion()}/${storeId}/store`;
    const res = await fetchTiendanube(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn(`[tiendanube/tienda] GET /store HTTP ${res.status} store=${storeId}`);
      return null;
    }
    const data: any = await res.json().catch(() => null);
    if (!data) return null;

    let nombre: string | null = null;
    const n = data.name;
    if (typeof n === "string") {
      nombre = n.trim() || null;
    } else if (n && typeof n === "object") {
      const ml = typeof data.main_language === "string" ? data.main_language : null;
      const candidatos = [ml && n[ml], n.es, n.pt, n.en, ...Object.values(n)];
      nombre =
        (candidatos.find((v) => typeof v === "string" && v.trim()) as string | undefined)?.trim() ??
        null;
    }

    const dominio: string | null =
      (typeof data.original_domain === "string" && data.original_domain) ||
      (Array.isArray(data.domains) && typeof data.domains[0] === "string" && data.domains[0]) ||
      null;

    return { nombre, dominio };
  } catch (e) {
    console.error("[tiendanube/tienda] obtenerDatosTienda falló:", e);
    return null;
  }
}
