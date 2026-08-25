import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { aplicarMarkup, type ConfigMarkup } from "@/lib/cotizador";

// DEUDA 10 Paso 3b (D-10-PRICE-READ): helper de precio de fallback.
// Se usa cuando el courier real falla al despachar (BLOQUEADO_PARCIAL).
// La venta nunca se cae: siempre devuelve un precio publicable (o null si
// el courier no tiene rescate configurado — DEUDA 132 Paso 5a).
//
// Cascada de fuentes:
//   1. HistoricoCotizaciones: ultimo precio CRUDO conocido del trayecto,
//      si no es mas viejo que MAX_DIAS_HISTORICO. Se le re-aplica markup.
//   2. CredencialCourier.tarifaPlanaRespaldoCourier: precio final ya completo
//      (el cliente lo cargo por-courier con courier+fee+seguro+impuestos incluidos).
//      Se publica tal cual. DEUDA 132 Paso 5a (2026-08-25): reemplaza el
//      campo legacy per-empresa — ahora es per-courier.
//
// Si no hay histórico ni tarifa per-courier configurada, devuelve null
// (fuente="sin_precio") y el caller decide qué hacer.

// D-10-PRICE-AGE: un precio historico mas viejo que esto se considera no confiable
// (contexto inflacionario AR). 180 dias: la variacion tipica de tarifa (~15%) no
// afecta materialmente la venta, y da tiempo a juntar datos.
const MAX_DIAS_HISTORICO = 180;

export type FuentePrecioFallback = "historico" | "tarifa_plana_respaldo" | "sin_precio";

export interface ResultadoPrecioFallback {
  precio: Prisma.Decimal | null;
  fuente: FuentePrecioFallback;
  modalidad: string;
  detalle: string;
}

export interface ParamsPrecioFallback {
  courierId: number;
  cpOrigen: string;
  cpDestino: string;
  pesoKg: number;
  modalidad: string;
  // DEUDA 132 Paso 5a: tarifa de rescate del courier ELEGIDO
  // (CredencialCourier.tarifaPlanaRespaldoCourier). Reemplaza el campo legacy
  // per-empresa. Null = no hay rescate configurado → fuente="sin_precio".
  tarifaPlanaRespaldoCourier: Prisma.Decimal | null;
  configMarkup: ConfigMarkup;
}

/**
 * Resuelve el precio a publicar cuando el courier real no responde.
 * Pura en intencion: solo lee de BD, no escribe ni muta estado de envio.
 */
export async function resolverPrecioFallback(
  params: ParamsPrecioFallback
): Promise<ResultadoPrecioFallback> {
  const { courierId, cpOrigen, cpDestino, modalidad, tarifaPlanaRespaldoCourier, configMarkup } = params;
  const pesoEntero = Math.floor(params.pesoKg);

  // --- Fuente 1: historico ---
  try {
    const row = await prisma.historicoCotizaciones.findUnique({
      where: {
        courierId_cpOrigen_cpDestino_pesoKg_modalidad: {
          courierId,
          cpOrigen,
          cpDestino,
          pesoKg: pesoEntero,
          modalidad,
        },
      },
    });

    if (row) {
      const diasAntiguedad = (Date.now() - row.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (diasAntiguedad <= MAX_DIAS_HISTORICO) {
        const { precioFinal } = aplicarMarkup(row.precio, configMarkup);
        return {
          precio: precioFinal,
          fuente: "historico",
          modalidad,
          detalle: `Precio de fallback desde historico (${Math.round(diasAntiguedad)} dias de antiguedad), markup re-aplicado.`,
        };
      }
    }
  } catch (err) {
    console.warn("[precio-fallback] Error consultando historico, se cae a tarifa plana:", err);
  }

  // --- Fuente 2: tarifa plana de respaldo por-courier (ya es precio final) ---
  if (tarifaPlanaRespaldoCourier != null && tarifaPlanaRespaldoCourier.gt(0)) {
    return {
      precio: tarifaPlanaRespaldoCourier,
      fuente: "tarifa_plana_respaldo",
      modalidad,
      detalle: "Precio de fallback desde tarifa plana de respaldo per-courier del cliente (sin historico vigente).",
    };
  }

  // --- Sin precio: ni historico vigente ni tarifa per-courier configurada. ---
  return {
    precio: null,
    fuente: "sin_precio",
    modalidad,
    detalle: "No hay historico vigente ni tarifa plana de respaldo configurada. Revisar configuracion del cliente.",
  };
}
