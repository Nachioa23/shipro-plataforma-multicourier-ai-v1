// ============================================================================
// TORRE DE CONTROL — METRICA 1.1 "Resolver Nomenclador"
// ============================================================================
//
// Documento maestro: docs/TORRE-DE-CONTROL.md (DEUDA 39, diseño 2026-06-04).
//
// Que mide:
//   - Cantidad y porcentaje de estados crudos de couriers sin mapear a un
//     Estado Shipro canonico en la tabla Nomenclador.
//   - Frecuencia ponderada: cuanto pesan los estados no mapeados en eventos
//     reales (joineando con EventoTracking.estadoCrudoOriginal).
//   - Top N estados sin mapear ordenados por frecuencia.
//   - Desglose por courier.
//
// Auth:
//   - Solo Shipro (admin_shipro y operador_shipro). Validado via resolverContext
//     + check modoDios.
//   - Los clientes NO acceden a la Torre de Control. Para ellos existe el
//     Panel de Control con su propia capa de metricas restringidas.
//
// Notas tecnicas:
//   - El campo EventoTracking.estadoCrudoOriginal fue agregado el 2026-06-04
//     (migration 20260603210521_metrica_resolver_nomenclador_evento_crudo_original).
//     Eventos previos a esa fecha tienen el campo NULL. La metrica ponderada
//     refleja esto explicitamente en la response (ver campo eventosConDato).
//   - Sin scope por empresa: el nomenclador es global a la plataforma Shipro.
//     Todos los roles Shipro ven exactamente el mismo dato.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

// Ventana temporal por defecto para frecuencia ponderada (en dias).
const VENTANA_DIAS_DEFAULT = 30;

// Top N de estados sin mapear que devuelve el endpoint.
const TOP_N_DEFAULT = 20;

export async function GET(request: Request) {
  try {
    // Auth: solo roles Shipro (cualquiera de los dos).
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.modoDios) {
      return NextResponse.json(
        { error: "No autorizado. Torre de Control es exclusiva de Shipro." },
        { status: 403 }
      );
    }

    // Parametros opcionales del query string.
    const url = new URL(request.url);
    const ventanaDias = parseInt(url.searchParams.get("ventanaDias") || "") || VENTANA_DIAS_DEFAULT;
    const topN = parseInt(url.searchParams.get("topN") || "") || TOP_N_DEFAULT;

    const desde = new Date();
    desde.setDate(desde.getDate() - ventanaDias);

    // ========================================================================
    // QUERY 1 — Catalogo completo: todos los Nomenclador y cuales sin mapear.
    // ========================================================================
    const todosNomencladores = await prisma.nomenclador.findMany({
      include: { courier: { select: { id: true, nombre: true } } },
    });

    const totalEstadosCrudos = todosNomencladores.length;
    const estadosNoMapeados = todosNomencladores.filter(n => !n.estadoShipro || n.estadoShipro === "");
    const cantidadNoMapeados = estadosNoMapeados.length;
    const porcentajeCoberturaSimple = totalEstadosCrudos === 0
      ? 100
      : ((totalEstadosCrudos - cantidadNoMapeados) / totalEstadosCrudos) * 100;

    // ========================================================================
    // QUERY 2 — Frecuencia ponderada: eventos en ventana cruzados con
    // estados no mapeados.
    //
    // Solo cuenta eventos con estadoCrudoOriginal poblado (post-2026-06-04).
    // ========================================================================
    const eventosEnVentana = await prisma.eventoTracking.findMany({
      where: {
        fecha: { gte: desde },
        estadoCrudoOriginal: { not: null },
      },
      select: {
        estadoCrudoOriginal: true,
        envio: { select: { courierId: true } },
      },
    });

    const totalEventos = eventosEnVentana.length;

    // Set de claves (courierId|estadoCrudo) que NO estan mapeadas, para lookup O(1).
    const setNoMapeados = new Set(
      estadosNoMapeados.map(n => `${n.courierId}|${n.estadoCrudo}`)
    );

    // Contar eventos cuyo (courierId, estadoCrudoOriginal) coincide con un no mapeado.
    let eventosSinMapeo = 0;
    const frecuenciaPorClave = new Map<string, number>();
    for (const ev of eventosEnVentana) {
      if (!ev.estadoCrudoOriginal) continue;
      const clave = `${ev.envio.courierId}|${ev.estadoCrudoOriginal}`;
      if (setNoMapeados.has(clave)) {
        eventosSinMapeo++;
        frecuenciaPorClave.set(clave, (frecuenciaPorClave.get(clave) || 0) + 1);
      }
    }

    const porcentajeCoberturaPonderada = totalEventos === 0
      ? null  // explicitamente null cuando no hay base estadistica
      : ((totalEventos - eventosSinMapeo) / totalEventos) * 100;

    // ========================================================================
    // QUERY 3 — Top N estados sin mapear ordenados por frecuencia descendente.
    // ========================================================================
    const topEstadosSinMapear = estadosNoMapeados
      .map(n => {
        const clave = `${n.courierId}|${n.estadoCrudo}`;
        return {
          courierId: n.courierId,
          courierNombre: n.courier.nombre,
          estadoCrudo: n.estadoCrudo,
          frecuenciaEnVentana: frecuenciaPorClave.get(clave) || 0,
        };
      })
      .sort((a, b) => b.frecuenciaEnVentana - a.frecuenciaEnVentana)
      .slice(0, topN);

    // ========================================================================
    // QUERY 4 — Desglose por courier (cantidad de no mapeados por courier).
    // ========================================================================
    const desglosePorCourier = new Map<number, {
      courierId: number;
      courierNombre: string;
      totalEstadosCrudos: number;
      estadosNoMapeados: number;
      porcentajeCobertura: number;
    }>();

    for (const n of todosNomencladores) {
      const existente = desglosePorCourier.get(n.courierId);
      if (existente) {
        existente.totalEstadosCrudos++;
        if (!n.estadoShipro || n.estadoShipro === "") existente.estadosNoMapeados++;
      } else {
        desglosePorCourier.set(n.courierId, {
          courierId: n.courierId,
          courierNombre: n.courier.nombre,
          totalEstadosCrudos: 1,
          estadosNoMapeados: !n.estadoShipro || n.estadoShipro === "" ? 1 : 0,
          porcentajeCobertura: 0, // se calcula al final
        });
      }
    }

    const desgloseArray = Array.from(desglosePorCourier.values()).map(d => ({
      ...d,
      porcentajeCobertura: ((d.totalEstadosCrudos - d.estadosNoMapeados) / d.totalEstadosCrudos) * 100,
    }));

    // ========================================================================
    // RESPONSE
    // ========================================================================
    return NextResponse.json({
      // Cobertura agregada
      porcentajeCoberturaSimple,
      porcentajeCoberturaPonderada,

      // Snapshot del catalogo (sin ventana temporal)
      totalEstadosCrudos,
      cantidadNoMapeados,

      // Frecuencia ponderada (con ventana temporal)
      ventanaDias,
      totalEventos,
      eventosSinMapeo,
      eventosConDato: totalEventos > 0,  // false si no hay eventos con estadoCrudoOriginal poblado

      // Detalle
      topEstadosSinMapear,
      desglosePorCourier: desgloseArray,
    });
  } catch (error) {
    console.error("[torre-de-control/resolver-nomenclador] error:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Resolver Nomenclador" },
      { status: 500 }
    );
  }
}
