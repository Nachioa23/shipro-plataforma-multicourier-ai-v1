// =============================================================================
// DEUDA 144 — Enumeración de servicios publicados por empresa.
// =============================================================================
// Base del registro de carrier options en Tiendanube + alineación de codes del
// rates callback. Fuente ÚNICA del `code` estable: `courier + codigoServicio`
// canónico del registry (NO el string dinámico del adapter). Estable — no
// depende del CP destino ni del carrito — por eso pre-registrable en Tiendanube.
//
// Tiendanube exige que cada `code` emitido en rates esté pre-registrado como
// carrier option (sin registro previo → la rate se descarta silenciosamente,
// DEUDA 130). Este helper resuelve el otro extremo: el conjunto ESTABLE de
// (courier + servicio) que la empresa X publica en su checkout.
//
// Cross-consumer: el mismo output alimenta:
//   1. El registro de shipping_carrier_options al instalar/reinstalar el plugin.
//   2. El rates callback (para emitir codes que matchean los pre-registrados).
//
// Filtro (mirror de cotizador.ts, 3 gates):
//   1. TÉCNICO: ServicioCourier.capacidadTecnicaMapeada != null (adapter soporta).
//   2. SHIPRO: ServicioCourier.activo=true (admin prendió el servicio).
//   3. CLIENTE: CredencialCourier.ofrece{Domicilio,Sucursal} (cliente lo habilitó).
//
// Solo se emiten servicios de ENTREGA (domicilio/sucursal). Inversa/cambio/
// devolución NO van al carrier de checkout — quedan filtrados en el mapeo.
// =============================================================================

import prisma from "@/lib/prisma";
import {
  displayCourier,
  labelServicio,
} from "@/lib/couriers/serviciosSoportados";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";

/**
 * Slug estable para el `code` que Tiendanube pre-registra y matchea contra rates.
 * Formato: `{courier}-{codigoServicio}` lowercase, non-alnum → guion, sin bordes.
 * Ejemplo: `andreani-entrega_domicilio_estandar` → `"andreani-entrega-domicilio-estandar"`.
 *
 * Debe ser reutilizado por CUALQUIER emisor de codes (carrier options + rates)
 * — codes distintos entre emisores hacen que Tiendanube descarte la rate.
 */
export function generarCodeServicio(courierNombre: string, codigoServicio: string): string {
  return `${courierNombre}-${codigoServicio}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface ServicioPublicado {
  /** Nombre canónico del courier (como viene de CredencialCourier.nombreCourier). */
  courierNombre: string;
  /** Código canónico del servicio del registry (ej. "entrega_domicilio_estandar"). */
  codigoServicio: string;
  /** Tipo de entrega técnico (usado por adapter/cotizador). */
  tipoEntrega: "domicilio" | "sucursal";
  /** Type de Tiendanube (domicilio → ship, sucursal → pickup). */
  type: "ship" | "pickup";
  /** Slug estable para registrar como carrier option + emitir en rates. */
  code: string;
  /** Nombre humano al comprador (ej. "Andreani - Entrega a domicilio (Estandar)"). */
  name: string;
}

/**
 * Enumera los servicios que la empresa publica al comprador (delivery only:
 * domicilio + sucursal). Es la fuente para registrar carrier options en Tiendanube
 * y para alinear los codes del rates callback.
 *
 * @param empresaId - ID de la empresa Shipro.
 * @returns Lista deduplicada por `code`, en el orden en que se descubren.
 */
export async function enumerarServiciosPublicados(empresaId: number): Promise<ServicioPublicado[]> {
  // 1. Credenciales activas de la empresa (con qué couriers trabaja).
  const credenciales = await prisma.credencialCourier.findMany({
    where: { empresaId, activo: true },
    select: { nombreCourier: true, ofreceDomicilio: true, ofreceSucursal: true },
  });
  if (credenciales.length === 0) return [];

  const nombresCouriers = credenciales.map((c) => c.nombreCourier);

  // 2. Couriers reales + sus servicios activos + mapeados (mismo pattern que cotizador).
  const couriers = await prisma.courier.findMany({
    where: { nombre: { in: nombresCouriers } },
    include: {
      servicios: {
        where: { activo: true, capacidadTecnicaMapeada: { not: null } },
      },
    },
  });

  // Index de couriers por nombre canonicalizado para hacer match con la credencial.
  const courierPorNombre = new Map<string, (typeof couriers)[number]>();
  for (const c of couriers) {
    courierPorNombre.set(normalizarParaComparacion(c.nombre), c);
  }

  // 3. Iterar credenciales × servicios activos, aplicando el gate cliente-level.
  const resultado: ServicioPublicado[] = [];
  const codesVistos = new Set<string>();

  for (const cred of credenciales) {
    const claveCourier = normalizarParaComparacion(cred.nombreCourier);
    const courier = courierPorNombre.get(claveCourier);
    if (!courier) continue; // Credencial apunta a courier que no está en la tabla — silent skip.

    for (const servicio of courier.servicios) {
      // Solo servicios de ENTREGA van al checkout. La logística inversa (devolución/
      // cambio) reutiliza el canal técnico "sucursal", así que el gate por capacidad
      // no alcanza — filtramos por el grupo canónico del servicio.
      if (servicio.grupo !== "entrega") continue;

      const capacidad = servicio.capacidadTecnicaMapeada;
      // Defense in depth: aún dentro del grupo "entrega", solo domicilio/sucursal
      // aplican al carrier de checkout (excluye eventuales entrega_punto_retiro,
      // entrega_elocker, etc. cuando el registry los mapee a otras capacidades).
      let tipoEntrega: "domicilio" | "sucursal";
      if (capacidad === "domicilio") tipoEntrega = "domicilio";
      else if (capacidad === "sucursal") tipoEntrega = "sucursal";
      else continue;

      // Gate cliente-level (los booleanos gruesos en CredencialCourier).
      if (tipoEntrega === "domicilio" && cred.ofreceDomicilio === false) continue;
      if (tipoEntrega === "sucursal" && cred.ofreceSucursal === false) continue;

      const code = generarCodeServicio(cred.nombreCourier, servicio.codigoServicio);
      if (codesVistos.has(code)) continue; // dedup defensivo
      codesVistos.add(code);

      resultado.push({
        courierNombre: cred.nombreCourier,
        codigoServicio: servicio.codigoServicio,
        tipoEntrega,
        type: tipoEntrega === "domicilio" ? "ship" : "pickup",
        code,
        name: `${displayCourier(claveCourier)} - ${labelServicio(servicio.codigoServicio)}`,
      });
    }
  }

  return resultado;
}
