// ==========================================================================
// DEUDA 29 Sub-fase 2.B — Endpoint de sucursales de un courier para un
// depósito específico, ordenadas por cercanía geográfica (Haversine).
//
// Path: GET /api/depositos/[id]/sucursales-courier/[courierId]
//
// Devuelve:
//   - sucursalesCercanas: top 20 por distancia Haversine
//   - sucursalesPorCP: sucursales que atienden el CP del depósito
//   - sucursalPreferidaActual: preferencia configurada (si existe)
//
// Usado por la UI de configuración (Sub-fase 2.C) para que el cliente
// elija qué sucursal Andreani usar como origen al despachar desde
// un depósito específico.
// ==========================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { calcularDistanciaKm } from "@/lib/geo/haversine";
import { formatSucursal } from "@/lib/sucursales/format";
import type { SucursalCourier } from "@prisma/client";

type SucursalConDistancia = SucursalCourier & { distanciaKm: number };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; courierId: string }> }
) {
  const { id, courierId: courierIdRaw } = await params;
  const depositoId = parseInt(id);
  const courierId = parseInt(courierIdRaw);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "ID de depósito inválido" }, { status: 400 });
  }
  if (isNaN(courierId)) {
    return NextResponse.json({ error: "ID de courier inválido" }, { status: 400 });
  }

  // Auth + ownership: valida sesión, rol de lectura, existencia del depósito
  // y que pertenezca a la empresa del usuario (cliente intentando ver depósito
  // de otra empresa recibe 404 para no exponer existencia).
  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;
  const deposito = acceso.deposito;

  // Courier activo. 404 si no existe O está inactivo (no exponer diferencia —
  // misma política que verificarAccesoDeposito ante ownership mismatch).
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, activo: true },
  });
  if (!courier) {
    return NextResponse.json({ error: "Courier no encontrado o inactivo" }, { status: 404 });
  }

  // 3 queries paralelas: candidatas para cercanía + matches por CP del
  // depósito + preferencia configurada (puede ser null).
  const [sucursalesActivas, matchesPorCP, preferencia] = await Promise.all([
    prisma.sucursalCourier.findMany({
      where: {
        courierId,
        activa: true,
        eliminada: false,
        aceptaAdmision: true,
      },
    }),
    prisma.sucursalCourierCp.findMany({
      where: {
        codigoPostal: deposito.codigoPostal,
        sucursal: {
          courierId,
          activa: true,
          eliminada: false,
          aceptaAdmision: true,
        },
      },
      include: { sucursal: true },
    }),
    prisma.depositoSucursalPreferida.findUnique({
      where: { depositoId_courierId: { depositoId, courierId } },
      include: { sucursal: true },
    }),
  ]);

  // Ranking por cercanía Haversine. Solo si el depósito tiene coords:
  //   - Si depósito sin lat/lng → sucursalesCercanas: [] (no podemos rankear).
  //   - Si depósito con coords stale (lat≠null, ultimaGeocodificacion=null)
  //     → igual computamos con esas coords; el flag coordsActualizadas:false
  //     le avisa al frontend para mostrar "ubicación desactualizada".
  // Sucursales sin coords (latitud o longitud null) se filtran del ranking
  // — no podemos calcular distancia desde ellas.
  let sucursalesCercanas: SucursalConDistancia[] = [];
  if (deposito.latitud !== null && deposito.longitud !== null) {
    const depLat = deposito.latitud;
    const depLng = deposito.longitud;
    sucursalesCercanas = sucursalesActivas
      .map(s => {
        if (s.latitud === null || s.longitud === null) return null;
        const distanciaKm = calcularDistanciaKm(depLat, depLng, s.latitud, s.longitud);
        return { ...s, distanciaKm };
      })
      .filter((s): s is SucursalConDistancia => s !== null && isFinite(s.distanciaKm))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, 20);
  }

  // Convención Sub-fase 2.B.0: coords stale = latitud IS NOT NULL AND
  // ultimaGeocodificacion IS NULL (cambio de dirección + Google falló).
  const coordsActualizadas =
    deposito.latitud !== null && deposito.ultimaGeocodificacion !== null;

  return NextResponse.json({
    deposito: {
      id: deposito.id,
      nombre: deposito.nombre,
      codigoPostal: deposito.codigoPostal,
      localidad: deposito.localidad,
      provincia: deposito.provincia,
      latitud: deposito.latitud,
      longitud: deposito.longitud,
      ultimaGeocodificacion: deposito.ultimaGeocodificacion,
      coordsActualizadas,
    },
    courier: {
      id: courier.id,
      nombre: courier.nombre,
    },
    sucursalesCercanas: sucursalesCercanas.map(s => formatSucursal(s, s.distanciaKm)),
    sucursalesPorCP: matchesPorCP.map(m => formatSucursal(m.sucursal)),
    sucursalPreferidaActual: preferencia
      ? {
          id: preferencia.id,
          sucursalCourierId: preferencia.sucursalCourierId,
          sucursal: formatSucursal(preferencia.sucursal),
        }
      : null,
  });
}
