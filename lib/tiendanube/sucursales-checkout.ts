// =============================================================================
// DEUDA 144 — Resolver de sucursales cercanas para el checkout de Tiendanube.
// =============================================================================
// Dado el punto (lat,lng) del comprador (ya geocodificado por el caller) y un
// courier, devuelve las N sucursales pickup-elegibles más cercanas desde el BD
// local (SucursalCourier), rankeadas por Haversine, cada una con `address` +
// `hours` en el formato exacto que Tiendanube exige en rates type=pickup.
//
// DECISIÓN DE PRODUCTO (Nacho): se lee del BD local, NO se llama a la API del
// courier en vivo. En el hot path del rates callback Tiendanube corta a los 10s;
// una request extra en vivo (Andreani /v2/sucursales típicamente ~500-2000ms +
// timeout de 8s en falla) arriesga dejar al comprador SIN opciones de envío.
// El BD lo alimenta un job de sync (lib/sucursales/sync.ts) — está fresco al
// nivel de "hoy" o "última corrida", suficiente para el ranking del checkout.
//
// GAP ACEPTADO: entre el BD y el estado real de Andreani puede haber sucursales
// apagadas/suspendidas desde el último sync. Se acepta y se mitiga en el
// Momento 3 (creación de etiqueta): si la sucursal elegida por el comprador
// está apagada al momento de crear la etiqueta, se deriva a la más cercana AL
// COMPRADOR y se le notifica por mail. Esa derivación REUSA este mismo
// resolver — pasando (lat,lng) del comprador y descartando la sucursalId
// original. Por eso devolvemos `sucursalId` en el resultado: la elección
// tiene que viajar hasta el momento de la etiqueta.
//
// NO geocodifica (el caller lo hace una sola vez y comparte coords con la
// cotización), NO cachea (el BD ya es rápido), NO llama a Tiendanube.
// =============================================================================

import prisma from "@/lib/prisma";
import { calcularDistanciaKm } from "@/lib/geo/haversine";
import {
  parsearHorarios,
  type HorarioTiendanube,
} from "@/lib/tiendanube/horarios";

/**
 * Sub-objeto `address` que Tiendanube espera dentro de cada rate de pickup.
 * Nombres de campos EN INGLÉS por contrato oficial. locality y city van con el
 * mismo valor (nuestro schema no distingue). country hardcodeado "AR" (Andreani
 * es 100% AR; cuando entren couriers regionales habrá que revisar).
 */
export interface DireccionSucursalTN {
  address: string | null;
  number: string | null;
  floor: string | null;
  locality: string;
  city: string;
  province: string;
  country: string;
  zipcode: string;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
}

export interface SucursalCheckout {
  /** id local en SucursalCourier — pivot para el Momento 3 (crear etiqueta). */
  sucursalId: number;
  /** Nombre legible ("SANTA FE (CENTRO)") — cara al comprador vía rate.name. */
  nombre: string;
  address: DireccionSucursalTN;
  hours: HorarioTiendanube[];
  /** Distancia Haversine al comprador (km, 2 decimales). Para debug/log, no viaja a TN. */
  distanciaKm: number;
}

/**
 * Devuelve las `topN` sucursales pickup-elegibles del courier más cercanas al
 * punto (lat,lng) del comprador. Formato listo para embutir en un rate de
 * pickup de Tiendanube (address + hours).
 *
 * Elegibilidad (mismos gates que usaría el sync/despacho): activa=true,
 * eliminada=false, aceptaEntrega=true, latitud/longitud no-null (sin coords
 * no las podemos rankear, así que se descartan del pool).
 *
 * Match del courier por nombre case-insensitive (mismo patrón que otros
 * consumidores del proyecto). Si el courier no existe → []; si existe pero
 * no tiene sucursales elegibles → [].
 *
 * @param params.courierNombre Nombre canónico del courier ("Andreani", "Moci's", ...).
 * @param params.lat Latitud del comprador (ya geocodificada por el caller).
 * @param params.lng Longitud del comprador.
 * @param params.topN Cuántas devolver. Default 5.
 */
export async function resolverSucursalesCercanas(params: {
  courierNombre: string;
  lat: number;
  lng: number;
  topN?: number;
}): Promise<SucursalCheckout[]> {
  const { courierNombre, lat, lng, topN = 5 } = params;

  const courier = await prisma.courier.findFirst({
    where: { nombre: { equals: courierNombre, mode: "insensitive" } },
    select: { id: true },
  });
  if (!courier) return [];

  const sucursales = await prisma.sucursalCourier.findMany({
    where: {
      courierId: courier.id,
      activa: true,
      eliminada: false,
      aceptaEntrega: true,
      latitud: { not: null },
      longitud: { not: null },
    },
  });
  if (sucursales.length === 0) return [];

  const rankeadas = sucursales
    .map((s) => ({
      s,
      distanciaKm: calcularDistanciaKm(
        lat,
        lng,
        s.latitud as number,
        s.longitud as number,
      ),
    }))
    .sort((a, b) => a.distanciaKm - b.distanciaKm)
    .slice(0, topN);

  return rankeadas.map(({ s, distanciaKm }) => ({
    sucursalId: s.id,
    nombre: s.nombre,
    address: {
      address: s.direccionCalle,
      number: s.direccionAltura,
      floor: s.direccionPiso,
      locality: s.localidad,
      city: s.localidad,
      province: s.provincia,
      country: "AR",
      zipcode: s.codigoPostal,
      phone: s.telefono,
      latitude: s.latitud !== null ? String(s.latitud) : null,
      longitude: s.longitud !== null ? String(s.longitud) : null,
    },
    hours: parsearHorarios(s.horariosJson),
    distanciaKm: parseFloat(distanciaKm.toFixed(2)),
  }));
}
