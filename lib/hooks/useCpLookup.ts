"use client";

import { useEffect, useState } from "react";

const DEBOUNCE_MS = 500;
const MIN_CP_LENGTH = 4;

export interface CpLookupResult {
  localidad: string;
  provincia: string;
  localidades: string[];
  buscando: boolean;
  error: string | null;
}

const VACIO: CpLookupResult = {
  localidad: "",
  provincia: "",
  localidades: [],
  buscando: false,
  error: null,
};

/**
 * Hook que mapea un código postal argentino a localidad/provincia
 * consultando `/api/geografia/buscar`.
 *
 * - Debounce 500ms para no saturar el endpoint mientras el usuario tipea.
 * - Solo dispara la búsqueda cuando `cp.length >= 4`.
 * - Si cp es vacío o corto: devuelve resultado vacío sin error.
 * - Si la API responde múltiples localidades para el CP: las devuelve
 *   todas en `localidades` y la primera como `localidad`.
 *
 * No toma setters externos (mantiene el hook reusable).
 * El caller mapea los valores devueltos a su state local con un useEffect.
 */
export function useCpLookup(cp: string): CpLookupResult {
  const [result, setResult] = useState<CpLookupResult>(VACIO);

  useEffect(() => {
    const cpLimpio = (cp || "").replace(/\D/g, "");

    if (cpLimpio.length < MIN_CP_LENGTH) {
      setResult(VACIO);
      return;
    }

    let cancelado = false;
    setResult(prev => ({ ...prev, buscando: true, error: null }));

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geografia/buscar?cp=${cpLimpio}`);
        if (cancelado) return;
        if (!res.ok) {
          setResult({ localidad: "", provincia: "", localidades: [], buscando: false, error: "CP no encontrado" });
          return;
        }
        const data = await res.json();
        if (cancelado) return;

        const localidades: string[] = Array.isArray(data?.localidades) ? data.localidades : [];
        const provincia: string = typeof data?.provincia === "string" ? data.provincia : "";

        setResult({
          localidad: localidades[0] ?? "",
          provincia,
          localidades,
          buscando: false,
          error: null,
        });
      } catch (e: any) {
        if (cancelado) return;
        setResult({ localidad: "", provincia: "", localidades: [], buscando: false, error: e?.message || "Error de red" });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelado = true;
      clearTimeout(timeoutId);
    };
  }, [cp]);

  return result;
}
