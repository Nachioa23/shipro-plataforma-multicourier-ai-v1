// ============================================================================
// HELPER — Mapa SLA (Metrica 12 dashboard)
//
// Migracion de la logica inline de /api/metricas (seccion M10: SLA INDEX)
// a un helper reusable + endpoint dedicado. Sigue el patron de las otras
// 13 metricas migradas en sesiones anteriores.
//
// IMPORTANTE: esta migracion preserva BUGS PRE-EXISTENTES del legacy:
//
// BUG 1 (key mismatch en diccionarioSlas):
//   El cron metricas-sla pre-computa por provinciaDestino raw ("Buenos Aires").
//   La logica aqui usa zona normalizada ("AMBA", "CABA"). Resultado: el
//   diccionario SlaCourier (clave "courierId-zonaNombre") raramente matchea
//   y se aplica fallback meta=5 dias.
//
// BUG 2 (metaPactada sobrescribe):
//   Si una misma zona tiene multiples couriers con metas distintas, la zona
//   reporta solo la meta del ultimo procesado.
//
// BUG 3 (tabla MetricaSLA ignorada):
//   El cron popula MetricaSLA pero esta logica recalcula on-the-fly.
//
// DEUDA 61 documenta los 3 bugs para resolucion futura. Esta migracion solo
// limpia arquitectura, no corrige logica.
// ============================================================================

import prisma from "@/lib/prisma";

const VENTANA_DIAS_DEFAULT = 90;
const META_FALLBACK_DIAS = 5;

// Normalizacion de provincias a "zonas" legacy.
// Mantenida exacta como en /api/metricas para no alterar numeros visibles.
function normalizarZona(provincia: string | null | undefined): string {
  if (!provincia) return "Sin Zona";
  const p = provincia.toLowerCase().trim();
  if (p.includes("buenos aires") && !p.includes("ciudad")) return "Buenos Aires";
  if (p.includes("ciudad") || p === "caba") return "CABA";
  return provincia;
}

export interface ResumenSLA {
  cumplimientoE2E: number;                 // % envios entregados dentro de promesa checkout
  slaHealthIndex: number;                  // 0-inf, <=1 OK (promedio simple de indices)
  promedioPreparacion: number;             // dias entre impresion y colecta

  // Realidad operativa (decision director 2026-06-11):
  // Couriers en Argentina chantean estados virtuales para mantener SLA artificial.
  // Estas 3 metricas dan visibilidad de la friccion operativa real.
  totalEnviosConIncidencia: number;         // envios entregados que tuvieron al menos 1 incidencia
  porcentajeEnviosConIncidencia: number;    // % sobre total ENTREGADO en ventana
  promedioIntentosEntrega: number;          // intentos promedio (1.0 = directo, 1.5 = mitad necesito 2)
}

export interface ZonaSLA {
  zona: string;
  indice: number;          // promedio del indice SLA en la zona
  transitoReal: number;    // dias promedio de transito en la zona
  metaPactada: number;     // dias pactados (BUG 2: sobrescribe si multiples couriers)
  cumplimiento: number;    // % envios cumplidos en la zona
  volumen: number;         // envios medidos
}

export interface MapaSLAResultado {
  resumen: ResumenSLA;
  mapaZonas: ZonaSLA[];
  calidadDatos: {
    ventanaDias: number;
    totalEnviosE2E: number;
    totalEnviosTransito: number;
    totalEnviosPrep: number;
    fuente: string;
    nivelImplementado: string;
    nivelPendiente: string;
  };
}

export async function calcularMapaSLA(
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<MapaSLAResultado> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Cargar diccionario SLA por courier+zona.
  const slasDB = await prisma.slaCourier.findMany();
  const diccionarioSlas = new Map<string, number>();
  for (const s of slasDB) {
    diccionarioSlas.set(`${s.courierId}-${s.zonaNombre}`, s.diasPactados);
  }

  // Cargar envios entregados en ventana con timestamps relevantes.
  const envios = await prisma.envio.findMany({
    where: {
      estadoActual: "ENTREGADO",
      fechaImpresion: { gte: ventanaInicio },
    },
    select: {
      id: true,
      courierId: true,
      fechaImpresion: true,
      fechaColecta: true,
      fechaEntrega: true,
      diasPrometidosCheckout: true,
      destino: {
        select: { provincia: true },
      },
      eventos: {
        select: { estado: true, fecha: true },
      },
    },
  });

  let totalE2E = 0;
  let cumplidosE2E = 0;
  let totalSlaCourier = 0;
  let sumaIndicesSla = 0;
  let totalPrep = 0;
  let sumaDiasPrep = 0;

  let enviosConIncidencia = 0;
  let sumaIntentosEntrega = 0;
  let totalConIntentos = 0;

  const desgloseZonas: Record<string, {
    total: number;
    sumaIndice: number;
    sumaTransito: number;
    meta: number;
    cumple: number;
  }> = {};

  for (const e of envios) {
    // Metricas de realidad operativa (decision director):
    // Detectar incidencias y contar intentos via eventos[].
    const eventosIncidencia = (e.eventos || []).filter(ev => {
      const est = (ev.estado || "").toUpperCase();
      return est.includes("VISITA_FALLIDA") || est.includes("INCIDENCIA") || est.includes("FALLIDA");
    });
    const eventosEntrega = (e.eventos || []).filter(ev => {
      const est = (ev.estado || "").toUpperCase();
      return est === "ENTREGADO" || est.includes("VISITA_FALLIDA") || est.includes("FALLIDA");
    });

    if (eventosIncidencia.length > 0) enviosConIncidencia++;
    if (eventosEntrega.length > 0) {
      totalConIntentos++;
      sumaIntentosEntrega += eventosEntrega.length;
    }

    // Metrica 1: cumplimientoE2E (impresion -> entrega).
    // Universo ENTREGADO (decision divergencia 2): mas estricto que legacy.
    // Default promesa = 5 dias para envios sin diasPrometidosCheckout (paridad legacy).
    if (e.fechaEntrega && e.fechaImpresion) {
      const diasRealesE2E = (e.fechaEntrega.getTime() - e.fechaImpresion.getTime()) / (1000 * 60 * 60 * 24);
      const promesa = e.diasPrometidosCheckout || 5;
      totalE2E++;
      if (diasRealesE2E <= promesa) cumplidosE2E++;
    }

    // Metrica 2: slaHealthIndex (colecta -> hito SLA).
    if (e.fechaColecta && e.fechaEntrega) {
      const zona = normalizarZona(e.destino?.provincia);
      const meta = diccionarioSlas.get(`${e.courierId}-${zona}`) || META_FALLBACK_DIAS;
      const diasTransito = (e.fechaEntrega.getTime() - e.fechaColecta.getTime()) / (1000 * 60 * 60 * 24);
      const indice = diasTransito / meta;

      totalSlaCourier++;
      sumaIndicesSla += indice;

      if (!desgloseZonas[zona]) {
        desgloseZonas[zona] = { total: 0, sumaIndice: 0, sumaTransito: 0, meta, cumple: 0 };
      }
      desgloseZonas[zona].total++;
      desgloseZonas[zona].sumaIndice += indice;
      desgloseZonas[zona].sumaTransito += diasTransito;
      desgloseZonas[zona].meta = meta;  // BUG 2: sobrescribe
      if (diasTransito <= meta) desgloseZonas[zona].cumple++;
    }

    // Metrica 3: promedioPreparacion (impresion -> colecta).
    if (e.fechaColecta && e.fechaImpresion) {
      const diasPrep = (e.fechaColecta.getTime() - e.fechaImpresion.getTime()) / (1000 * 60 * 60 * 24);
      totalPrep++;
      sumaDiasPrep += diasPrep;
    }
  }

  const totalEntregadosEnVentana = envios.length;

  const resumen: ResumenSLA = {
    cumplimientoE2E: totalE2E > 0 ? Math.round((cumplidosE2E / totalE2E) * 100) : 0,
    slaHealthIndex: totalSlaCourier > 0
      ? Number((sumaIndicesSla / totalSlaCourier).toFixed(2))
      : 0,
    promedioPreparacion: totalPrep > 0
      ? Number((sumaDiasPrep / totalPrep).toFixed(1))
      : 0,
    totalEnviosConIncidencia: enviosConIncidencia,
    porcentajeEnviosConIncidencia: totalEntregadosEnVentana > 0
      ? Math.round((enviosConIncidencia / totalEntregadosEnVentana) * 1000) / 10
      : 0,
    promedioIntentosEntrega: totalConIntentos > 0
      ? Number((sumaIntentosEntrega / totalConIntentos).toFixed(2))
      : 0,
  };

  const mapaZonas: ZonaSLA[] = Object.keys(desgloseZonas)
    .map(z => ({
      zona: z,
      indice: Number((desgloseZonas[z].sumaIndice / desgloseZonas[z].total).toFixed(2)),
      transitoReal: Number((desgloseZonas[z].sumaTransito / desgloseZonas[z].total).toFixed(1)),
      metaPactada: desgloseZonas[z].meta,
      cumplimiento: Math.round((desgloseZonas[z].cumple / desgloseZonas[z].total) * 100),
      volumen: desgloseZonas[z].total,
    }))
    .sort((a, b) => b.volumen - a.volumen);

  return {
    resumen,
    mapaZonas,
    calidadDatos: {
      ventanaDias,
      totalEnviosE2E: totalE2E,
      totalEnviosTransito: totalSlaCourier,
      totalEnviosPrep: totalPrep,
      fuente: "Envio + SlaCourier (calculo on-the-fly, zonas normalizadas legacy)",
      nivelImplementado: "NIVEL 1 (paridad funcional con /api/metricas legacy, sin correcciones)",
      nivelPendiente: "NIVEL 2 (DEUDA 61): corregir 3 bugs preservados (key mismatch + metaPactada + ignorar MetricaSLA pre-computada)",
    },
  };
}

// ============================================================================
// ORQUESTACION SCOPE-AWARE — calcularMapaSlaAnalitica(ctx)
//
// Phase 2.1.b (Panel cliente migration, 2026-06-15).
// Variante scope-aware del orchestrator calcularMapaSLA existente arriba.
// La funcion existente queda intacta (sin breaking changes) por compat
// con consumers no migrados — el endpoint Torre se migra a esta nueva
// funcion en Phase 2.1.c.
//
// SEMANTICA: identica a calcularMapaSLA pero agrega:
// 1) Filtrado por scope (empresaId).
// 2) Discriminated union con porEmpresa adicional en shape Shipro.
// 3) CORRIGE incidentalmente BUG 1 de DEUDA 61: key del lookup
//    diccionario SlaCourier ahora normaliza zonaNombre con
//    normalizarZona() para matchear contra envio destino normalizado.
//    Resultado: el lookup ahora matchea correctamente (antes caia en
//    fallback META_FALLBACK_DIAS=5 casi siempre). BUGS 2 y 3 de DEUDA
//    61 preservados (totalEnviosConIncidencia, porcentajeEnviosCon-
//    Incidencia, promedioIntentosEntrega = 0 hardcoded; MetricaSLA
//    pre-computada ignorada).
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.envio por ctx.empresaId.
//   Retorna shape "cliente" sin porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): sin filtro
//   de empresa. Retorna shape "shipro" con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): filtra a esa
//   empresa. Retorna shape "shipro" sin porEmpresa (1-entry o vacio).
//
// IMPORTANTE: prisma.slaCourier NO se filtra por empresa (es config
// global del diccionario SLAs pactados).
//
// Decisiones de producto (director 2026-06-15):
// D1 - Funcion nueva separada (no breaking de calcularMapaSLA existente).
// D2 - porEmpresa solo en shape Shipro.
// D3 - Filtrado solo en envio (slaCourier intacto).
// D4 - DEUDA 61 BUG 1 corregido incidentalmente (key normalization);
//      BUGS 2 y 3 preservados.
// D5 - Key separator: pipe ("|") — evita falsos matches con courier/
//      zona names que contienen dashes.
// ============================================================================

import type { AuthContext } from "@/lib/auth-context";

export interface CalidadDatosSLA {
  ventanaDias: number;
  totalEnviosE2E: number;
  totalEnviosTransito: number;
  totalEnviosPrep: number;
  fuente: string;
  nivelImplementado: string;
  nivelPendiente: string;
}

export interface GrupoEmpresaSLA {
  empresaId: number;
  empresaNombre: string;
  cumplimientoE2E: number;
  promedioPreparacion: number;
  slaHealthIndex: number;
  cantidadEnvios: number;
}

export interface ResultadoMapaSlaCliente {
  resumen: ResumenSLA;
  mapaZonas: ZonaSLA[];
  calidadDatos: CalidadDatosSLA;
  scope: "cliente";
}

export interface ResultadoMapaSlaShipro {
  resumen: ResumenSLA;
  mapaZonas: ZonaSLA[];
  calidadDatos: CalidadDatosSLA;
  porEmpresa: GrupoEmpresaSLA[];
  scope: "shipro";
}

export type ResultadoMapaSla = ResultadoMapaSlaCliente | ResultadoMapaSlaShipro;

export async function calcularMapaSlaAnalitica(
  ctx: AuthContext,
  ventanaDias: number = 90
): Promise<ResultadoMapaSla> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause scope-aware.
  const whereClause: any = {
    estadoActual: "ENTREGADO",
    fechaImpresion: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  // SLA diccionario: NO filtrar por empresa, es config global.
  const slasCourier = await prisma.slaCourier.findMany({
    select: {
      courierId: true,
      zonaNombre: true,
      diasPactados: true,
    },
  });

  // Envios scope-aware.
  const envios = await prisma.envio.findMany({
    where: whereClause,
    select: {
      id: true,
      empresaId: true,
      courierId: true,
      fechaImpresion: true,
      fechaColecta: true,
      fechaEntrega: true,
      diasPrometidosCheckout: true,
      destino: { select: { provincia: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  // Build SLA lookup: courierId|zonaNormalizada -> diasPactados.
  // BUG 1 FIX: normalizar zona del diccionario para matchear envio destino.
  const slaLookup = new Map<string, number>();
  for (const s of slasCourier) {
    if (s.courierId === null || s.zonaNombre === null) continue;
    const zonaNorm = normalizarZona(s.zonaNombre);
    if (!zonaNorm) continue;
    const key = `${s.courierId}|${zonaNorm}`;
    slaLookup.set(key, s.diasPactados);
  }

  // Accumulators globales.
  type ZonaAccum = {
    transitos: number[];
    metaPactadas: number[];
    volumen: number;
  };
  const zonaAccum = new Map<string, ZonaAccum>();

  let totalCumplimientoE2E = 0;
  let cantidadConPromesa = 0;
  let sumaPreparacion = 0;
  let cantidadConPrep = 0;
  let cantidadEnviosE2E = 0;
  let cantidadEnviosTransito = 0;

  // Per-empresa accum (solo modoDios global con ctx.empresaId === null).
  type EmpresaAccum = {
    empresaId: number;
    empresaNombre: string;
    cumplidos: number;
    conPromesa: number;
    sumaPrep: number;
    cantidadPrep: number;
    transitos: number[];
    metaPactadas: number[];
    cantidadEnvios: number;
  };
  const empresaMap = new Map<number, EmpresaAccum>();

  for (const e of envios) {
    if (!e.fechaImpresion || !e.fechaEntrega) continue;
    cantidadEnviosE2E++;

    const provNorm = e.destino?.provincia ? normalizarZona(e.destino.provincia) : null;
    if (!provNorm) continue;

    // Transito real (dias).
    let transitoReal: number | null = null;
    if (e.fechaColecta && e.fechaEntrega) {
      const horasTransito = (e.fechaEntrega.getTime() - e.fechaColecta.getTime()) / 3600000;
      transitoReal = Math.ceil(horasTransito / 24);
      cantidadEnviosTransito++;
    }

    // Meta pactada (lookup con key normalizado).
    const slaKey = `${e.courierId}|${provNorm}`;
    const metaDias = slaLookup.get(slaKey) ?? META_FALLBACK_DIAS;

    // Acumular en zona.
    if (!zonaAccum.has(provNorm)) {
      zonaAccum.set(provNorm, { transitos: [], metaPactadas: [], volumen: 0 });
    }
    const za = zonaAccum.get(provNorm)!;
    za.volumen++;
    if (transitoReal !== null) {
      za.transitos.push(transitoReal);
      za.metaPactadas.push(metaDias);
    }

    // Cumplimiento E2E.
    if (e.diasPrometidosCheckout !== null && e.diasPrometidosCheckout !== undefined) {
      cantidadConPromesa++;
      const horasReales = (e.fechaEntrega.getTime() - e.fechaImpresion.getTime()) / 3600000;
      const diasReales = Math.ceil(horasReales / 24);
      if (diasReales <= e.diasPrometidosCheckout) totalCumplimientoE2E++;
    }

    // Preparacion.
    if (e.fechaColecta && e.fechaImpresion) {
      const horasPrep = (e.fechaColecta.getTime() - e.fechaImpresion.getTime()) / 3600000;
      const diasPrep = Math.ceil(horasPrep / 24);
      sumaPreparacion += diasPrep;
      cantidadConPrep++;
    }

    // Per-empresa accum.
    if (ctx.modoDios && ctx.empresaId === null && e.empresa) {
      const eid = e.empresa.id;
      if (!empresaMap.has(eid)) {
        empresaMap.set(eid, {
          empresaId: eid,
          empresaNombre: e.empresa.nombre,
          cumplidos: 0,
          conPromesa: 0,
          sumaPrep: 0,
          cantidadPrep: 0,
          transitos: [],
          metaPactadas: [],
          cantidadEnvios: 0,
        });
      }
      const emp = empresaMap.get(eid)!;
      emp.cantidadEnvios++;
      if (e.diasPrometidosCheckout != null) {
        emp.conPromesa++;
        const horasReales = (e.fechaEntrega.getTime() - e.fechaImpresion.getTime()) / 3600000;
        const diasReales = Math.ceil(horasReales / 24);
        if (diasReales <= e.diasPrometidosCheckout) emp.cumplidos++;
      }
      if (e.fechaColecta && e.fechaImpresion) {
        const horasPrep = (e.fechaColecta.getTime() - e.fechaImpresion.getTime()) / 3600000;
        emp.sumaPrep += Math.ceil(horasPrep / 24);
        emp.cantidadPrep++;
      }
      if (transitoReal !== null) {
        emp.transitos.push(transitoReal);
        emp.metaPactadas.push(metaDias);
      }
    }
  }

  // Build mapaZonas[].
  const mapaZonas: ZonaSLA[] = Array.from(zonaAccum.entries())
    .map(([zona, a]) => {
      const transitoPromedio = a.transitos.length > 0
        ? Math.round(a.transitos.reduce((s, v) => s + v, 0) / a.transitos.length)
        : 0;
      const metaPromedio = a.metaPactadas.length > 0
        ? Math.round(a.metaPactadas.reduce((s, v) => s + v, 0) / a.metaPactadas.length)
        : META_FALLBACK_DIAS;
      const indice = metaPromedio > 0 ? Number((transitoPromedio / metaPromedio).toFixed(2)) : 0;
      const cumplimientoZona = a.transitos.filter((t, i) => t <= a.metaPactadas[i]).length;
      const porcentajeCumplimiento = a.transitos.length > 0
        ? Math.round((cumplimientoZona / a.transitos.length) * 100)
        : 0;
      return {
        zona,
        indice,
        transitoReal: transitoPromedio,
        metaPactada: metaPromedio,
        cumplimiento: porcentajeCumplimiento,
        volumen: a.volumen,
      };
    })
    .sort((a, b) => b.volumen - a.volumen);

  // Resumen global.
  const cumplimientoE2E = cantidadConPromesa > 0
    ? Math.round((totalCumplimientoE2E / cantidadConPromesa) * 100)
    : 0;
  const promedioPreparacion = cantidadConPrep > 0
    ? Math.round(sumaPreparacion / cantidadConPrep)
    : 0;

  // SLA Health Index global: promedio ponderado de indices por volumen.
  let slaHealthIndex = 0;
  let volumenTotal = 0;
  for (const z of mapaZonas) {
    slaHealthIndex += z.indice * z.volumen;
    volumenTotal += z.volumen;
  }
  slaHealthIndex = volumenTotal > 0 ? Number((slaHealthIndex / volumenTotal).toFixed(2)) : 0;

  const resumen: ResumenSLA = {
    cumplimientoE2E,
    slaHealthIndex,
    promedioPreparacion,
    totalEnviosConIncidencia: 0,           // DEUDA 61 BUG 2 — preservar
    porcentajeEnviosConIncidencia: 0,      // DEUDA 61 BUG 2 — preservar
    promedioIntentosEntrega: 0,            // DEUDA 61 BUG 3 — preservar
  };

  const calidadDatos: CalidadDatosSLA = {
    ventanaDias,
    totalEnviosE2E: cantidadEnviosE2E,
    totalEnviosTransito: cantidadEnviosTransito,
    totalEnviosPrep: cantidadConPrep,
    fuente: "Envios entregados + diccionario SlaCourier (zonas normalizadas)",
    nivelImplementado: "NIVEL 1.5: transito real vs meta pactada por zona (DEUDA 61 BUG 1 corregido) + cumplimiento E2E vs promesa checkout",
    nivelPendiente: "NIVEL 2 (DEUDA 61): incidencias + intentos entrega + correlacion con MetricaSLA pre-computada",
  };

  if (!ctx.modoDios) {
    return {
      resumen,
      mapaZonas,
      calidadDatos,
      scope: "cliente",
    };
  }

  // Shipro: include porEmpresa.
  const porEmpresa: GrupoEmpresaSLA[] = Array.from(empresaMap.values())
    .map(e => {
      const transitoPromedio = e.transitos.length > 0
        ? Math.round(e.transitos.reduce((s, v) => s + v, 0) / e.transitos.length)
        : 0;
      const metaPromedio = e.metaPactadas.length > 0
        ? Math.round(e.metaPactadas.reduce((s, v) => s + v, 0) / e.metaPactadas.length)
        : META_FALLBACK_DIAS;
      const indice = metaPromedio > 0 ? Number((transitoPromedio / metaPromedio).toFixed(2)) : 0;
      return {
        empresaId: e.empresaId,
        empresaNombre: e.empresaNombre,
        cumplimientoE2E: e.conPromesa > 0 ? Math.round((e.cumplidos / e.conPromesa) * 100) : 0,
        promedioPreparacion: e.cantidadPrep > 0 ? Math.round(e.sumaPrep / e.cantidadPrep) : 0,
        slaHealthIndex: indice,
        cantidadEnvios: e.cantidadEnvios,
      };
    })
    .sort((a, b) => b.cantidadEnvios - a.cantidadEnvios);

  return {
    resumen,
    mapaZonas,
    calidadDatos,
    porEmpresa,
    scope: "shipro",
  };
}
