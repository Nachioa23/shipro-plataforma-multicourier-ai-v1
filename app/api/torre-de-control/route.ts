// =============================================================================
// /api/torre-de-control — Endpoint analitico de Calidad Postal
// =============================================================================
// ESTADO: backend listo, vista UI pendiente (DEUDA 8 reformulada, 2026-06-02).
//
// IMPORTANTE: este endpoint computa SOLO la metrica de Calidad Postal
// (1 de las 11 metricas planeadas para Torre de Control). Ver DEUDA 39
// en DEUDAS.md para el sistema integral.
//
// Computa metricas estrategicas para decisiones de producto/operacion:
//   - Tasa de precision postal (% direcciones correctas por comprador)
//   - Tiempo promedio de resolucion de envios retenidos
//   - Atribucion de correcciones (comprador vs operador del cliente)
//   - Top 5 provincias con mas errores postales
//
// CONTEXTO ESTRATEGICO: Shipro es plataforma de datos. La generacion de
// informacion valiosa del cliente y la operacion logistica es parte del
// core del producto. Endpoints como este NO se borran aunque no tengan
// UI activa — son backend listo para vistas futuras de analitica.
//
// Decisiones del director (2026-06-02):
//   - El endpoint queda vivo.
//   - Construir vista UI cuando se priorice (DEUDA 8 reformulada).
//
// Consumidores: ningun fetch al endpoint hoy. La pagina dashboard
// /torre-de-control fetchea /api/envios + /api/metricas + /api/clientes,
// NO este endpoint. Cuando se construya la vista de Calidad Postal,
// fetchara este endpoint.
// =============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    let whereClause: any = {};
    if (ctx.empresaId !== null) {
      whereClause.empresaId = ctx.empresaId;
    }

    // Traemos los envíos con sus eventos y destinos para analizar
    const envios = await prisma.envio.findMany({
      where: whereClause,
      include: { 
        eventos: { orderBy: { fecha: 'asc' } },
        destino: true 
      }
    });

    let totalEnvios = envios.length;
    let retenidosTotal = 0;
    let corregidosTotal = 0;
    
    let tiempoResolucionMinutos = 0;
    let resueltosPorComprador = 0;
    let resueltosPorOperador = 0;

    let erroresPorProvincia: Record<string, number> = {};

    envios.forEach(envio => {
      // 1. Detectar si alguna vez estuvo retenido
      const eventoRetenido = envio.eventos.find(e => e.estado === "RETENIDO" || e.estado === "Retenido");
      
      if (eventoRetenido) {
        retenidosTotal++;

        // 2. Registrar la provincia problemática
        const prov = envio.destino?.provincia || "Desconocida";
        erroresPorProvincia[prov] = (erroresPorProvincia[prov] || 0) + 1;

        // 3. Detectar si fue corregido (pasó a Pendiente DESPUÉS de estar Retenido)
        const eventoCorregido = envio.eventos.find(e => 
          e.estado === "Pendiente" && e.fecha > eventoRetenido.fecha
        );

        if (eventoCorregido) {
          corregidosTotal++;

          // Calcular tiempo de resolución en minutos
          const diffMs = eventoCorregido.fecha.getTime() - eventoRetenido.fecha.getTime();
          tiempoResolucionMinutos += diffMs / (1000 * 60);

          // Atribución: ¿Quién lo corrigió? (Basado en la huella que dejamos)
          if (eventoCorregido.observacion?.includes("El comprador actualizó")) {
            resueltosPorComprador++;
          } else {
            resueltosPorOperador++;
          }
        }
      }
    });

    // Cálculos Finales
    const tasaPrecision = totalEnvios > 0 ? ((totalEnvios - retenidosTotal) / totalEnvios) * 100 : 100;
    const tiempoPromedioMinutos = corregidosTotal > 0 ? Math.round(tiempoResolucionMinutos / corregidosTotal) : 0;
    const porcentajeComprador = corregidosTotal > 0 ? Math.round((resueltosPorComprador / corregidosTotal) * 100) : 0;
    const porcentajeOperador = corregidosTotal > 0 ? Math.round((resueltosPorOperador / corregidosTotal) * 100) : 0;

    // Ordenar provincias con más errores
    const topProvincias = Object.entries(erroresPorProvincia)
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    return NextResponse.json({
      metricas: {
        totalEnvios,
        retenidosTotal,
        corregidosTotal,
        pendientesDeCorreccion: retenidosTotal - corregidosTotal,
        tasaPrecision: Math.round(tasaPrecision),
        tiempoPromedioMinutos,
        resueltosPorComprador,
        porcentajeComprador,
        resueltosPorOperador,
        porcentajeOperador
      },
      topProvincias
    });

  } catch (error) {
    console.error("Error en Torre de Control - Calidad Postal:", error);
    return NextResponse.json({ error: "Error al procesar métricas" }, { status: 500 });
  }
}