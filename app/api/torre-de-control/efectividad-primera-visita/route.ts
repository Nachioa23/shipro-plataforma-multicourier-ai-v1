// ============================================================================
// TORRE DE CONTROL — METRICA 2.2 "Efectividad de Primera Visita"
//
// Mide el patron de visitas del courier hasta lograr la entrega.
// Universo: envios ENTREGADO + DEVUELTO_AL_REMITENTE (suma al funnel).
//
// Reglas (definidas por director 2026-06-09):
// - PRIMERA_VISITA_EXITOSA: ENTREGADO con 0 o 1 EN_DISTRIBUCION previos.
// - VISITAS_FORZADAS: ENTREGADO con 2+ EN_DISTRIBUCION previos.
// - DEVUELTO_AL_REMITENTE: cierre del ciclo original sin entrega exitosa.
// - Porcentajes calculados sobre universo total (suman 100%).
//
// Decision arquitectonica: usa helper canonico `lib/utils/efectividad-primera-visita.ts`
// que ya internamente normaliza eventos contra catalogo F1.
//
// Auth: modoDios (admin_shipro / operador_shipro). Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  clasificarEfectividad,
  obtenerMotivoUltimaFalla,
  resumirEfectividad,
} from "@/lib/utils/efectividad-primera-visita";

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

    // Fetch envios + eventos en la ventana.
    const envios = await prisma.envio.findMany({
      where: {
        fechaImpresion: { gte: ventanaInicio },
      },
      include: {
        eventos: { orderBy: { fecha: "asc" } },
        courier: { select: { id: true, nombre: true } },
        destino: { select: { provincia: true } },
      },
    });

    // ============================================================
    // 1. Resumen global agregado.
    // ============================================================
    const resumen = resumirEfectividad(envios.map(e => ({ id: e.id, eventos: e.eventos })));

    // ============================================================
    // 2. Funnel para el modal: las 3 categorias que suman al universo.
    // ============================================================
    const funnel = {
      primeraVisitaExitosa: {
        cantidad: resumen.totalPrimeraVisitaExitosa,
        porcentaje: resumen.porcentajePrimeraVisita,
      },
      visitasForzadas: {
        cantidad: resumen.totalVisitasForzadas,
        porcentaje: resumen.porcentajeVisitasForzadas,
      },
      devoluciones: {
        cantidad: resumen.totalDevueltos,
        porcentaje: resumen.porcentajeDevoluciones,
      },
    };

    // ============================================================
    // 3. Cortes por courier, provincia y mes.
    // ============================================================
    type GrupoEfectividad = {
      total: number;
      universo: number;
      primeraVisita: number;
      visitasForzadas: number;
      devoluciones: number;
    };
    const grupoVacio = (): GrupoEfectividad => ({
      total: 0, universo: 0, primeraVisita: 0, visitasForzadas: 0, devoluciones: 0,
    });

    const porCourierMap = new Map<string, { courierId: number; nombre: string; grupo: GrupoEfectividad }>();
    const porProvinciaMap = new Map<string, GrupoEfectividad>();
    const porMesMap = new Map<string, GrupoEfectividad>();

    for (const envio of envios) {
      const clasificacion = clasificarEfectividad(envio.eventos);
      const aplicaAlUniverso = clasificacion !== "NO_APLICA";

      // Corte courier.
      const courierKey = `${envio.courier.id}`;
      if (!porCourierMap.has(courierKey)) {
        porCourierMap.set(courierKey, {
          courierId: envio.courier.id,
          nombre: envio.courier.nombre,
          grupo: grupoVacio(),
        });
      }
      const grpCourier = porCourierMap.get(courierKey)!.grupo;
      grpCourier.total++;
      if (aplicaAlUniverso) {
        grpCourier.universo++;
        if (clasificacion === "PRIMERA_VISITA_EXITOSA") grpCourier.primeraVisita++;
        else if (clasificacion === "VISITAS_FORZADAS") grpCourier.visitasForzadas++;
        else if (clasificacion === "DEVUELTO_AL_REMITENTE") grpCourier.devoluciones++;
      }

      // Corte provincia (normalizada lowercase + trim).
      const provNorm = (envio.destino?.provincia || "Sin provincia").toLowerCase().trim();
      if (!porProvinciaMap.has(provNorm)) porProvinciaMap.set(provNorm, grupoVacio());
      const grpProv = porProvinciaMap.get(provNorm)!;
      grpProv.total++;
      if (aplicaAlUniverso) {
        grpProv.universo++;
        if (clasificacion === "PRIMERA_VISITA_EXITOSA") grpProv.primeraVisita++;
        else if (clasificacion === "VISITAS_FORZADAS") grpProv.visitasForzadas++;
        else if (clasificacion === "DEVUELTO_AL_REMITENTE") grpProv.devoluciones++;
      }

      // Corte mes (YYYY-MM).
      const mesKey = `${envio.fechaImpresion.getFullYear()}-${String(envio.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;
      if (!porMesMap.has(mesKey)) porMesMap.set(mesKey, grupoVacio());
      const grpMes = porMesMap.get(mesKey)!;
      grpMes.total++;
      if (aplicaAlUniverso) {
        grpMes.universo++;
        if (clasificacion === "PRIMERA_VISITA_EXITOSA") grpMes.primeraVisita++;
        else if (clasificacion === "VISITAS_FORZADAS") grpMes.visitasForzadas++;
        else if (clasificacion === "DEVUELTO_AL_REMITENTE") grpMes.devoluciones++;
      }
    }

    // Helper para calcular porcentajes de un grupo.
    const calcularPorcentajes = (grupo: GrupoEfectividad) => ({
      total: grupo.total,
      universo: grupo.universo,
      porcentajePrimeraVisita: grupo.universo > 0 ? Math.round((grupo.primeraVisita / grupo.universo) * 100) : 0,
      porcentajeVisitasForzadas: grupo.universo > 0 ? Math.round((grupo.visitasForzadas / grupo.universo) * 100) : 0,
      porcentajeDevoluciones: grupo.universo > 0 ? Math.round((grupo.devoluciones / grupo.universo) * 100) : 0,
    });

    const porCourier = Array.from(porCourierMap.values())
      .map(({ courierId, nombre, grupo }) => ({
        courierId,
        nombre,
        ...calcularPorcentajes(grupo),
      }))
      .sort((a, b) => b.universo - a.universo);

    const porProvincia = Array.from(porProvinciaMap.entries())
      .map(([provincia, grupo]) => ({
        provincia,
        ...calcularPorcentajes(grupo),
      }))
      .sort((a, b) => b.universo - a.universo)
      .slice(0, 10);

    const porMes = Array.from(porMesMap.entries())
      .map(([mes, grupo]) => ({
        mes,
        ...calcularPorcentajes(grupo),
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    // ============================================================
    // 4. Top motivos de falla (decision 2.2.C.5 + 2.2.C.6 top 5).
    // Incluye motivos de VISITA_FALLIDA, INCIDENCIA y DEVUELTO_AL_REMITENTE.
    // ============================================================
    const motivosFreq = new Map<string, number>();
    for (const envio of envios) {
      const motivo = obtenerMotivoUltimaFalla(envio.eventos);
      if (motivo) {
        motivosFreq.set(motivo, (motivosFreq.get(motivo) || 0) + 1);
      }
    }
    const totalConFalla = Array.from(motivosFreq.values()).reduce((a, b) => a + b, 0);
    const topMotivosFalla = Array.from(motivosFreq.entries())
      .map(([motivo, cantidad]) => ({
        motivo,
        cantidad,
        porcentaje: totalConFalla > 0 ? Math.round((cantidad / totalConFalla) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    // ============================================================
    // 5. Calidad de datos.
    // ============================================================
    const enviosSinEventos = envios.filter(e => e.eventos.length === 0).length;

    return NextResponse.json({
      resumen: {
        totalEnvios: resumen.totalEnvios,
        totalEntregados: resumen.totalEntregados,
        totalDevueltos: resumen.totalDevueltos,
        totalUniverso: resumen.totalUniverso,
        porcentajePrimeraVisita: resumen.porcentajePrimeraVisita,
        porcentajeVisitasForzadas: resumen.porcentajeVisitasForzadas,
        porcentajeDevoluciones: resumen.porcentajeDevoluciones,
      },
      funnel,
      porCourier,
      porProvincia,
      porMes,
      topMotivosFalla,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        cantidadEnviosSinEventos: enviosSinEventos,
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en efectividad-primera-visita:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Efectividad de Primera Visita" },
      { status: 500 }
    );
  }
}
