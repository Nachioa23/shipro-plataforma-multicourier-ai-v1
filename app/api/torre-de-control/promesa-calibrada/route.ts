// ============================================================================
// TORRE DE CONTROL — METRICA 2.3 "Promesa de Entrega Calibrada"
// ============================================================================
//
// Documento maestro: docs/TORRE-DE-CONTROL.md (DEUDA 39, diseño 2026-06-04).
//
// Que mide:
//   Tiempo total real desde la creacion de la etiqueta (fechaImpresion)
//   hasta la entrega al comprador (fechaEntrega), en dias habiles
//   (descontando fines de semana + feriados de BD).
//
//   Calcula P50, P75 y P90 por combinacion (deposito x courier x provincia).
//   El P75 es la "promesa calibrada": si prometemos ese plazo al comprador,
//   75% de los envios cumplen.
//
// Granularidad de v1 (3 dimensiones):
//   - depositoOrigen
//   - courier
//   - provinciaDestino
//
//   La dimension "modalidad" esta omitida en v1 porque Envio.modalidad
//   no se persiste correctamente hoy (siempre queda con default "Estandar").
//   Esta deuda esta registrada como DEUDA E (fix de persistencia de modalidad).
//   Cuando se resuelva, agregamos la 4ta dimension a esta metrica.
//
// Auth:
//   - Solo Shipro (admin_shipro y operador_shipro). Mismo patron que 1.1 y 2.1.
//
// Notas tecnicas:
//   - Calculo on-the-fly (mismo patron que 2.1). No usa MetricaSLA ni
//     cron metricas-sla. Esa infraestructura sigue intacta para el promedio
//     historico tradicional.
//   - Solo considera envios ENTREGADO. Necesitamos ambas fechas
//     (fechaImpresion y fechaEntrega) para calcular el delta real.
//   - Convierte horas a dias habiles via lib/cotizador agregarDiasHabiles
//     para coherencia con como se le presenta al comprador.
//   - Umbral minimo 10 envios por combinacion para considerar la calibracion
//     confiable (mismo umbral que el cotizador actual usa para decidir si
//     consultar MetricaSLA o caer al fallback hardcoded).
//   - Provincia normalizada (lowercase + trim) para evitar duplicados.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import { calcularEstadisticos } from "@/lib/utils/percentiles";
import {
  VENTANA_DIAS_DEFAULT,
  UMBRAL_MUESTRA_MINIMA,
  normalizarProvincia,
} from "@/lib/utils/promesa-calibrada";

// Helper: dado un delta en horas, redondear hacia arriba a dias corridos.
// Tema 2 Opcion α: el dashboard muestra ambos (horas para granularidad,
// dias para legibilidad rapida).
// Nota: estos son dias corridos (NO habiles). La conversion a dias habiles
// con feriados la hace el cotizador con calcularFechaEstimada() para
// presentar fecha de llegada al comprador.
function horasADiasCorridos(horas: number): number {
  return Math.ceil(horas / 24);
}

export async function GET(request: Request) {
  try {
    // Auth: solo roles Shipro.
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.modoDios) {
      return NextResponse.json(
        { error: "No autorizado. Torre de Control es exclusiva de Shipro." },
        { status: 403 }
      );
    }

    // Parametros opcionales.
    const url = new URL(request.url);
    const ventanaDias = parseInt(url.searchParams.get("ventanaDias") || "") || VENTANA_DIAS_DEFAULT;

    const desde = new Date();
    desde.setDate(desde.getDate() - ventanaDias);

    // ========================================================================
    // QUERY — Fetch envios ENTREGADO con todas las fechas necesarias.
    // ========================================================================
    const envios = await prisma.envio.findMany({
      where: {
        fechaImpresion: { gte: desde },
        fechaEntrega: { not: null },
        destinoId: { not: null },
      },
      select: {
        id: true,
        fechaImpresion: true,
        fechaEntrega: true,
        diasPrometidosCheckout: true,
        depositoId: true,
        courierId: true,
        deposito: { select: { id: true, nombre: true } },
        courier: { select: { id: true, nombre: true } },
        destino: { select: { provincia: true } },
      },
    });

    // Filtrar envios validos (con todos los datos minimos).
    const enviosValidos = envios.filter(e =>
      e.fechaEntrega !== null &&
      e.fechaImpresion !== null &&
      e.depositoId !== null &&
      e.courierId !== null &&
      e.destino !== null &&
      e.destino.provincia !== null &&
      e.deposito !== null &&
      e.courier !== null
    );

    const cantidadEnviosTotal = envios.length;
    const cantidadEnviosValidos = enviosValidos.length;

    // ========================================================================
    // CALCULOS — Delta en horas para cada envio + agrupacion por combinacion.
    // ========================================================================
    interface DatosCombinacion {
      depositoId: number;
      depositoNombre: string;
      courierId: number;
      courierNombre: string;
      provinciaDestino: string;
      horas: number[];
      cumplimientosPromesa: { real: number; prometida: number }[];
    }

    const combinacionesMap = new Map<string, DatosCombinacion>();

    for (const e of enviosValidos) {
      const provNorm = normalizarProvincia(e.destino!.provincia);
      if (!provNorm) continue;

      const claveCombinacion = `${e.depositoId}|${e.courierId}|${provNorm}`;
      const horasDelta = (e.fechaEntrega!.getTime() - e.fechaImpresion!.getTime()) / 3600000;

      let datos = combinacionesMap.get(claveCombinacion);
      if (!datos) {
        datos = {
          depositoId: e.depositoId!,
          depositoNombre: e.deposito!.nombre,
          courierId: e.courierId!,
          courierNombre: e.courier!.nombre,
          provinciaDestino: provNorm,
          horas: [],
          cumplimientosPromesa: [],
        };
        combinacionesMap.set(claveCombinacion, datos);
      }
      datos.horas.push(horasDelta);

      // Si el envio tenia promesa registrada, capturamos cumplimiento.
      if (e.diasPrometidosCheckout !== null && e.diasPrometidosCheckout !== undefined) {
        const diasReales = horasADiasCorridos(horasDelta);
        datos.cumplimientosPromesa.push({
          real: diasReales,
          prometida: e.diasPrometidosCheckout,
        });
      }
    }

    // ========================================================================
    // OUTPUT — Para cada combinacion, calcular percentiles y cumplimiento.
    // ========================================================================
    const combinaciones = Array.from(combinacionesMap.values())
      .map(c => {
        const stats = calcularEstadisticos(c.horas, 1);
        if (!stats) return null;

        // Calculamos P90 manualmente (calcularEstadisticos solo da P50 y P95).
        const ordenados = [...c.horas].sort((a, b) => a - b);
        const indiceP75 = Math.floor(ordenados.length * 0.75);
        const indiceP90 = Math.floor(ordenados.length * 0.90);
        const p75Horas = ordenados[Math.min(indiceP75, ordenados.length - 1)];
        const p90Horas = ordenados[Math.min(indiceP90, ordenados.length - 1)];

        // Tema 2 Opcion α: dashboard quiere ambos. Horas para granularidad de
        // performance, dias para legibilidad. El consumidor decide cual mostrar.
        const p50Dias = horasADiasCorridos(stats.p50);
        const p75Dias = horasADiasCorridos(p75Horas);
        const p90Dias = horasADiasCorridos(p90Horas);
        const promedioDias = horasADiasCorridos(stats.promedio);

        // Cumplimiento historico: envios donde real <= prometida.
        let tasaCumplimiento: number | null = null;
        if (c.cumplimientosPromesa.length > 0) {
          const cumplidos = c.cumplimientosPromesa.filter(p => p.real <= p.prometida).length;
          tasaCumplimiento = cumplidos / c.cumplimientosPromesa.length;
        }

        // Confianza: muestra >= umbral implica calibracion utilizable.
        const muestraConfiable = stats.cantidad >= UMBRAL_MUESTRA_MINIMA;

        return {
          depositoId: c.depositoId,
          depositoNombre: c.depositoNombre,
          courierId: c.courierId,
          courierNombre: c.courierNombre,
          provinciaDestino: c.provinciaDestino,
          // Tema 2 Opcion α: horas para granularidad analitica.
          p50Horas: Math.round(stats.p50),
          p75Horas: Math.round(p75Horas),
          p90Horas: Math.round(p90Horas),
          promedioHoras: Math.round(stats.promedio),
          // Dias corridos para presentacion en tabla.
          p50Dias,
          p75Dias,
          p90Dias,
          promedioDias,
          cantidad: stats.cantidad,
          muestraConfiable,
          // Promesa calibrada recomendada = P75 (Decision 3: hardcoded en v1).
          promesaCalibradaDias: p75Dias,
          promesaCalibradaHoras: Math.round(p75Horas),
          // Cumplimiento historico (null si no hay envios con promesa registrada).
          tasaCumplimiento,
          cantidadConPromesa: c.cumplimientosPromesa.length,
        };
      })
      .filter(c => c !== null)
      .sort((a, b) => b!.cantidad - a!.cantidad);

    // ========================================================================
    // ESTADISTICOS GLOBALES — Resumen across all combinations.
    // ========================================================================
    const todasLasHoras = enviosValidos
      .map(e => (e.fechaEntrega!.getTime() - e.fechaImpresion!.getTime()) / 3600000)
      .filter(h => h > 0);

    const estadisticosGlobales = calcularEstadisticos(todasLasHoras, 1);

    // Calcular P75 global (no incluido en calcularEstadisticos que solo
    // devuelve P50/P95). Es el valor central de la metrica 2.3 (promesa
    // calibrada estandar segun Decision 3 γ).
    const todasLasHorasOrdenadas = [...todasLasHoras].sort((a, b) => a - b);
    const p75GlobalIndice = Math.floor(todasLasHorasOrdenadas.length * 0.75);
    const p75GlobalHoras = todasLasHorasOrdenadas.length > 0
      ? todasLasHorasOrdenadas[Math.min(p75GlobalIndice, todasLasHorasOrdenadas.length - 1)]
      : null;

    // Cumplimiento global (envios con promesa registrada).
    const enviosConPromesa = enviosValidos.filter(
      e => e.diasPrometidosCheckout !== null && e.diasPrometidosCheckout !== undefined
    );
    let tasaCumplimientoGlobal: number | null = null;
    if (enviosConPromesa.length > 0) {
      const cumplidos = enviosConPromesa.filter(e => {
        const horasDelta = (e.fechaEntrega!.getTime() - e.fechaImpresion!.getTime()) / 3600000;
        const diasReales = horasADiasCorridos(horasDelta);
        return diasReales <= e.diasPrometidosCheckout!;
      }).length;
      tasaCumplimientoGlobal = cumplidos / enviosConPromesa.length;
    }

    // ========================================================================
    // RESPONSE
    // ========================================================================
    return NextResponse.json({
      ventanaDias,

      estadisticosGlobales: estadisticosGlobales
        ? {
            // Tema 2 Opcion α: tambien aqui exponemos horas Y dias.
            p50Horas: Math.round(estadisticosGlobales.p50),
            p75Horas: p75GlobalHoras !== null ? Math.round(p75GlobalHoras) : null,
            p95Horas: Math.round(estadisticosGlobales.p95),
            promedioHoras: Math.round(estadisticosGlobales.promedio),
            p50Dias: horasADiasCorridos(estadisticosGlobales.p50),
            p75Dias: p75GlobalHoras !== null ? horasADiasCorridos(p75GlobalHoras) : null,
            p95Dias: horasADiasCorridos(estadisticosGlobales.p95),
            promedioDias: horasADiasCorridos(estadisticosGlobales.promedio),
            cantidad: estadisticosGlobales.cantidad,
          }
        : null,

      // Cumplimiento global de la promesa que se le hizo al comprador.
      tasaCumplimientoGlobal,
      cantidadEnviosConPromesa: enviosConPromesa.length,

      // Calidad de datos.
      cantidadEnviosTotal,
      cantidadEnviosValidos,
      cantidadEnviosSinDatos: cantidadEnviosTotal - cantidadEnviosValidos,

      // Umbral usado.
      umbralMuestraMinima: UMBRAL_MUESTRA_MINIMA,

      // Tabla principal de combinaciones.
      combinaciones,
    });
  } catch (error) {
    console.error("[torre-de-control/promesa-calibrada] error:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Promesa Calibrada" },
      { status: 500 }
    );
  }
}
