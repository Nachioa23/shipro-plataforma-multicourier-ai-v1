// =============================================================================
// HELPER: asignarSucursalParaDeposito(...)
// DEUDA 29 Sub-fase 6.D.3 (2026-05-20)
// =============================================================================
//
// Núcleo de la lógica de auto-asignación de sucursal para un par
// (depósito × courier). Se llama desde el endpoint
// GET /api/depositos/[id]/sucursal-asignada/[courierId].
//
// El caller (endpoint) calcula el CP efectivo desde donde el courier recoge:
//   - Si DepositoCourierConfig.recogeViaConsolidador=true Y
//     Deposito.courierRecolectorId está seteado:
//       cpOrigenEfectivo = Courier(recolector).cpDepositoConsolidador
//   - Caso contrario:
//       cpOrigenEfectivo = Deposito.codigoPostal
//
// El helper decide la modalidad de asignación (vía getModalidadAsignacion)
// y devuelve una de 5 variantes discriminadas en `tipo`.
//
// =============================================================================
//
// VARIANTES DE RESPUESTA (5 tipos):
//
//   por_cp:           Modalidad por_cp_origen + 1+ sucursales cubren el CP.
//                     Si múltiples cubren, se rankea por Haversine al depósito.
//                     Si depósito sin coords, fallback por id (determinístico).
//                     Response: { sucursal }
//
//   sucursal_unica:   Modalidad sucursal_unica (courier consolidador).
//                     Response: { cp, nombre } — cp del consolidador + nombre
//                     descriptivo. NO incluye sucursal completa porque para
//                     consolidadores no hay SucursalCourier en BD.
//
//   drop_off_cliente: dropOffCliente=true del par (cliente lleva manual).
//                     Response: { opciones: top N sucursales por Haversine }
//                     Si depósito sin coords, opciones = [] (frontend muestra
//                     "depósito sin geocodificación").
//
//   sin_cobertura:    Modalidad por_cp_origen + 0 matches en SucursalCourierCp
//                     para el cpOrigenEfectivo. Response: { mensaje }
//
//   sin_sucursales:   Modalidad sin_sucursales O libre_cercania (no impl MVP).
//                     Response: { mensaje }
//
// NOTAS:
//   - dropOffCliente=true tiene prioridad sobre la modalidad del courier
//     (si el cliente eligió drop-off, no auto-asignamos).
//   - libre_cercania devuelve sin_sucursales con mensaje explícito en MVP.
//     Cuando se implemente, esta función debe agregar caso "libre" análogo
//     a drop_off_cliente (top N cercanas) pero con semántica de "courier
//     acepta cualquier sucursal cercana".
//
// =============================================================================

import { Courier, SucursalCourier, PrismaClient } from "@prisma/client";
import { calcularDistanciaKm } from "@/lib/geo/haversine";
import { getModalidadAsignacion } from "@/lib/couriers/modalidad";
import type { CourierConServicios } from "@/lib/couriers/serviciosSoportados";
import { formatSucursal, SucursalFormateada } from "./format";

export type ResultadoAutoAsignacion =
  | { tipo: "por_cp"; sucursal: SucursalFormateada }
  | { tipo: "sucursal_unica"; cp: string; nombre: string }
  | { tipo: "drop_off_cliente"; opciones: SucursalFormateada[] }
  | { tipo: "sin_cobertura"; mensaje: string }
  | { tipo: "sin_sucursales"; mensaje: string };

export async function asignarSucursalParaDeposito(params: {
  prisma: PrismaClient;
  courier: Courier & CourierConServicios;
  cpOrigenEfectivo: string;
  latitudOrigen: number | null;
  longitudOrigen: number | null;
  dropOffCliente: boolean;
  topN?: number;
}): Promise<ResultadoAutoAsignacion> {
  const {
    prisma,
    courier,
    cpOrigenEfectivo,
    latitudOrigen,
    longitudOrigen,
    dropOffCliente,
    topN = 5,
  } = params;

  // dropOffCliente tiene prioridad sobre la modalidad del courier
  if (dropOffCliente) {
    return asignarDropOffCliente(prisma, courier, latitudOrigen, longitudOrigen, topN);
  }

  const modalidad = getModalidadAsignacion(courier);

  switch (modalidad) {
    case "por_cp_origen":
      return asignarPorCpOrigen(prisma, courier, cpOrigenEfectivo, latitudOrigen, longitudOrigen);

    case "sucursal_unica":
      return {
        tipo: "sucursal_unica",
        cp: courier.cpDepositoConsolidador as string, // verified non-null by getModalidadAsignacion
        nombre: `Depósito Consolidador de ${courier.nombre}`,
      };

    case "libre_cercania":
      return {
        tipo: "sin_sucursales",
        mensaje:
          "Modalidad libre_cercania pendiente de implementación (sin courier que la justifique al día de hoy)",
      };

    case "sin_sucursales":
      return {
        tipo: "sin_sucursales",
        mensaje: `El courier '${courier.nombre}' no tiene sucursales modeladas ni capacidad de consolidación`,
      };
  }
}

// =============================================================================
// Internal: dropOffCliente → top N cercanas
// =============================================================================

async function asignarDropOffCliente(
  prisma: PrismaClient,
  courier: Courier,
  latOrigen: number | null,
  lonOrigen: number | null,
  topN: number
): Promise<ResultadoAutoAsignacion> {
  // Si depósito sin coords, no podemos rankear: devolver opciones vacías
  if (latOrigen === null || lonOrigen === null) {
    return { tipo: "drop_off_cliente", opciones: [] };
  }

  const sucursales = await prisma.sucursalCourier.findMany({
    where: {
      courierId: courier.id,
      activa: true,
      eliminada: false,
      aceptaAdmision: true,
      latitud: { not: null },
      longitud: { not: null },
    },
  });

  if (sucursales.length === 0) {
    return { tipo: "drop_off_cliente", opciones: [] };
  }

  // Calcular distancia y ordenar
  const ranked = sucursales
    .map((s) => ({
      sucursal: s,
      distanciaKm: calcularDistanciaKm(latOrigen, lonOrigen, s.latitud as number, s.longitud as number),
    }))
    .sort((a, b) => a.distanciaKm - b.distanciaKm)
    .slice(0, topN);

  return {
    tipo: "drop_off_cliente",
    opciones: ranked.map(({ sucursal, distanciaKm }) => formatSucursal(sucursal, distanciaKm)),
  };
}

// =============================================================================
// Internal: por_cp_origen → buscar sucursales que cubren el CP
// =============================================================================

async function asignarPorCpOrigen(
  prisma: PrismaClient,
  courier: Courier,
  cp: string,
  latOrigen: number | null,
  lonOrigen: number | null
): Promise<ResultadoAutoAsignacion> {
  const sucursalesQueCubrenCp = await prisma.sucursalCourier.findMany({
    where: {
      courierId: courier.id,
      activa: true,
      eliminada: false,
      aceptaAdmision: true,
      codigosPostales: { some: { codigoPostal: cp } },
    },
  });

  if (sucursalesQueCubrenCp.length === 0) {
    return {
      tipo: "sin_cobertura",
      mensaje: `El courier '${courier.nombre}' no cubre el CP ${cp}`,
    };
  }

  // Rankear si hay coords; sino determinístico por id
  let sucursalElegida: SucursalCourier;
  let distanciaKm: number | undefined;

  if (latOrigen !== null && lonOrigen !== null) {
    // Rankear por Haversine, filtrando las que tienen coords
    const conCoords = sucursalesQueCubrenCp.filter((s) => s.latitud !== null && s.longitud !== null);
    const sinCoords = sucursalesQueCubrenCp.filter((s) => s.latitud === null || s.longitud === null);

    if (conCoords.length > 0) {
      const ranked = conCoords
        .map((s) => ({
          sucursal: s,
          distanciaKm: calcularDistanciaKm(latOrigen, lonOrigen, s.latitud as number, s.longitud as number),
        }))
        .sort((a, b) => a.distanciaKm - b.distanciaKm);
      sucursalElegida = ranked[0].sucursal;
      distanciaKm = ranked[0].distanciaKm;
    } else {
      // Todas sin coords: fallback determinístico
      sucursalElegida = sinCoords.sort((a, b) => a.id - b.id)[0];
    }
  } else {
    // Depósito sin coords: fallback determinístico por id
    sucursalElegida = sucursalesQueCubrenCp.sort((a, b) => a.id - b.id)[0];
  }

  return {
    tipo: "por_cp",
    sucursal: formatSucursal(sucursalElegida, distanciaKm),
  };
}
