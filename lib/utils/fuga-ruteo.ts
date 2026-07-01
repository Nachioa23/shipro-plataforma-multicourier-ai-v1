// ============================================================================
// HELPER — Fuga por Ruteo Ineficiente
//
// Mide la fuga financiera por elegir un courier mas caro que el sugerido.
// Helper extraido del endpoint Torre /api/torre-de-control/fuga-ruteo
// en migracion Panel cliente (2026-06-13).
//
// SCOPE-AWARE: el helper recibe el AuthContext del request y adapta su
// comportamiento automaticamente:
//
// - Cliente (modoDios=false): filtra por ctx.empresaId, omite cortes
//   por empresa (redundantes para el cliente), retorna shape Panel.
//
// - Shipro (modoDios=true) sin filtroEmpresa: scope global, retorna
//   shape Torre completo con todos los cortes.
//
// - Shipro (modoDios=true) con filtroEmpresa: scope empresa especifica,
//   retorna shape Torre completo (vista de inspeccion).
//
// Decisiones de producto (director 2026-06-13):
// - Cliente Panel: topDesvios agrupados por zona/provincia (vista
//   geografica accionable). NO incluye porEmpresa/porMes/topEnvios.
// - Shipro Torre: topDesvios agrupados por courier+servicio (vista de
//   optimizacion). INCLUYE porEmpresa/porMes/topEnvios.
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT = 90;

export interface ResumenFugaRuteo {
  totalEnviosEvaluados: number;
  enviosConFuga: number;
  enviosOptimizados: number;
  tasaIneficiencia: number;
  tasaOptimizacion: number;
  fugaTotal: number;
  fugaPromedio: number;
  fugaMax: number;
  ahorroProyectadoAnual: number;
}

export interface DesvioPorZona {
  destino: string;
  totalPerdido: number;
  enviosAfectados: number;
  costoPromedioExtra: number;
  courierMasElegido: string;
  courierMasSugerido: string;
}

export interface DesvioPorCombo {
  courierElegido: string;
  courierSugerido: string;
  servicioSugerido: string;
  cantidad: number;
  fugaTotal: number;
  fugaPromedio: number;
}

export interface PorEmpresa {
  empresaId: number;
  empresaNombre: string;
  enviosConFuga: number;
  fugaTotal: number;
  fugaPromedio: number;
}

export interface PorMes {
  mes: string;
  enviosConFuga: number;
  fugaTotal: number;
}

export interface EnvioFuga {
  envioId: number;
  trackingNumber: string;
  empresaNombre: string;
  destinoProvincia: string;
  courierElegido: string;
  courierSugerido: string;
  servicioSugerido: string;
  fugaFinanciera: number;
  fechaImpresion: Date;
}

export interface CalidadDatosFuga {
  ventanaDias: number;
  totalEnviosVentana: number;
  totalEnviosConFinanzas: number;
  fuente: string;
}

export interface ResultadoFugaRuteoCliente {
  resumen: ResumenFugaRuteo;
  topDesviosPorZona: DesvioPorZona[];
  calidadDatos: CalidadDatosFuga;
  scope: "cliente";
}

export interface ResultadoFugaRuteoShipro {
  resumen: ResumenFugaRuteo;
  topDesviosPorZona: DesvioPorZona[];
  topDesviosPorCombo: DesvioPorCombo[];
  porEmpresa: PorEmpresa[];
  porMes: PorMes[];
  topEnvios: EnvioFuga[];
  calidadDatos: CalidadDatosFuga;
  scope: "shipro";
}

export type ResultadoFugaRuteo = ResultadoFugaRuteoCliente | ResultadoFugaRuteoShipro;

export async function calcularFugaRuteo(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<ResultadoFugaRuteo> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause con scope automatico.
  const whereClause: any = {
    fechaImpresion: { gte: ventanaInicio },
  };

  // Si NO es modoDios, forzar filtro por empresaId del cliente.
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    // modoDios + filtroEmpresa explicito.
    whereClause.empresaId = ctx.empresaId;
  }

  const envios = await prisma.envio.findMany({
    where: whereClause,
    include: {
      finanzas: true,
      courier: { select: { nombre: true } },
      destino: { select: { provincia: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  // Acumuladores.
  let fugaTotal: Prisma.Decimal = new Prisma.Decimal(0);
  let fugaMax: Prisma.Decimal = new Prisma.Decimal(0);
  let enviosConFuga = 0;
  let enviosOptimizados = 0;
  const enviosConFinanzas = envios.filter(e => e.finanzas !== null).length;

  const desviosPorZona: Record<string, {
    totalPerdido: Prisma.Decimal;
    enviosAfectados: number;
    elegidosMap: Record<string, number>;
    sugeridosMap: Record<string, number>;
  }> = {};

  const desviosPorCombo: Record<string, {
    courierElegido: string;
    courierSugerido: string;
    servicioSugerido: string;
    cantidad: number;
    fugaTotal: Prisma.Decimal;
  }> = {};

  const porEmpresaMap: Record<number, {
    empresaNombre: string;
    enviosConFuga: number;
    fugaTotal: Prisma.Decimal;
  }> = {};

  const porMesMap: Record<string, { enviosConFuga: number; fugaTotal: Prisma.Decimal }> = {};

  const topEnvios: EnvioFuga[] = [];

  for (const envio of envios) {
    const fuga: Prisma.Decimal = envio.finanzas?.fugaFinanciera ?? new Prisma.Decimal(0);

    if (fuga.gt(0)) {
      enviosConFuga++;
      fugaTotal = fugaTotal.add(fuga);
      if (fuga.gt(fugaMax)) fugaMax = fuga;

      const zona = envio.destino?.provincia || "Desconocida";
      const elegido = `${envio.courier?.nombre || 'Courier'}`.trim();
      const sugerido = `${envio.finanzas?.courierSugerido || 'Otro'}`.trim();
      const servicioSugerido = `${envio.finanzas?.servicioSugerido || ''}`.trim();

      // Por zona.
      if (!desviosPorZona[zona]) {
        desviosPorZona[zona] = {
          totalPerdido: new Prisma.Decimal(0),
          enviosAfectados: 0,
          elegidosMap: {},
          sugeridosMap: {},
        };
      }
      desviosPorZona[zona].totalPerdido = desviosPorZona[zona].totalPerdido.add(fuga);
      desviosPorZona[zona].enviosAfectados += 1;
      desviosPorZona[zona].elegidosMap[elegido] = (desviosPorZona[zona].elegidosMap[elegido] || 0) + 1;
      desviosPorZona[zona].sugeridosMap[sugerido] = (desviosPorZona[zona].sugeridosMap[sugerido] || 0) + 1;

      // Por combo (solo modoDios).
      if (ctx.modoDios) {
        const claveCombo = `${elegido}|${sugerido}|${servicioSugerido}`;
        if (!desviosPorCombo[claveCombo]) {
          desviosPorCombo[claveCombo] = {
            courierElegido: elegido,
            courierSugerido: sugerido,
            servicioSugerido,
            cantidad: 0,
            fugaTotal: new Prisma.Decimal(0),
          };
        }
        desviosPorCombo[claveCombo].cantidad++;
        desviosPorCombo[claveCombo].fugaTotal = desviosPorCombo[claveCombo].fugaTotal.add(fuga);

        // Por empresa (solo modoDios sin filtro).
        if (ctx.empresaId === null && envio.empresa) {
          if (!porEmpresaMap[envio.empresa.id]) {
            porEmpresaMap[envio.empresa.id] = {
              empresaNombre: envio.empresa.nombre,
              enviosConFuga: 0,
              fugaTotal: new Prisma.Decimal(0),
            };
          }
          porEmpresaMap[envio.empresa.id].enviosConFuga++;
          porEmpresaMap[envio.empresa.id].fugaTotal = porEmpresaMap[envio.empresa.id].fugaTotal.add(fuga);
        }

        // Por mes (solo modoDios).
        if (envio.fechaImpresion) {
          const mes = envio.fechaImpresion.toISOString().substring(0, 7);
          if (!porMesMap[mes]) {
            porMesMap[mes] = { enviosConFuga: 0, fugaTotal: new Prisma.Decimal(0) };
          }
          porMesMap[mes].enviosConFuga++;
          porMesMap[mes].fugaTotal = porMesMap[mes].fugaTotal.add(fuga);
        }

        // Top envios individuales (solo modoDios).
        if (envio.fechaImpresion) {
          topEnvios.push({
            envioId: envio.id,
            trackingNumber: envio.trackingNumber,
            empresaNombre: envio.empresa?.nombre || "Desconocida",
            destinoProvincia: zona,
            courierElegido: elegido,
            courierSugerido: sugerido,
            servicioSugerido,
            fugaFinanciera: fuga.toNumber(),
            fechaImpresion: envio.fechaImpresion,
          });
        }
      }
    } else if (envio.finanzas !== null) {
      enviosOptimizados++;
    }
  }

  const totalEvaluados = enviosConFuga + enviosOptimizados;
  const fugaTotalNum = fugaTotal.toNumber();
  const fugaMaxNum = fugaMax.toNumber();

  // Build resumen comun.
  const resumen: ResumenFugaRuteo = {
    totalEnviosEvaluados: totalEvaluados,
    enviosConFuga,
    enviosOptimizados,
    tasaIneficiencia: totalEvaluados > 0 ? Math.round((enviosConFuga / totalEvaluados) * 1000) / 10 : 0,
    tasaOptimizacion: totalEvaluados > 0 ? Math.round((enviosOptimizados / totalEvaluados) * 1000) / 10 : 100,
    fugaTotal: Math.round(fugaTotalNum),
    fugaPromedio: enviosConFuga > 0 ? Math.round(fugaTotalNum / enviosConFuga) : 0,
    fugaMax: Math.round(fugaMaxNum),
    ahorroProyectadoAnual: ventanaDias > 0 ? Math.round((fugaTotalNum / ventanaDias) * 365) : 0,
  };

  // Build topDesviosPorZona (comun a ambos scopes).
  const topDesviosPorZona: DesvioPorZona[] = Object.entries(desviosPorZona)
    .map(([destino, z]) => {
      const elegidos = Object.entries(z.elegidosMap).sort((a, b) => b[1] - a[1]);
      const sugeridos = Object.entries(z.sugeridosMap).sort((a, b) => b[1] - a[1]);
      const totalPerdidoNum = z.totalPerdido.toNumber();
      return {
        destino,
        totalPerdido: Math.round(totalPerdidoNum),
        enviosAfectados: z.enviosAfectados,
        costoPromedioExtra: Math.round(totalPerdidoNum / z.enviosAfectados),
        courierMasElegido: elegidos[0]?.[0] || "Desconocido",
        courierMasSugerido: sugeridos[0]?.[0] || "Desconocido",
      };
    })
    .sort((a, b) => b.totalPerdido - a.totalPerdido)
    .slice(0, 10);

  const calidadDatos: CalidadDatosFuga = {
    ventanaDias,
    totalEnviosVentana: envios.length,
    totalEnviosConFinanzas: enviosConFinanzas,
    fuente: "Envio + FinanzasEnvio (fugaFinanciera pre-calculada por motor de cotizaciones)",
  };

  // Branch por scope.
  if (!ctx.modoDios) {
    return {
      resumen,
      topDesviosPorZona,
      calidadDatos,
      scope: "cliente",
    };
  }

  // modoDios: shape completo Shipro.
  const topDesviosPorCombo: DesvioPorCombo[] = Object.values(desviosPorCombo)
    .map(c => {
      const fugaTotalNum = c.fugaTotal.toNumber();
      return {
        courierElegido: c.courierElegido,
        courierSugerido: c.courierSugerido,
        servicioSugerido: c.servicioSugerido,
        cantidad: c.cantidad,
        fugaTotal: Math.round(fugaTotalNum),
        fugaPromedio: Math.round(fugaTotalNum / c.cantidad),
      };
    })
    .sort((a, b) => b.fugaTotal - a.fugaTotal)
    .slice(0, 10);

  const porEmpresa: PorEmpresa[] = Object.entries(porEmpresaMap)
    .map(([id, e]) => {
      const fugaTotalNum = e.fugaTotal.toNumber();
      return {
        empresaId: parseInt(id),
        empresaNombre: e.empresaNombre,
        enviosConFuga: e.enviosConFuga,
        fugaTotal: Math.round(fugaTotalNum),
        fugaPromedio: Math.round(fugaTotalNum / e.enviosConFuga),
      };
    })
    .sort((a, b) => b.fugaTotal - a.fugaTotal);

  const porMes: PorMes[] = Object.entries(porMesMap)
    .map(([mes, m]) => ({
      mes,
      enviosConFuga: m.enviosConFuga,
      fugaTotal: Math.round(m.fugaTotal.toNumber()),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const topEnviosOrdenado = topEnvios
    .sort((a, b) => b.fugaFinanciera - a.fugaFinanciera)
    .slice(0, 20);

  return {
    resumen,
    topDesviosPorZona,
    topDesviosPorCombo,
    porEmpresa,
    porMes,
    topEnvios: topEnviosOrdenado,
    calidadDatos,
    scope: "shipro",
  };
}
