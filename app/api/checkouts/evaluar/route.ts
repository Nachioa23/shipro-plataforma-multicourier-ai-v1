import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const ordenCruda = await request.json();
    const { id_tienda, tienda, comprador, email, telefono, direccion } = ordenCruda;

    let score = 100;
    let problemas: string[] = [];

    // 1. BUSCAMOS EL CP EN LA BASE DE DATOS REAL
    const codigoData = await prisma.codigoPostal.findUnique({
      where: { codigo: direccion.cp },
      include: { localidades: { include: { provincia: true } } }
    });

    // --- REGLAS DE VALIDACIÓN REALES ---
    if (!codigoData || codigoData.localidades.length === 0) {
      score -= 60;
      problemas.push(`El Código Postal ${direccion.cp} no existe en Argentina.`);
    } else {
      const provinciaReal = codigoData.localidades[0].provincia.nombre;
      const localidadesValidas = codigoData.localidades.map(l => l.nombre.toLowerCase());

      if (direccion.provincia.toLowerCase() !== provinciaReal.toLowerCase()) {
        score -= 40;
        problemas.push(`El CP ${direccion.cp} es de ${provinciaReal}, pero ingresó ${direccion.provincia}.`);
      }

      if (!localidadesValidas.some(loc => loc.includes(direccion.localidad.toLowerCase()) || direccion.localidad.toLowerCase().includes(loc))) {
        score -= 30;
        problemas.push(`El CP ${direccion.cp} no corresponde a la localidad ${direccion.localidad}.`);
      }
    }

    if (!/\d/.test(direccion.calle)) {
      score -= 30;
      problemas.push("Falta altura numérica en la dirección.");
    }

    // --- LA DECISIÓN ---
    if (score >= 80) {
      return NextResponse.json({ accion: "APROBADO", score });
    } else {
      // GUARDAMOS EN LA BASE DE DATOS (El Peaje frena la orden)
      const ordenFrenada = await prisma.auditoriaCheckout.create({
        data: {
          tienda: tienda || "Tienda Desconocida",
          comprador, email, telefono,
          direccionCruda: `${direccion.calle} ${direccion.cp}, ${direccion.localidad}, ${direccion.provincia}`,
          score,
          problemas: problemas.join(" | "),
          calle: direccion.calle.replace(/[0-9]/g, '').trim(),
          altura: direccion.calle.replace(/[^0-9]/g, ''),
          cp: direccion.cp,
          localidad: direccion.localidad,
          provincia: direccion.provincia
        }
      });

      return NextResponse.json({ accion: "FRENADO_EN_STANDBY", id_auditoria: ordenFrenada.id, score, problemas });
    }
  } catch (error) {
    return NextResponse.json({ error: "Error en el peaje" }, { status: 500 });
  }
}