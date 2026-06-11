// ============================================================================
// TORRE DE CONTROL — METRICA 1.2 "NPS Comprador"
//
// Mide la satisfaccion del comprador final del e-commerce con la experiencia
// de entrega. NPS = %Promotores - %Detractores. Datos de EncuestaNPS
// poblada via /api/nps cuando el comprador vota desde el email.
//
// Decisiones (director 2026-06-11):
// - Universo: encuestas en ventana 90 dias (fechaVoto).
// - Denominador para tasaRespuesta: envios ENTREGADO en la misma ventana.
// - Cortes: courier + empresa + provincia + modalidad + friccionEntrega +
//   cruceSLA + ultimosComentarios + porMes.
// - Comentarios separados: top 10 promotores + top 10 detractores (sirve
//   para identificar campeones de marca vs riesgos).
//
// NIVEL 1 (V1): solo data de EncuestaNPS.
// NIVEL 2 (DEUDA 59): activar disparo automatico del email post-entrega
//   para que la metrica reciba data real continua.
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  calcularNPS,
  agruparPorDimension,
  calcularFriccion,
  calcularCruceSLA,
  type EncuestaParaResumir,
} from "@/lib/utils/nps";

const VENTANA_DIAS = 90;

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json({ error: "Acceso solo para roles Shipro." }, { status: 403 });
    }

    const ventanaInicio = new Date();
    ventanaInicio.setDate(ventanaInicio.getDate() - VENTANA_DIAS);

    // Fetch encuestas + relations.
    const encuestas = await prisma.encuestaNPS.findMany({
      where: {
        fechaVoto: { gte: ventanaInicio },
      },
      include: {
        courier: { select: { id: true, nombre: true } },
        envio: {
          include: {
            empresa: { select: { id: true, nombre: true } },
          },
        },
      },
      orderBy: { fechaVoto: "desc" },
    });

    // Universo elegible para tasaRespuesta: envios entregados en la ventana.
    const enviosEntregados = await prisma.envio.count({
      where: {
        fechaImpresion: { gte: ventanaInicio },
        estadoActual: "ENTREGADO",
      },
    });

    // Shape para el helper.
    const encuestasParaHelper: EncuestaParaResumir[] = encuestas.map(e => ({
      score: e.score,
      categoria: e.categoria,
      experienciaEntrega: e.experienciaEntrega,
      slaCumplido: e.slaCumplido,
    }));

    // Resumen agregado.
    const resumen = calcularNPS(encuestasParaHelper, enviosEntregados);

    // ============================================================
    // Cortes por dimension via helper generico.
    // ============================================================

    // Para cada corte, mantenemos el shape EncuestaParaResumir + el dato
    // adicional necesario (nombre del courier/empresa/provincia/modalidad).
    // El helper agrupa por keyFn que recibe la encuesta enriquecida.

    type EncuestaEnriquecida = EncuestaParaResumir & {
      courierNombre: string;
      empresaNombre: string;
      provincia: string | null;
      modalidad: string | null;
    };

    const enriquecidas: EncuestaEnriquecida[] = encuestas.map(e => ({
      score: e.score,
      categoria: e.categoria,
      experienciaEntrega: e.experienciaEntrega,
      slaCumplido: e.slaCumplido,
      courierNombre: e.courier?.nombre || "Desconocido",
      empresaNombre: e.envio?.empresa?.nombre || "Desconocido",
      provincia: e.provincia,
      modalidad: e.modalidad,
    }));

    const porCourier = agruparPorDimension(
      enriquecidas,
      (e: any) => e.courierNombre
    );
    const porEmpresa = agruparPorDimension(
      enriquecidas,
      (e: any) => e.empresaNombre
    );
    const porProvincia = agruparPorDimension(
      enriquecidas,
      (e: any) => e.provincia
    );
    const porModalidad = agruparPorDimension(
      enriquecidas,
      (e: any) => e.modalidad
    );

    // ============================================================
    // Friccion de entrega + cruce SLA.
    // ============================================================
    const friccionEntrega = calcularFriccion(encuestasParaHelper);
    const cruceSLA = calcularCruceSLA(encuestasParaHelper);

    // ============================================================
    // Top comentarios (promotores + detractores).
    // ============================================================
    const conComentario = encuestas.filter(e => e.comentario && e.comentario.trim().length > 0);

    const topPromotores = conComentario
      .filter(e => e.categoria === "PROMOTOR")
      .slice(0, 10)
      .map(e => ({
        envioId: e.envioId,
        score: e.score,
        categoria: e.categoria,
        comentario: e.comentario!,
        experienciaEntrega: e.experienciaEntrega,
        fechaVoto: e.fechaVoto,
        courierNombre: e.courier?.nombre || "Desconocido",
        empresaNombre: e.envio?.empresa?.nombre || "Desconocido",
      }));

    const topDetractores = conComentario
      .filter(e => e.categoria === "DETRACTOR")
      .slice(0, 10)
      .map(e => ({
        envioId: e.envioId,
        score: e.score,
        categoria: e.categoria,
        comentario: e.comentario!,
        experienciaEntrega: e.experienciaEntrega,
        sugerenciaMejora: e.sugerenciaMejora,
        fechaVoto: e.fechaVoto,
        courierNombre: e.courier?.nombre || "Desconocido",
        empresaNombre: e.envio?.empresa?.nombre || "Desconocido",
      }));

    // ============================================================
    // Por mes (evolucion del NPS).
    // ============================================================
    const porMesMap = new Map<string, EncuestaParaResumir[]>();

    for (const e of encuestas) {
      const fecha = e.fechaVoto;
      const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
      if (!porMesMap.has(mesKey)) porMesMap.set(mesKey, []);
      porMesMap.get(mesKey)!.push({
        score: e.score,
        categoria: e.categoria,
        experienciaEntrega: e.experienciaEntrega,
        slaCumplido: e.slaCumplido,
      });
    }

    const porMes = Array.from(porMesMap.entries())
      .map(([mes, grupo]) => {
        const r = calcularNPS(grupo);
        return {
          mes,
          totalEncuestas: r.totalEncuestas,
          npsScore: r.npsScore,
          promotores: r.promotores,
          pasivos: r.pasivos,
          detractores: r.detractores,
        };
      })
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return NextResponse.json({
      resumen,
      porCourier,
      porEmpresa,
      porProvincia,
      porModalidad,
      friccionEntrega,
      cruceSLA,
      topPromotores,
      topDetractores,
      porMes,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        totalEncuestas: encuestas.length,
        totalEntregados: enviosEntregados,
        fuente: "EncuestaNPS (poblada via /api/nps tras voto del comprador desde email post-entrega)",
        nivelImplementado: "NIVEL 1 (data de EncuestaNPS)",
        nivelPendiente: "NIVEL 2 (DEUDA 59): activar disparo automatico del email post-entrega",
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en nps-comprador:", error);
    return NextResponse.json(
      { error: "Error calculando metrica NPS Comprador" },
      { status: 500 }
    );
  }
}
