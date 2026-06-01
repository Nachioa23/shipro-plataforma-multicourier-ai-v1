// =============================================================================
// HELPER: getModalidadAsignacion(courier)
// DEUDA 29 Sub-fase 6.D.3 (2026-05-20)
// =============================================================================
//
// Detecta la modalidad de asignación de sucursal según las propiedades del
// courier en BD. La modalidad NO está modelada como campo explícito (decisión
// #48 en docs/ARQUITECTURA-MULTICOURIER.md): se infiere de las capacidades.
//
// 4 modalidades posibles:
//
//   por_cp_origen: el courier define qué sucursal atiende cada CP. La plataforma
//                  consulta SucursalCourierCp para auto-asignar. Ejemplo: Andreani.
//
//   sucursal_unica: el courier tiene 1 sola sucursal operativa (modelada vía
//                   Courier.cpDepositoConsolidador). Ejemplo: Mocis.
//
//   libre_cercania: el courier acepta operar desde cualquier sucursal — el cliente
//                   elige entre top N cercanas. NO IMPLEMENTADA EN MVP (YAGNI —
//                   no hay courier que la justifique todavía). Cuando exista, el
//                   helper de asignación devuelve "sin_sucursales" con mensaje.
//
//   sin_sucursales: el courier no tiene sucursales modeladas ni capacidad de
//                   consolidación. Estado de configuración incompleto.
//
// Lógica inicial (puede expandirse si se agregan couriers con casos atípicos):
//   - Si tieneSucursales → "por_cp_origen"
//     (asumimos modalidad por CP cuando hay sucursales cargadas; YAGNI hasta
//     que aparezca un courier con sucursales pero sin SucursalCourierCp)
//   - Si puedeConsolidar Y cpDepositoConsolidador no-null → "sucursal_unica"
//   - Resto → "sin_sucursales"
//
// =============================================================================

import { Courier } from "@prisma/client";
import { tieneSucursales, type CourierConServicios } from "@/lib/couriers/serviciosSoportados";

export type ModalidadAsignacionSucursal =
  | "por_cp_origen"
  | "sucursal_unica"
  | "libre_cercania"
  | "sin_sucursales";

// Fase K (DEUDA 32+37): tieneSucursales se deriva del servicio entrega_sucursal
// via el helper del registry. El courier debe traer el array servicios cargado
// con (al menos) la fila de entrega_sucursal — los callers deben usar include.
export function getModalidadAsignacion(courier: Courier & CourierConServicios): ModalidadAsignacionSucursal {
  if (tieneSucursales(courier)) {
    return "por_cp_origen";
  }
  if (courier.puedeConsolidar && courier.cpDepositoConsolidador) {
    return "sucursal_unica";
  }
  return "sin_sucursales";
}
