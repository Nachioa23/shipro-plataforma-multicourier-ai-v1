import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";

function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function obtenerCredencialesShipro(courier: string) {
  const c = courier.toLowerCase().replace(/[']/g, ''); 
  if (c === 'andreani') {
    return { 
      username: process.env.ANDREANI_USER?.trim() || '', 
      password: process.env.ANDREANI_PASS?.trim() || '', 
      cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
      contrato_sucursal: process.env.ANDREANI_CONTRATO_SUC?.trim() || '',
      contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || ''
    };
  }
  return {};
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cp = searchParams.get("cp");
    const localidad = searchParams.get("localidad") || "";
    const courier = searchParams.get("courier") || "andreani";
    const empresaId = searchParams.get("empresaId") || "1";

    if (!cp) return NextResponse.json({ error: "Falta el Código Postal" }, { status: 400 });

    const nombreNormalizado = courier.toLowerCase().replace(/[']/g, '');
    
    const credencial = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId: parseInt(empresaId), nombreCourier: courier } }
    });

    // REGLA ESTRICTA DE CREDENCIALES
    let llaves = credencial?.usaCredencialesPropias 
      ? JSON.parse(credencial.credencialesJson || '{}') 
      : obtenerCredencialesShipro(nombreNormalizado);

    const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);
    let sucursales: any[] = await motorCourier.obtenerSucursales(cp);

    if (sucursales.length > 0) {
      const mapaUnicas = new Map();

      for (const suc of sucursales) {
        const nombreLimpio = (suc.nombre || "").toUpperCase().trim();

        if (suc.entregaEnvios === false) continue; 

        const esBasura = 
          nombreLimpio.includes('HOP') || 
          nombreLimpio.includes('WH ') || 
          nombreLimpio.startsWith('WH') ||
          nombreLimpio.includes('IN HOUSE') ||
          nombreLimpio.includes('PLANTA');

        if (esBasura) continue; 

        if (!mapaUnicas.has(nombreLimpio)) {
          mapaUnicas.set(nombreLimpio, suc);
        }
      }

      sucursales = Array.from(mapaUnicas.values());
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (googleApiKey && sucursales.length > 0) {
      try {
        const queryDireccion = `${cp}, ${localidad}, Argentina`;
        const googleRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryDireccion)}&key=${googleApiKey}`);
        const googleData = await googleRes.json();

        if (googleData.results && googleData.results.length > 0) {
          const latCliente = googleData.results[0].geometry.location.lat;
          const lngCliente = googleData.results[0].geometry.location.lng;

          sucursales = sucursales.map((suc: any) => {
            if (suc.latitud && suc.longitud) {
              const km = calcularDistancia(latCliente, lngCliente, suc.latitud, suc.longitud);
              return { ...suc, distanciaKm: parseFloat(km.toFixed(1)) }; 
            }
            return { ...suc, distanciaKm: 999 }; 
          });

          sucursales.sort((a: any, b: any) => (a.distanciaKm || 999) - (b.distanciaKm || 999));
        }
      } catch (err) {
        console.error("Error conectando con Google Maps API:", err);
      }
    }

    const top5Sucursales = sucursales.slice(0, 5);

    return NextResponse.json(top5Sucursales);

  } catch (error) {
    console.error("Error buscando sucursales:", error);
    return NextResponse.json({ error: "Error interno al buscar sucursales" }, { status: 500 });
  }
}