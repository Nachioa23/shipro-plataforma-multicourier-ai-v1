// =============================================================================
// HELPER: formatSucursal(s, distanciaKm?)
// DEUDA 29 Sub-fase 6.D.3 (2026-05-20)
// =============================================================================
//
// Formatea una SucursalCourier del schema Prisma en el shape que devuelven
// los endpoints REST. Extraído del endpoint 2.B (commit 346658e) para evitar
// duplicación entre 2.B y 6.D.3 + permitir consistencia futura.
//
// IMPORTANTE: el shape de SucursalFormateada es exactamente el que ya devuelve
// 2.B en producción. NO modificar sin verificar consumidores (frontend Mis
// Transportes + envío checkout). Si se necesita un campo nuevo, agregarlo SIN
// quitar los existentes.
//
// distanciaKm es opcional: se incluye SOLO cuando viene del caller (ej. lista
// de cercanas en 2.B). Cuando no viene, el campo se omite del objeto (no se
// envía con valor undefined).
//
// =============================================================================

import type { SucursalCourier } from "@prisma/client";

export type SucursalFormateada = {
  id: number;
  idExterno: string;
  codigo: string | null;
  nombre: string;
  direccionCalle: string | null;
  direccionAltura: string | null;
  codigoPostal: string;
  localidad: string;
  provincia: string;
  latitud: number | null;
  longitud: number | null;
  distanciaKm?: number;
  aceptaAdmision: boolean;
  aceptaEntrega: boolean;
  seHaceAtencionAlCliente: boolean;
  tieneBuzonInteligente: boolean;
  telefono: string | null;
  horariosJson: string | null;
};

export function formatSucursal(
  s: SucursalCourier,
  distanciaKm?: number
): SucursalFormateada {
  return {
    id: s.id,
    idExterno: s.idExterno,
    codigo: s.codigo,
    nombre: s.nombre,
    direccionCalle: s.direccionCalle,
    direccionAltura: s.direccionAltura,
    codigoPostal: s.codigoPostal,
    localidad: s.localidad,
    provincia: s.provincia,
    latitud: s.latitud,
    longitud: s.longitud,
    ...(distanciaKm !== undefined && { distanciaKm: parseFloat(distanciaKm.toFixed(2)) }),
    aceptaAdmision: s.aceptaAdmision,
    aceptaEntrega: s.aceptaEntrega,
    seHaceAtencionAlCliente: s.seHaceAtencionAlCliente,
    tieneBuzonInteligente: s.tieneBuzonInteligente,
    telefono: s.telefono,
    horariosJson: s.horariosJson,
  };
}
