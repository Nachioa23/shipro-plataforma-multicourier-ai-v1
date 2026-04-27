import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    // 1. Definimos la ventana de tiempo (90 días)
    const hace90Dias = new Date();
    hace90Dias.setDate(hace90Dias.getDate() - 90);

    // 2. Buscamos todos los envíos entregados que tengan ambas fechas grabadas
    const enviosParaCalculo = await prisma.envio.findMany({
      where: {
        estadoActual: "ENTREGADO",
        fechaColecta: { not: null, gte: hace90Dias },
        fechaEntrega: { not: null },
      },
      select: {
        courierId: true,
        fechaColecta: true,
        fechaEntrega: true,
        destino: {
          select: { provincia: true }
        }
      }
    });

    if (enviosParaCalculo.length === 0) {
      return NextResponse.json({ mensaje: "Sin datos suficientes para procesar métricas." });
    }

    // 3. Agrupamos los datos en memoria para calcular promedios
    // Estructura: { "idCourier-Provincia": { totalHoras: X, cantidad: Y } }
    const mapaMetricas: Record<string, { totalHoras: number, cantidad: number, courierId: number, provincia: string }> = {};

    enviosParaCalculo.forEach(envio => {
      if (!envio.destino?.provincia || !envio.fechaColecta || !envio.fechaEntrega) return;
      
      const clave = `${envio.courierId}-${envio.destino.provincia}`;
      const difHoras = (envio.fechaEntrega.getTime() - envio.fechaColecta.getTime()) / (1000 * 60 * 60);

      if (!mapaMetricas[clave]) {
        mapaMetricas[clave] = { 
          totalHoras: 0, 
          cantidad: 0, 
          courierId: envio.courierId, 
          provincia: envio.destino.provincia 
        };
      }

      mapaMetricas[clave].totalHoras += difHoras;
      mapaMetricas[clave].cantidad += 1;
    });

    // 4. Guardamos o actualizamos los resultados en la tabla MetricaSLA
    let procesados = 0;
    for (const clave in mapaMetricas) {
      const item = mapaMetricas[clave];
      const promedio = Math.round(item.totalHoras / item.cantidad);

      await prisma.metricaSLA.upsert({
        where: {
          courierId_provinciaDestino: {
            courierId: item.courierId,
            provinciaDestino: item.provincia
          }
        },
        update: {
          slaPromedioHs: promedio,
          muestraEnvios: item.cantidad,
          fechaActualizacion: new Date()
        },
        create: {
          courierId: item.courierId,
          provinciaDestino: item.provincia,
          slaPromedioHs: promedio,
          muestraEnvios: item.cantidad
        }
      });
      procesados++;
    }

    return NextResponse.json({ 
      mensaje: "Métricas SLA actualizadas exitosamente", 
      rutasProcesadas: procesados,
      totalEnviosAnalizados: enviosParaCalculo.length 
    });

  } catch (error) {
    console.error("Error en el Motor Nocturno de SLA:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}