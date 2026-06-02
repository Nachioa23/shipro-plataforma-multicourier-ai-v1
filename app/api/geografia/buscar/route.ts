import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizarProvincia } from "@/lib/constants/normalizar-provincia";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cp = searchParams.get('cp');

    if (!cp) {
      return NextResponse.json({ error: "Falta el Código Postal" }, { status: 400 });
    }

    // Buscamos el CP en la base de datos, trayendo también sus localidades y la provincia
    const codigoData = await prisma.codigoPostal.findUnique({
      where: { codigo: cp },
      include: {
        localidades: {
          include: { provincia: true }
        }
      }
    });

    if (!codigoData || codigoData.localidades.length === 0) {
      return NextResponse.json({ error: "Código Postal no encontrado" }, { status: 404 });
    }

    // DEUDA 26 (RESUELTA 2026-06-03 Fase F): "provincia dominante".
    // La realidad postal argentina permite que un CP cubra localidades en mas
    // de 1 provincia (92 casos: zonas limitrofes legitimas tipo Delta del
    // Parana, Bariloche/Isla Victoria, NEA, etc.). Antes este endpoint tomaba
    // localidades[0].provincia arbitrariamente — podia devolver la provincia
    // minoritaria (ej: CP 8400 retornaba "Neuquén" en vez de "Río Negro"
    // porque "ISLA VICTORIA" venia primero por id).
    //
    // Solucion: agrupar localidades por provincia, elegir la dominante (mas
    // localidades), filtrar la respuesta para que provincia + localidades sean
    // coherentes entre si.
    //
    // Trade-off: las localidades de la provincia minoritaria NO aparecen en
    // el dropdown del comprador (ej: "ISLA VICTORIA" no aparece bajo CP 8400).
    // <0.01% de los casos. Si un comprador necesita enviar a una localidad
    // minoritaria, corrige manualmente la provincia desde el form.
    //
    // Provincias basura del parseo CSV (PRE-Fase C) ya no existen — la
    // migration 20260602154255_deuda_26_limpieza_provincias_basura las borro.
    // normalizarProvincia() retorna null solo si llega input invalido (defensa).
    const byProvincia = new Map<string, typeof codigoData.localidades>();
    for (const loc of codigoData.localidades) {
      const key = loc.provincia.nombre;
      const bucket = byProvincia.get(key) ?? [];
      bucket.push(loc);
      byProvincia.set(key, bucket);
    }

    // Stable sort por cantidad de localidades DESC. Tie-breaker: orden de
    // insercion del Map (que viene del orden de id de Localidad en Prisma).
    const ordenadas = [...byProvincia.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    const [provinciaRaw, localidadesDominantes] = ordenadas[0];
    const provincia = normalizarProvincia(provinciaRaw);

    if (!provincia) {
      return NextResponse.json({ provincia: null, localidades: [] });
    }

    const localidades = localidadesDominantes.map(loc => loc.nombre);

    return NextResponse.json({ provincia, localidades });

  } catch (error) {
    console.error("Error buscando geografía:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}