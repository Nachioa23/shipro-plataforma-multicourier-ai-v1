// ============================================================================
// TORRE DE CONTROL — METRICA 1.3 "NPS Cliente Empresa"
//
// Mide la satisfaccion de la empresa cliente Shipro con la plataforma.
// Disparos trimestrales via cron /api/cron/nps-empresa. Universo: encuestas
// con score != NULL (placeholders no votados quedan fuera del cuerpo del
// calculo pero forman parte de "totalEnviadas" para tasa de respuesta).
//
// Decisiones (director 2026-06-11):
// - Ventana 1 ano (4 trimestres) por defecto.
// - NPS global ponderado por empresa (cada empresa pesa igual).
// - Cortes: por empresa + por periodo + topPromotores/Detractores con
//   comentarios + satisfacciones complementarias (plataforma + soporte).
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  calcularNPSEmpresa,
  calcularNPSPorEmpresa,
  type EncuestaVotada,
} from "@/lib/utils/nps-empresa";
import { calcularPeriodoActual } from "@/lib/utils/periodo";

const VENTANA_DIAS = 365;  // 4 trimestres

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json(
        { error: "Acceso solo para roles Shipro." },
        { status: 403 }
      );
    }

    const ventanaInicio = new Date();
    ventanaInicio.setDate(ventanaInicio.getDate() - VENTANA_DIAS);

    const periodoActual = calcularPeriodoActual();

    // Fetch todas las encuestas en ventana (votadas y no votadas).
    const todas = await prisma.encuestaNPSEmpresa.findMany({
      where: {
        fechaEnvio: { gte: ventanaInicio },
      },
      include: {
        empresa: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, email: true } },
      },
      orderBy: { fechaVoto: "desc" },
    });

    const votadas = todas.filter(e => e.score !== null && e.categoria !== null);
    const totalEnviadas = todas.length;

    // Shape para helper.
    const encuestasParaHelper: EncuestaVotada[] = votadas.map(e => ({
      score: e.score!,
      categoria: e.categoria!,
      empresaId: e.empresaId,
      satisfaccionPlataforma: e.satisfaccionPlataforma,
      calidadSoporte: e.calidadSoporte,
    }));

    const resumen = calcularNPSEmpresa(
      encuestasParaHelper,
      totalEnviadas,
      periodoActual
    );

    // Cortes por empresa.
    const enriquecidas = votadas.map(e => ({
      score: e.score!,
      categoria: e.categoria!,
      empresaId: e.empresaId,
      empresaNombre: e.empresa.nombre,
      satisfaccionPlataforma: e.satisfaccionPlataforma,
      calidadSoporte: e.calidadSoporte,
    }));

    const porEmpresa = calcularNPSPorEmpresa(enriquecidas);

    // Por periodo (timeline).
    const porPeriodoMap = new Map<string, EncuestaVotada[]>();
    for (const e of votadas) {
      if (!porPeriodoMap.has(e.periodo)) porPeriodoMap.set(e.periodo, []);
      porPeriodoMap.get(e.periodo)!.push({
        score: e.score!,
        categoria: e.categoria!,
        empresaId: e.empresaId,
        satisfaccionPlataforma: e.satisfaccionPlataforma,
        calidadSoporte: e.calidadSoporte,
      });
    }

    const porPeriodo = Array.from(porPeriodoMap.entries())
      .map(([periodo, votos]) => {
        const npsDelPeriodo = calcularNPSEmpresa(votos, votos.length, periodo);
        return {
          periodo,
          totalVotos: votos.length,
          npsScorePonderado: npsDelPeriodo.npsScorePonderado,
          npsScoreRaw: npsDelPeriodo.npsScoreRaw,
          scorePromedio: npsDelPeriodo.scorePromedioRaw,
        };
      })
      .sort((a, b) => a.periodo.localeCompare(b.periodo));

    // Top comentarios.

    const topPromotores = votadas
      .filter(e => e.categoria === "PROMOTOR")
      .filter(e => e.fortaleza && e.fortaleza.trim().length > 0)
      .slice(0, 10)
      .map(e => ({
        empresaNombre: e.empresa.nombre,
        usuarioNombre: e.usuario.nombre,
        score: e.score,
        fortaleza: e.fortaleza,
        periodo: e.periodo,
        fechaVoto: e.fechaVoto,
      }));

    const topDetractores = votadas
      .filter(e => e.categoria === "DETRACTOR")
      .filter(e => e.sugerencia && e.sugerencia.trim().length > 0)
      .slice(0, 10)
      .map(e => ({
        empresaNombre: e.empresa.nombre,
        usuarioNombre: e.usuario.nombre,
        score: e.score,
        sugerencia: e.sugerencia,
        periodo: e.periodo,
        fechaVoto: e.fechaVoto,
      }));

    return NextResponse.json({
      resumen,
      porEmpresa,
      porPeriodo,
      topPromotores,
      topDetractores,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        periodoActual,
        totalEncuestasEnviadas: totalEnviadas,
        totalEncuestasVotadas: votadas.length,
        fuente: "EncuestaNPSEmpresa (poblada via cron /api/cron/nps-empresa + POST del usuario)",
        nivelImplementado: "NIVEL 1 (datos de EncuestaNPSEmpresa)",
        nivelPendiente: "NIVEL 2 (DEUDA 60): cron trimestral activo + reenvio manual override",
      },
    });
  } catch (error: any) {
    console.error("[Torre de Control] Error en nps-cliente-empresa:", error);
    return NextResponse.json(
      { error: "Error calculando metrica NPS Cliente Empresa" },
      { status: 500 }
    );
  }
}
