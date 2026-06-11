// ============================================================================
// ENDPOINT — NPS Cliente Empresa (Metrica 1.3, DEUDA 39, 2026-06-11)
//
// Flujo:
// 1. Cron disparador (DEUDA 60) crea EncuestaNPSEmpresa placeholder con
//    tokenVoto + empresaId + usuarioId + periodo + fechaEnvio. score y
//    categoria quedan en NULL.
// 2. Email contiene link al form: /encuesta-nps-empresa?token=XYZ&score=N
// 3. Form llama GET /api/nps-empresa?token=XYZ para validar + obtener contexto.
// 4. Usuario completa el form y POSTea las 5 respuestas + token.
// 5. POST actualiza el placeholder con score/categoria/satisfaccion/soporte/
//    fortaleza/sugerencia + fechaVoto = now().
//
// Sin auth (token cumple ese rol). Sin expiracion (decision director 2026-06-11).
// No permite re-voto (una vez con score != NULL, futuras requests son rechazadas).
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// ============================================================
// GET — validar token + devolver contexto para el form
// ============================================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Falta el token" }, { status: 400 });
    }

    const encuesta = await prisma.encuestaNPSEmpresa.findUnique({
      where: { tokenVoto: token },
      include: {
        empresa: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    if (!encuesta) {
      return NextResponse.json({ error: "Token invalido o no encontrado" }, { status: 404 });
    }

    // Si ya voto (score != NULL), rechazar.
    if (encuesta.score !== null && encuesta.score !== undefined) {
      return NextResponse.json(
        {
          error: "Ya respondiste esta encuesta. Gracias!",
          yaVoto: true,
          score: encuesta.score,
          fechaVoto: encuesta.fechaVoto,
        },
        { status: 409 }
      );
    }

    // Devolver contexto para que el form muestre datos.
    return NextResponse.json({
      empresa: encuesta.empresa,
      usuario: encuesta.usuario,
      periodo: encuesta.periodo,
      fechaEnvio: encuesta.fechaEnvio,
    });
  } catch (error: any) {
    console.error("[NPS Empresa GET] error:", error);
    return NextResponse.json({ error: "Error al validar token" }, { status: 500 });
  }
}

// ============================================================
// POST — guardar respuestas del form
// ============================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      token,
      score,
      satisfaccionPlataforma,
      calidadSoporte,
      fortaleza,
      sugerencia,
    } = body;

    if (!token) {
      return NextResponse.json({ error: "Falta el token" }, { status: 400 });
    }

    if (score === undefined || score === null) {
      return NextResponse.json({ error: "Falta el score" }, { status: 400 });
    }

    const scoreInt = parseInt(score);
    if (isNaN(scoreInt) || scoreInt < 0 || scoreInt > 10) {
      return NextResponse.json({ error: "Score invalido (debe ser 0-10)" }, { status: 400 });
    }

    // Validar escalas opcionales 1-5 si vienen.
    if (satisfaccionPlataforma !== undefined && satisfaccionPlataforma !== null) {
      const sp = parseInt(satisfaccionPlataforma);
      if (isNaN(sp) || sp < 1 || sp > 5) {
        return NextResponse.json({ error: "satisfaccionPlataforma invalida (1-5)" }, { status: 400 });
      }
    }

    if (calidadSoporte !== undefined && calidadSoporte !== null) {
      const cs = parseInt(calidadSoporte);
      if (isNaN(cs) || cs < 1 || cs > 5) {
        return NextResponse.json({ error: "calidadSoporte invalida (1-5)" }, { status: 400 });
      }
    }

    // Buscar la encuesta placeholder por tokenVoto.
    const encuesta = await prisma.encuestaNPSEmpresa.findUnique({
      where: { tokenVoto: token },
    });

    if (!encuesta) {
      return NextResponse.json({ error: "Token invalido o no encontrado" }, { status: 404 });
    }

    // Si ya voto, rechazar.
    if (encuesta.score !== null && encuesta.score !== undefined) {
      return NextResponse.json(
        { error: "Ya respondiste esta encuesta", yaVoto: true },
        { status: 409 }
      );
    }

    // Clasificar.
    let categoria = "PASIVO";
    if (scoreInt >= 9) categoria = "PROMOTOR";
    else if (scoreInt <= 6) categoria = "DETRACTOR";

    // Actualizar con respuestas reales.
    const actualizada = await prisma.encuestaNPSEmpresa.update({
      where: { tokenVoto: token },
      data: {
        score: scoreInt,
        categoria,
        satisfaccionPlataforma: satisfaccionPlataforma !== undefined && satisfaccionPlataforma !== null
          ? parseInt(satisfaccionPlataforma)
          : null,
        calidadSoporte: calidadSoporte !== undefined && calidadSoporte !== null
          ? parseInt(calidadSoporte)
          : null,
        fortaleza: fortaleza?.trim() || null,
        sugerencia: sugerencia?.trim() || null,
        fechaVoto: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      score: actualizada.score,
      categoria: actualizada.categoria,
      message: "Gracias por tu opinion!",
    });
  } catch (error: any) {
    console.error("[NPS Empresa POST] error:", error);
    return NextResponse.json({ error: "Error al guardar encuesta" }, { status: 500 });
  }
}
