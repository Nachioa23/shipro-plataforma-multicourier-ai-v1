// ============================================================================
// DEUDA 186 FASE 3 PIEZA 2 (2026-10-22) — Helper de scoring ponderado.
// ============================================================================
// Calcula el score de cada opción de courier combinando 4 dimensiones:
//
//     score = w_costo · c_costo + w_sla · c_sla + w_velocidad · c_velocidad
//             + w_capacidad · c_capacidad
//
// con `Σ wᵢ = 1.0` y `cᵢ ∈ [0, 1]`. Defaults 40/30/20/10 (blueprint §4); la
// empresa puede ajustarlos (`Empresa.pesoCostoScoring/pesoSlaScoring/
// pesoVelocidadScoring/pesoCapacidadScoring`, CHECK suman 1.00 en SQL).
//
// Normalización in-set (dentro del set de opciones que se está evaluando):
//   - c_costo:     (max − precio_i) / (max − min)  → más barato = 1.
//   - c_velocidad: (max − slaHs_i) / (max − min)   → más rápido = 1.
//   - c_sla:       porcentajeOnTime / 100 (0-1), via calcularConfiabilidad
//                  (fallback escalonado 4 niveles, Nivel 4 = 1.0 teórico).
//   - c_capacidad: 1.0 neutro — no hay flags persistidos de capacidad por
//                  courier. Hook para cuando se persistan.
//
// READ-ONLY: no muta el input (defensive copy antes de cualquier .sort),
// no escribe nada, solo calcularConfiabilidad hace sus propios reads.
// Money-safe por naturaleza: zero touch de precioFinal, zero reorden del
// array del caller, zero cambio de selección.
//
// CONSUMO (FASE 3 PIEZA 3): el enganche del cotizador llama este helper
// con `finalDomicilio` + `finalSucursal` (ya ordenados por aplicarEstrategia)
// y persiste `{ componentes, ganador, pesos }` en MotorReglaShadowLog SIN
// afectar la selección real.
// ============================================================================

import { calcularConfiabilidad, type VentanaConfiabilidad } from "@/lib/utils/confiabilidad";

export const DEFAULT_PESOS_SCORING = {
  costo: 0.40,
  sla: 0.30,
  velocidad: 0.20,
  capacidad: 0.10,
} as const;

export interface PesosScoring {
  costo: number;
  sla: number;
  velocidad: number;
  capacidad: number;
}

export interface ComponenteCourier {
  /** Nombre uppercase (consistente con OpcionTarifa.courier). */
  courierNombre: string;
  /** Id del courier mapeado por el caller; null si no se pudo mapear. */
  courierId: number | null;
  /** [0,1] — más barato = 1 (normalización in-set). */
  cCosto: number;
  /** [0,1] — porcentajeOnTime/100 (confiabilidad). */
  cSla: number;
  /** [0,1] — más rápido = 1 (normalización in-set). */
  cVelocidad: number;
  /** [0,1] — 1.0 neutro por ahora (sin flags persistidos de capacidad). */
  cCapacidad: number;
  /** Σ wᵢ·cᵢ ∈ [0,1]. */
  score: number;
  /** Nivel del fallback de confiabilidad (1-4). 4 = teórico. */
  nivelSla: number;
  /** Etiqueta UX de la confiabilidad — "por qué" del cSla. */
  etiquetaSla: string;
  /** Precio final de la opción (para sobrecosto del shadow log). */
  precioFinal: number;
}

export interface ResultadoScoring {
  componentes: ComponenteCourier[];
  ganador: ComponenteCourier | null;
  pesos: PesosScoring;
}

// Shape mínimo que el helper lee de cada opción. Compatible con OpcionTarifa
// de lib/cotizador.ts (precioFinal es Prisma.Decimal → tiene .toNumber()), pero
// typed laxo para que el helper no dependa del módulo cotizador y sea testeable.
export interface OpcionParaScoring {
  courier: string;
  precioFinal: { toNumber(): number } | number;
  slaHs: number;
}

/**
 * Normalización in-set en modo "menor-es-mejor" (costo, velocidad en horas).
 * Devuelve `(max − valor) / (max − min)`. Si min === max (todos iguales en el
 * set), devuelve 0.5 (neutro — ninguna opción domina).
 */
export function normalizarInSet(valor: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (max - valor) / (max - min);
}

/** Extrae el precio como number desde Decimal o number. */
function precioAsNumber(p: { toNumber(): number } | number): number {
  return typeof p === "number" ? p : p.toNumber();
}

/**
 * Calcula el score ponderado de un set de opciones de courier (un lado:
 * domicilio O sucursal). Pure read: NO muta las opciones recibidas.
 *
 * @param opciones  Set de opciones ya cotizadas (del caller — el helper NO las muta).
 * @param mapaCourierIds Map de courier nombre uppercase → courierId. El caller
 *                   lo arma desde `couriersReales` del cotizador.
 * @param contexto  Provincia + ventana para `calcularConfiabilidad`.
 * @param pesos     Pesos de la empresa (o DEFAULT_PESOS_SCORING).
 */
export async function calcularScoring(
  opciones: OpcionParaScoring[],
  mapaCourierIds: Map<string, number>,
  contexto: {
    provinciaDestino: string | null | undefined;
    ventanaDias: VentanaConfiabilidad;
  },
  pesos: PesosScoring,
): Promise<ResultadoScoring> {
  if (opciones.length === 0) {
    return { componentes: [], ganador: null, pesos };
  }

  // Rango de precios y SLA sobre todo el set (para normalización in-set).
  // Reduce sobre el input sin mutarlo (map + Math.min/max puros).
  const precios = opciones.map((o) => precioAsNumber(o.precioFinal));
  const slaHs = opciones.map((o) => o.slaHs);
  const minPrecio = Math.min(...precios);
  const maxPrecio = Math.max(...precios);
  const minSla = Math.min(...slaHs);
  const maxSla = Math.max(...slaHs);

  // Scorear cada opción. Las llamadas a calcularConfiabilidad corren en
  // paralelo (Promise.all) — cada una es un findUnique indexed, sumar
  // latencia secuencialmente sería desperdicio.
  const componentes: ComponenteCourier[] = await Promise.all(
    opciones.map(async (op, i): Promise<ComponenteCourier> => {
      const courierNombre = op.courier;
      const courierId = mapaCourierIds.get(courierNombre.toUpperCase()) ?? null;

      const cCosto = normalizarInSet(precios[i], minPrecio, maxPrecio);
      const cVelocidad = normalizarInSet(slaHs[i], minSla, maxSla);

      let cSla: number;
      let nivelSla: number;
      let etiquetaSla: string;
      if (courierId != null) {
        const confiab = await calcularConfiabilidad(
          courierId,
          contexto.provinciaDestino,
          contexto.ventanaDias,
          courierNombre,
        );
        cSla = confiab.porcentajeOnTime / 100;
        nivelSla = confiab.nivel;
        etiquetaSla = confiab.etiqueta;
      } else {
        // No pudimos mapear courierId → neutro (no penalizar por falla
        // de mapping; es responsabilidad del caller armar bien el mapa).
        cSla = 1.0;
        nivelSla = 4;
        etiquetaSla = "sin courierId";
      }

      // Capacidad: 1.0 neutro hasta que persistamos flags.
      const cCapacidad = 1.0;

      const score =
        pesos.costo * cCosto +
        pesos.sla * cSla +
        pesos.velocidad * cVelocidad +
        pesos.capacidad * cCapacidad;

      return {
        courierNombre,
        courierId,
        cCosto,
        cSla,
        cVelocidad,
        cCapacidad,
        score,
        nivelSla,
        etiquetaSla,
        precioFinal: precios[i],
      };
    }),
  );

  // Ganador = mayor score. En empate: el primero (estable; refleja el orden
  // de entrada que ya trae un criterio del caller — ej. aplicarEstrategia
  // ya ordenó por price/sla).
  let ganador: ComponenteCourier | null = null;
  for (const c of componentes) {
    if (ganador === null || c.score > ganador.score) {
      ganador = c;
    }
  }

  return { componentes, ganador, pesos };
}
