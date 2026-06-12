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
