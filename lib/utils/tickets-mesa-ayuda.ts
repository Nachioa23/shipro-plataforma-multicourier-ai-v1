// ============================================================================
// HELPER — Tickets Mesa de Ayuda (Analitica)
//
// Phase 2.4.b (Panel cliente migration, 2026-06-15).
// Helper creado desde cero. Centraliza la logica analitica del endpoint
// /api/torre-de-control/tickets-mesa-ayuda (antes inline 239 lineas).
//
// SEMANTICA: orquestador scope-aware unico calcularTicketsMesaAyudaAnalitica.
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.ticketSoporte via envio.empresaId
//   (relation, no campo directo en TicketSoporte). Tambien filtra los
//   denominadores (prisma.envio.count + prisma.envio.groupBy) por empresaId
//   directo en Envio.
//   Retorna shape "cliente" sin porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): sin filtro
//   de empresa. Retorna shape "shipro" con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): filtra a esa
//   empresa. Retorna shape "shipro" sin porEmpresa.
//
// Decisiones de producto (director 2026-06-15):
// D1 - Nombre: calcularTicketsMesaAyudaAnalitica (sufijo Analitica consistente
//      con Phases 2.1-2.3).
// D2 - Filtrado scope-aware en 3 queries (tickets + envios global + envios
//      per courier). Inconsistencia entre las 3 daria tasaSoporte mal
//      calculada.
// D3 - porEmpresa solo en shape Shipro.
// D4 - Utilities esRadarShipro y calcularMediana se mantienen internas
//      (no exportar — DEUDA 53 contempla campo formal origen futuro).
// D5 - Discriminated union estricto: shape diferente por scope.
// D6 - Preservar shape exacto del endpoint actual (Torre consume any[]
//      asi que tsc no detecta renames — peligro de regresion silenciosa).
// D7 - porEmpresa shape analogo a porCourier: { empresaId, empresaNombre,
//      cantidad, enviosTotales, tasaSoporte }.
// D8 - topMotivos sin courierAsociado (la inferencia legacy era poco
//      precisa y porCourier ya da la info por courier).
//
// DEUDA 53 (registrada): la heuristica esRadarShipro basada en substrings
// del motivo es fragil. Requiere campo formal TicketSoporte.origen.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT = 90;

const SUBSTRINGS_RADAR_SHIPRO = [
  "demora sin actualizacion",
  "auto-creado",
  "sin movimiento",
];

function esRadarShipro(motivo: string): boolean {
  const m = motivo.toLowerCase();
  return SUBSTRINGS_RADAR_SHIPRO.some(s => m.includes(s));
}

function calcularMediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 0) {
    return Math.round(((ordenados[mid - 1] + ordenados[mid]) / 2) * 10) / 10;
  }
  return Math.round(ordenados[mid] * 10) / 10;
}

// Métrica 1.5 — en memoria sobre muestras chicas (mismo patrón que mediana).
function calcularPromedio(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const suma = valores.reduce((a, b) => a + b, 0);
  return Math.round((suma / valores.length) * 10) / 10;
}

function calcularPercentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return Math.round(ordenados[Math.max(0, idx)] * 10) / 10;
}

// Patrones de accion de AuditoriaSoporte que indican cierre del ticket.
const SUBSTRINGS_ACCION_CIERRE = ["cierre", "cerrad", "resolucion", "resolvi", "resuelt"];
function esAccionCierre(accion: string): boolean {
  const a = accion.toLowerCase();
  return SUBSTRINGS_ACCION_CIERRE.some(s => a.includes(s));
}

export interface ResumenTickets {
  totalTickets: number;
  totalActivos: number;
  totalCerrados: number;
  totalEnviosEnVentana: number;
  tasaSoporte: number;
  tiempoMedianoResolucion: number | null;
  // ============================================================================
  // Métrica 1.5 — Velocidad de Resolución (ADITIVO, 2026-10-13).
  // Campos agregados aquí para que la card 1.5 consuma el mismo payload que 1.4.
  // La card 1.4 ignora estos campos; backward-compatible.
  // ============================================================================
  tiempoPromedioResolucion: number | null;
  tiempoP95Resolucion: number | null;
  umbralSlaHoras: number;
  tasaEnSlaPct: number | null; // % tickets cerrados dentro del umbral SLA (24h default).
  muestraCerrados: number; // cantidad de tickets con fechaCierre en la ventana (muestra de 1.5).
}

export interface EstadoCount {
  cantidad: number;
  porcentaje: number;
}

export interface DistribucionEstadosTickets {
  abierto: EstadoCount;
  enProgreso: EstadoCount;
  cerrado: EstadoCount;
}

export interface OrigenTickets {
  radarShipro: EstadoCount;
  cliente: EstadoCount;
}

export interface MotivoTicket {
  motivo: string;
  cantidad: number;
  porcentaje: number;
}

export interface GrupoCourierTickets {
  courierId: number;
  nombre: string;
  cantidad: number;
  enviosTotales: number;
  tasaSoporte: number;
}

export interface MesTickets {
  mes: string;
  cantidad: number;
}

export interface GrupoEmpresaTickets {
  empresaId: number;
  empresaNombre: string;
  cantidad: number;
  enviosTotales: number;
  tasaSoporte: number;
}

export interface CalidadDatosTickets {
  ventanaDias: number;
}

// ============================================================================
// Métrica 1.5 — Velocidad Resolución Tickets (ADITIVO).
// Shape dedicado dentro de la respuesta común. 1.4 ignora el bloque.
// ============================================================================
export interface VelocidadPorMotivo {
  motivo: string;
  cantidad: number; // tickets cerrados en ese motivo
  duracionPromedioDias: number | null;
  duracionP95Dias: number | null;
}

export interface VelocidadPorUsuario {
  usuarioEmail: string;
  cantidad: number; // tickets cerrados por el usuario
  duracionPromedioDias: number | null;
}

export interface VelocidadPorHora {
  hora: number; // 0..23 (hora de apertura del ticket)
  cantidad: number;
  duracionPromedioDias: number | null;
}

export interface VelocidadPorDiaSemana {
  diaSemana: number; // 0=domingo, 6=sábado (hora local del servidor)
  cantidad: number;
  duracionPromedioDias: number | null;
}

export interface VelocidadResolucionTickets {
  umbralSlaHoras: number;
  muestra: number; // tickets cerrados con fechaCierre válido
  dentroSla: number;
  fueraSla: number;
  porMotivo: VelocidadPorMotivo[];
  porUsuarioCierre: VelocidadPorUsuario[];
  porHora: VelocidadPorHora[];
  porDiaSemana: VelocidadPorDiaSemana[];
}

export interface ResultadoTicketsBase {
  resumen: ResumenTickets;
  distribucionEstados: DistribucionEstadosTickets;
  origen: OrigenTickets;
  topMotivos: MotivoTicket[];
  porCourier: GrupoCourierTickets[];
  porMes: MesTickets[];
  calidadDatos: CalidadDatosTickets;
  // Métrica 1.5 — bloque dedicado, aditivo.
  velocidadResolucion: VelocidadResolucionTickets;
}

export interface ResultadoTicketsCliente extends ResultadoTicketsBase {
  scope: "cliente";
}

export interface ResultadoTicketsShipro extends ResultadoTicketsBase {
  porEmpresa: GrupoEmpresaTickets[];
  scope: "shipro";
}

export type ResultadoTicketsMesaAyuda = ResultadoTicketsCliente | ResultadoTicketsShipro;

const UMBRAL_SLA_HORAS_DEFAULT = 24;

export async function calcularTicketsMesaAyudaAnalitica(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT,
  umbralSlaHoras: number = UMBRAL_SLA_HORAS_DEFAULT
): Promise<ResultadoTicketsMesaAyuda> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clauses scope-aware.
  // Tickets: filtrar via envio.empresaId relation (TicketSoporte NO tiene empresaId directo).
  const ticketsWhere: any = {
    fechaCreacion: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    ticketsWhere.envio = { empresaId: ctx.empresaId };
  } else if (ctx.empresaId !== null) {
    ticketsWhere.envio = { empresaId: ctx.empresaId };
  }

  // Envios: filtrar via empresaId directo (Envio tiene empresaId).
  const enviosWhere: any = {
    fechaImpresion: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    enviosWhere.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    enviosWhere.empresaId = ctx.empresaId;
  }

  // Query A — Tickets con envio.courier, envio.empresa y auditorias includes.
  // Métrica 1.5: auditorias habilita el desglose por usuario que cerró.
  const tickets = await prisma.ticketSoporte.findMany({
    where: ticketsWhere,
    include: {
      envio: {
        include: {
          courier: { select: { id: true, nombre: true } },
          empresa: { select: { id: true, nombre: true } },
        },
      },
      auditorias: {
        select: { accion: true, usuarioEmail: true, fecha: true },
      },
    },
  });

  // Query B — denominador global.
  const totalEnviosEnVentana = await prisma.envio.count({
    where: enviosWhere,
  });

  // Query C — denominador per courier.
  const enviosPorCourier = await prisma.envio.groupBy({
    by: ["courierId"],
    where: enviosWhere,
    _count: true,
  });
  const enviosPorCourierMap = new Map<number, number>();
  for (const e of enviosPorCourier) {
    if (e.courierId !== null) {
      enviosPorCourierMap.set(e.courierId, e._count);
    }
  }

  // Query D — denominador per empresa (solo Shipro global).
  let enviosPorEmpresaMap = new Map<number, number>();
  if (ctx.modoDios && ctx.empresaId === null) {
    const enviosPorEmpresa = await prisma.envio.groupBy({
      by: ["empresaId"],
      where: enviosWhere,
      _count: true,
    });
    for (const e of enviosPorEmpresa) {
      if (e.empresaId !== null) {
        enviosPorEmpresaMap.set(e.empresaId, e._count);
      }
    }
  }

  const totalTickets = tickets.length;

  // Estados counts.
  const conteoAbierto = tickets.filter(t => t.estado === "ABIERTO").length;
  const conteoEnProgreso = tickets.filter(t => t.estado === "EN_PROGRESO").length;
  const conteoCerrado = tickets.filter(t => t.estado === "CERRADO").length;
  const totalActivos = conteoAbierto + conteoEnProgreso;
  const totalCerrados = conteoCerrado;

  // Tiempo de resolucion (dias) — muestra para 1.4 (mediana) y 1.5 (promedio + P95 + SLA).
  // Se admite tanto CERRADO como RESUELTO (ambos setean fechaCierre en tickets/route.ts:192-196).
  const ticketsCerradosConFecha = tickets.filter(
    t => (t.estado === "CERRADO" || t.estado === "RESUELTO") && t.fechaCierre
  );
  const tiemposResolucion = ticketsCerradosConFecha.map(t => {
    const ms = new Date(t.fechaCierre!).getTime() - new Date(t.fechaCreacion).getTime();
    return ms / (1000 * 60 * 60 * 24);
  });
  const tiempoMedianoResolucion = calcularMediana(tiemposResolucion);
  const tiempoPromedioResolucion = calcularPromedio(tiemposResolucion);
  const tiempoP95Resolucion = calcularPercentil(tiemposResolucion, 95);

  // Métrica 1.5 — SLA en horas, umbral default 24h.
  const umbralSlaDias = umbralSlaHoras / 24;
  const dentroSla = tiemposResolucion.filter(d => d <= umbralSlaDias).length;
  const fueraSla = tiemposResolucion.length - dentroSla;
  const tasaEnSlaPct =
    tiemposResolucion.length > 0
      ? Math.round((dentroSla / tiemposResolucion.length) * 1000) / 10
      : null;

  // Tasa soporte global.
  const tasaSoporte = totalEnviosEnVentana > 0
    ? Math.round((totalTickets / totalEnviosEnVentana) * 1000) / 10
    : 0;

  const resumen: ResumenTickets = {
    totalTickets,
    totalActivos,
    totalCerrados,
    totalEnviosEnVentana,
    tasaSoporte,
    tiempoMedianoResolucion,
    // Métrica 1.5 — aditivos.
    tiempoPromedioResolucion,
    tiempoP95Resolucion,
    umbralSlaHoras,
    tasaEnSlaPct,
    muestraCerrados: tiemposResolucion.length,
  };

  const pct = (n: number) =>
    totalTickets > 0 ? Math.round((n / totalTickets) * 100) : 0;

  const distribucionEstados: DistribucionEstadosTickets = {
    abierto: { cantidad: conteoAbierto, porcentaje: pct(conteoAbierto) },
    enProgreso: { cantidad: conteoEnProgreso, porcentaje: pct(conteoEnProgreso) },
    cerrado: { cantidad: conteoCerrado, porcentaje: pct(conteoCerrado) },
  };

  // Origen: heuristica esRadarShipro.
  const radarCount = tickets.filter(t => esRadarShipro(t.motivo)).length;
  const clienteCount = totalTickets - radarCount;

  const origen: OrigenTickets = {
    radarShipro: { cantidad: radarCount, porcentaje: pct(radarCount) },
    cliente: { cantidad: clienteCount, porcentaje: pct(clienteCount) },
  };

  // Top motivos (slice 5).
  const motivosMap = new Map<string, number>();
  for (const t of tickets) {
    motivosMap.set(t.motivo, (motivosMap.get(t.motivo) || 0) + 1);
  }
  const topMotivos: MotivoTicket[] = Array.from(motivosMap.entries())
    .map(([motivo, cantidad]) => ({
      motivo,
      cantidad,
      porcentaje: pct(cantidad),
    }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  // Por courier.
  type CourierAccum = { courierId: number; nombre: string; cantidad: number };
  const courierMap = new Map<number, CourierAccum>();
  for (const t of tickets) {
    if (t.envio?.courier) {
      const cid = t.envio.courier.id;
      if (!courierMap.has(cid)) {
        courierMap.set(cid, {
          courierId: cid,
          nombre: t.envio.courier.nombre,
          cantidad: 0,
        });
      }
      courierMap.get(cid)!.cantidad++;
    }
  }
  const porCourier: GrupoCourierTickets[] = Array.from(courierMap.values())
    .map(c => {
      const enviosTotales = enviosPorCourierMap.get(c.courierId) || 0;
      const tasa = enviosTotales > 0
        ? Math.round((c.cantidad / enviosTotales) * 1000) / 10
        : 0;
      return {
        courierId: c.courierId,
        nombre: c.nombre,
        cantidad: c.cantidad,
        enviosTotales,
        tasaSoporte: tasa,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);

  // Por mes (YYYY-MM, cronologico).
  const mesMap = new Map<string, number>();
  for (const t of tickets) {
    const d = new Date(t.fechaCreacion);
    const mesKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    mesMap.set(mesKey, (mesMap.get(mesKey) || 0) + 1);
  }
  const porMes: MesTickets[] = Array.from(mesMap.entries())
    .map(([mes, cantidad]) => ({ mes, cantidad }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const calidadDatos: CalidadDatosTickets = { ventanaDias };

  // ==========================================================================
  // Métrica 1.5 — Velocidad Resolución Tickets: desgloses.
  // Todos sobre `ticketsCerradosConFecha` (muestra de 1.5 — subconjunto de 1.4).
  // ==========================================================================

  // Por motivo — duración promedio + P95 por motivo.
  const motivoTiemposMap = new Map<string, number[]>();
  for (let i = 0; i < ticketsCerradosConFecha.length; i++) {
    const t = ticketsCerradosConFecha[i];
    const d = tiemposResolucion[i];
    const arr = motivoTiemposMap.get(t.motivo) || [];
    arr.push(d);
    motivoTiemposMap.set(t.motivo, arr);
  }
  const velocidadPorMotivo: VelocidadPorMotivo[] = Array.from(motivoTiemposMap.entries())
    .map(([motivo, duraciones]) => ({
      motivo,
      cantidad: duraciones.length,
      duracionPromedioDias: calcularPromedio(duraciones),
      duracionP95Dias: calcularPercentil(duraciones, 95),
    }))
    .sort((a, b) => (b.duracionPromedioDias ?? 0) - (a.duracionPromedioDias ?? 0))
    .slice(0, 10);

  // Por usuario que cerró — inferido desde AuditoriaSoporte con acción de cierre.
  // Si hay varias acciones de cierre, se cuenta la ÚLTIMA (la que efectivamente cerró).
  const usuarioTiemposMap = new Map<string, number[]>();
  for (let i = 0; i < ticketsCerradosConFecha.length; i++) {
    const t = ticketsCerradosConFecha[i];
    const d = tiemposResolucion[i];
    const auditoriasCierre = (t.auditorias ?? [])
      .filter(a => esAccionCierre(a.accion))
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    const email = auditoriasCierre[0]?.usuarioEmail;
    if (email) {
      const arr = usuarioTiemposMap.get(email) || [];
      arr.push(d);
      usuarioTiemposMap.set(email, arr);
    }
  }
  const velocidadPorUsuarioCierre: VelocidadPorUsuario[] = Array.from(usuarioTiemposMap.entries())
    .map(([usuarioEmail, duraciones]) => ({
      usuarioEmail,
      cantidad: duraciones.length,
      duracionPromedioDias: calcularPromedio(duraciones),
    }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10);

  // Por hora de apertura del ticket (0..23).
  const horaTiemposMap = new Map<number, number[]>();
  for (let i = 0; i < ticketsCerradosConFecha.length; i++) {
    const t = ticketsCerradosConFecha[i];
    const d = tiemposResolucion[i];
    const h = new Date(t.fechaCreacion).getHours();
    const arr = horaTiemposMap.get(h) || [];
    arr.push(d);
    horaTiemposMap.set(h, arr);
  }
  const velocidadPorHora: VelocidadPorHora[] = Array.from({ length: 24 }, (_, h) => {
    const duraciones = horaTiemposMap.get(h) || [];
    return {
      hora: h,
      cantidad: duraciones.length,
      duracionPromedioDias: calcularPromedio(duraciones),
    };
  });

  // Por día de la semana (0=dom..6=sáb).
  const diaTiemposMap = new Map<number, number[]>();
  for (let i = 0; i < ticketsCerradosConFecha.length; i++) {
    const t = ticketsCerradosConFecha[i];
    const d = tiemposResolucion[i];
    const dia = new Date(t.fechaCreacion).getDay();
    const arr = diaTiemposMap.get(dia) || [];
    arr.push(d);
    diaTiemposMap.set(dia, arr);
  }
  const velocidadPorDiaSemana: VelocidadPorDiaSemana[] = Array.from({ length: 7 }, (_, dia) => {
    const duraciones = diaTiemposMap.get(dia) || [];
    return {
      diaSemana: dia,
      cantidad: duraciones.length,
      duracionPromedioDias: calcularPromedio(duraciones),
    };
  });

  const velocidadResolucion: VelocidadResolucionTickets = {
    umbralSlaHoras,
    muestra: tiemposResolucion.length,
    dentroSla,
    fueraSla,
    porMotivo: velocidadPorMotivo,
    porUsuarioCierre: velocidadPorUsuarioCierre,
    porHora: velocidadPorHora,
    porDiaSemana: velocidadPorDiaSemana,
  };

  const base: ResultadoTicketsBase = {
    resumen,
    distribucionEstados,
    origen,
    topMotivos,
    porCourier,
    porMes,
    calidadDatos,
    velocidadResolucion,
  };

  if (!ctx.modoDios) {
    return { ...base, scope: "cliente" };
  }

  // Por empresa (solo Shipro global).
  type EmpresaAccum = { empresaId: number; empresaNombre: string; cantidad: number };
  const empresaMap = new Map<number, EmpresaAccum>();
  if (ctx.empresaId === null) {
    for (const t of tickets) {
      if (t.envio?.empresa) {
        const eid = t.envio.empresa.id;
        if (!empresaMap.has(eid)) {
          empresaMap.set(eid, {
            empresaId: eid,
            empresaNombre: t.envio.empresa.nombre,
            cantidad: 0,
          });
        }
        empresaMap.get(eid)!.cantidad++;
      }
    }
  }
  const porEmpresa: GrupoEmpresaTickets[] = Array.from(empresaMap.values())
    .map(e => {
      const enviosTotales = enviosPorEmpresaMap.get(e.empresaId) || 0;
      const tasa = enviosTotales > 0
        ? Math.round((e.cantidad / enviosTotales) * 1000) / 10
        : 0;
      return {
        empresaId: e.empresaId,
        empresaNombre: e.empresaNombre,
        cantidad: e.cantidad,
        enviosTotales,
        tasaSoporte: tasa,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);

  return { ...base, porEmpresa, scope: "shipro" };
}
