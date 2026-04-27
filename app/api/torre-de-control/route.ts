import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresaId");
    
    // Filtro base: Si es administrador ve todo, si no, ve su empresa.
    let whereClause: any = {};
    if (empresaId && empresaId !== "TODAS") {
      whereClause.empresaId = parseInt(empresaId);
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