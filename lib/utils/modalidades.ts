/**
 * Catalogo canonico de modalidades (DEUDA 47 fix + Metrica 3.3).
 *
 * Las 8 modalidades operativas que Shipro reconoce. Decision producto 2026-06-08:
 * - 5 forward (entregas al comprador).
 * - 3 reverse (devoluciones y cambios).
 *
 * El catalogo es la unica fuente de verdad para agrupar/analizar/persistir
 * modalidad en BD. Todos los strings que llegan desde el cotizador, e-commerce,
 * o legacy se normalizan a una de estas 8 categorias antes de persistirse en
 * Envio.modalidad.
 *
 * Si en el futuro el catalogo cambia (nueva modalidad, deprecation), modificar
 * aqui y los consumidores (crear.ts, endpoint metricas, dashboard) se ajustan
 * automaticamente porque dependen del tipo ModalidadCanonica.
 */

// Catalogo cerrado de modalidades canonicas v1 (2026-06-08).
export const MODALIDADES_CANONICAS = [
  // Forward (5).
  "Entrega a Domicilio (Estandar)",
  "Entrega a Domicilio (Same Day)",
  "Retiro en Sucursal (Estandar)",
  "Retiro en Punto de Retiro (Estandar)",
  "Retiro en e-locker (Estandar)",
  // Reverse (3).
  "Devolucion desde Sucursal (Estandar)",
  "Devolucion desde Domicilio (Estandar)",
  "Cambio desde Domicilio (Estandar)",
] as const;

export type ModalidadCanonica = typeof MODALIDADES_CANONICAS[number];

// Valor sentinel para modalidades no reconocidas. Se persiste en BD para no
// perder informacion, pero el dashboard puede mostrarlo separado.
export const MODALIDAD_DESCONOCIDA = "Desconocida" as const;
export type ModalidadCanonicaOrDesconocida = ModalidadCanonica | typeof MODALIDAD_DESCONOCIDA;

// Split forward/reverse para el dashboard de Metrica 3.3.
export function esModalidadForward(modalidad: ModalidadCanonica): boolean {
  return modalidad.startsWith("Entrega") || modalidad.startsWith("Retiro");
}

export function esModalidadReverse(modalidad: ModalidadCanonica): boolean {
  return modalidad.startsWith("Devolucion") || modalidad.startsWith("Cambio");
}

/**
 * Normaliza un string arbitrario a una modalidad canonica.
 *
 * Casos cubiertos:
 * 1. Match directo (case-insensitive con o sin tildes) a una de las 8 canonicas.
 * 2. Match parcial via patrones comunes ("estandar" + "domicilio" → "Entrega a Domicilio (Estandar)").
 * 3. Strings legacy ("Estandar" solo, "Estándar" con tilde, "Devolucion Inversa") → mapeo a categoria default razonable.
 * 4. Cualquier otro → MODALIDAD_DESCONOCIDA.
 *
 * @param input - String crudo (puede ser undefined/null si no llega del e-commerce)
 * @returns ModalidadCanonica si reconocida, "Desconocida" en otro caso
 */
export function normalizarModalidad(input: string | null | undefined): ModalidadCanonicaOrDesconocida {
  if (!input || typeof input !== "string") return MODALIDAD_DESCONOCIDA;

  // Sanitizar: lowercase + sin tildes + colapsar espacios.
  const sanitized = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remueve tildes
    .replace(/\s+/g, " ");

  // 1. Match directo case-insensitive contra catalogo canonico.
  for (const canonica of MODALIDADES_CANONICAS) {
    const canonicaSanitized = canonica
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
    if (sanitized === canonicaSanitized) return canonica;
  }

  // 2. Patrones comunes con palabras clave.
  // 2a. Same Day (con o sin guion, con o sin parentesis).
  if (sanitized.includes("same day") || sanitized.includes("same-day") || sanitized.includes("sameday")) {
    if (sanitized.includes("domicilio")) return "Entrega a Domicilio (Same Day)";
    // Default: Same Day = Entrega a Domicilio (Same Day).
    return "Entrega a Domicilio (Same Day)";
  }

  // 2b. Cambio.
  if (sanitized.includes("cambio")) {
    return "Cambio desde Domicilio (Estandar)";
  }

  // 2c. Devolucion.
  if (sanitized.includes("devolucion")) {
    if (sanitized.includes("sucursal")) return "Devolucion desde Sucursal (Estandar)";
    if (sanitized.includes("domicilio")) return "Devolucion desde Domicilio (Estandar)";
    // Legacy "Devolucion Inversa" o similar → asumimos desde Domicilio.
    return "Devolucion desde Domicilio (Estandar)";
  }

  // 2d. Punto de Retiro.
  if (sanitized.includes("punto de retiro") || sanitized.includes("punto retiro") || sanitized.includes("pickup point")) {
    return "Retiro en Punto de Retiro (Estandar)";
  }

  // 2e. e-locker / locker.
  if (sanitized.includes("e-locker") || sanitized.includes("elocker") || sanitized.includes("locker")) {
    return "Retiro en e-locker (Estandar)";
  }

  // 2f. Retiro en sucursal.
  if (sanitized.includes("sucursal")) {
    return "Retiro en Sucursal (Estandar)";
  }

  // 2g. Entrega a domicilio (estandar implicito).
  if (sanitized.includes("domicilio")) {
    return "Entrega a Domicilio (Estandar)";
  }

  // 3. Legacy: "estandar" solo (los 27 envios viejos en BD).
  // Asumimos Forward + Domicilio como default razonable (el mayoritario).
  if (sanitized === "estandar") {
    return "Entrega a Domicilio (Estandar)";
  }

  // 4. Nada matcheo: MODALIDAD_DESCONOCIDA.
  return MODALIDAD_DESCONOCIDA;
}

/**
 * Resultado de la inferencia de modalidad cuando el e-commerce no manda
 * el campo explicitamente.
 */
export interface ResultadoInferenciaModalidad {
  modalidad: ModalidadCanonicaOrDesconocida;
  fuente: "input_explicito" | "inferida_por_precio" | "inferida_por_courier" | "fallback_default";
  opcionMatcheada: {
    courier: string;
    modalidadOriginal: string;
    precio: number;
  } | null;
}

/**
 * Infiere la modalidad eligida por el comprador dadas las opciones del
 * cotizador y los inputs del e-commerce (nombreCourier + costoEnvio).
 *
 * Estrategia (defensa en capas β+δ):
 * 1. Si modalidadInput esta presente y se normaliza a canonica → usar.
 * 2. Si no, buscar entre opcionesCotizador la que matchea (courier + precio mas cercano) y normalizar su modalidad.
 * 3. Si no hay match perfecto pero hay opciones del mismo courier, tomar la primera y normalizar.
 * 4. Si nada matchea, fallback default.
 *
 * @param opcionesCotizador - Array de OpcionTarifa del cotizador interno (dom + suc combinados)
 * @param nombreCourierInput - Courier que el e-commerce dice que eligio (string libre)
 * @param costoEnvioInput - Precio del envio (numero o string)
 * @param modalidadInput - Modalidad explicita si vino del e-commerce (raro hoy)
 * @returns ResultadoInferenciaModalidad con la mejor estimacion
 */
export function inferirModalidad(
  opcionesCotizador: Array<{ courier: string; modalidad: string; precioFinal: number }>,
  nombreCourierInput: string | null | undefined,
  costoEnvioInput: number | string | null | undefined,
  modalidadInput: string | null | undefined
): ResultadoInferenciaModalidad {
  // Capa 1: input explicito normalizable.
  if (modalidadInput) {
    const normalizada = normalizarModalidad(modalidadInput);
    if (normalizada !== MODALIDAD_DESCONOCIDA) {
      return {
        modalidad: normalizada,
        fuente: "input_explicito",
        opcionMatcheada: null,
      };
    }
  }

  // Capa 2: inferencia por (courier + precio).
  const courierLower = (nombreCourierInput || "").toLowerCase();
  const precioNumerico = typeof costoEnvioInput === "string" ? parseFloat(costoEnvioInput) : (costoEnvioInput ?? 0);

  if (courierLower && opcionesCotizador.length > 0 && precioNumerico > 0) {
    // Filtrar opciones del mismo courier.
    const opcionesMismoCourier = opcionesCotizador.filter(
      op => op.courier.toLowerCase() === courierLower
    );

    if (opcionesMismoCourier.length > 0) {
      // Tomar la opcion del courier con precio mas cercano al input.
      let mejorMatch = opcionesMismoCourier[0];
      let mejorDelta = Math.abs(mejorMatch.precioFinal - precioNumerico);

      for (const op of opcionesMismoCourier) {
        const delta = Math.abs(op.precioFinal - precioNumerico);
        if (delta < mejorDelta) {
          mejorMatch = op;
          mejorDelta = delta;
        }
      }

      const normalizada = normalizarModalidad(mejorMatch.modalidad);
      return {
        modalidad: normalizada,
        fuente: "inferida_por_precio",
        opcionMatcheada: {
          courier: mejorMatch.courier,
          modalidadOriginal: mejorMatch.modalidad,
          precio: mejorMatch.precioFinal,
        },
      };
    }
  }

  // Capa 3: si hay opciones del mismo courier pero sin precio, tomar la primera.
  if (courierLower && opcionesCotizador.length > 0) {
    const opcionesMismoCourier = opcionesCotizador.filter(
      op => op.courier.toLowerCase() === courierLower
    );
    if (opcionesMismoCourier.length > 0) {
      const primera = opcionesMismoCourier[0];
      return {
        modalidad: normalizarModalidad(primera.modalidad),
        fuente: "inferida_por_courier",
        opcionMatcheada: {
          courier: primera.courier,
          modalidadOriginal: primera.modalidad,
          precio: primera.precioFinal,
        },
      };
    }
  }

  // Capa 4: fallback default razonable.
  return {
    modalidad: "Entrega a Domicilio (Estandar)",
    fuente: "fallback_default",
    opcionMatcheada: null,
  };
}

// ============================================================================
// ORQUESTACION SCOPE-AWARE — calcularModalidadesAnalitica(ctx)
//
// Phase 2.2.b (Panel cliente migration, 2026-06-15).
// Agrega orquestador analitico scope-aware al helper, sin romper
// los 9 exports existentes (catalog + primitivas + inferirModalidad
// que sirve a crear.ts en runtime de creacion de envios).
//
// SEMANTICA: extrae al helper la logica que estaba inline en el
// endpoint /api/torre-de-control/modalidades. La migracion del
// endpoint a delegate-al-helper sucede en Phase 2.2.c.
//
// SCOPE-AWARE:
// - Cliente (modoDios=false): filtra prisma.envio por ctx.empresaId.
//   Retorna shape "cliente" sin porEmpresa.
// - Shipro Torre global (modoDios=true, sin filtroEmpresa): sin filtro
//   de empresa. Retorna shape "shipro" con porEmpresa adicional.
// - Shipro inspeccion (modoDios=true, con filtroEmpresa=N): filtra a esa
//   empresa. Retorna shape "shipro" sin porEmpresa (1-entry o vacio).
//
// Decisiones de producto (director 2026-06-15):
// D1 - Nombre: calcularModalidadesAnalitica (claro vs inferirModalidad
//      del cotizador / crear.ts).
// D2 - porEmpresa solo en shape Shipro.
// D3 - Panel cliente expande modal a paridad con Torre (3 tablas + dist
//      global + split forward/reverse + warning desconocidas).
// D4 - Las 8 canonicas se exponen en modal; Card 11 agrupa a 3 bars
//      cliente-side (no afecta el shape del helper).
// D5 - Filtros funcionales del modal no implementados (visual-only).
// D6 - normalizarModalidad defensiva on-the-fly preservada (post DEUDA 47).
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT_ANALITICA = 90;

export interface DistribucionItem {
  modalidad: string;
  cantidad: number;
  porcentaje: number;
}

export interface SplitForwardReverse {
  forward: { cantidad: number; porcentaje: number };
  reverse: { cantidad: number; porcentaje: number };
}

export interface GrupoCourierModalidades {
  courierId: number;
  courierNombre: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

export interface GrupoProvinciaModalidades {
  provincia: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

export interface GrupoMesModalidades {
  mes: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

export interface GrupoEmpresaModalidades {
  empresaId: number;
  empresaNombre: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

export interface CalidadDatosModalidades {
  ventanaDias: number;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosDesconocida: number;
  catalogoCanonicas: readonly string[];
}

export interface ResultadoModalidadesBase {
  ventanaDias: number;
  cantidadEnviosTotal: number;
  cantidadEnviosValidos: number;
  cantidadEnviosDesconocida: number;
  distribucionGlobal: DistribucionItem[];
  splitForwardReverse: SplitForwardReverse;
  porCourier: GrupoCourierModalidades[];
  porProvincia: GrupoProvinciaModalidades[];
  porMes: GrupoMesModalidades[];
  catalogoCanonicas: readonly string[];
}

export interface ResultadoModalidadesCliente extends ResultadoModalidadesBase {
  scope: "cliente";
}

export interface ResultadoModalidadesShipro extends ResultadoModalidadesBase {
  porEmpresa: GrupoEmpresaModalidades[];
  scope: "shipro";
}

export type ResultadoModalidades = ResultadoModalidadesCliente | ResultadoModalidadesShipro;

function construirDistribucion(modalidades: string[]): DistribucionItem[] {
  const total = modalidades.length;
  if (total === 0) return [];
  const counts = new Map<string, number>();
  for (const m of modalidades) {
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([modalidad, cantidad]) => ({
      modalidad,
      cantidad,
      porcentaje: Math.round((cantidad / total) * 1000) / 10,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

export async function calcularModalidadesAnalitica(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT_ANALITICA
): Promise<ResultadoModalidades> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Build where clause scope-aware.
  const whereClause: any = {
    fechaImpresion: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  const envios = await prisma.envio.findMany({
    where: whereClause,
    select: {
      id: true,
      modalidad: true,
      fechaImpresion: true,
      courierId: true,
      empresaId: true,
      courier: { select: { id: true, nombre: true } },
      destino: { select: { provincia: true } },
      empresa: { select: { id: true, nombre: true } },
    },
  });

  // Normalizar modalidades.
  const enviosNormalizados = envios.map(e => ({
    ...e,
    modalidadNormalizada: normalizarModalidad(e.modalidad),
  }));

  const cantidadEnviosTotal = enviosNormalizados.length;
  const cantidadEnviosDesconocida = enviosNormalizados.filter(
    e => e.modalidadNormalizada === MODALIDAD_DESCONOCIDA
  ).length;
  const cantidadEnviosValidos = cantidadEnviosTotal - cantidadEnviosDesconocida;

  // Empty state shortcut.
  if (cantidadEnviosTotal === 0) {
    const emptyBase: ResultadoModalidadesBase = {
      ventanaDias,
      cantidadEnviosTotal: 0,
      cantidadEnviosValidos: 0,
      cantidadEnviosDesconocida: 0,
      distribucionGlobal: [],
      splitForwardReverse: {
        forward: { cantidad: 0, porcentaje: 0 },
        reverse: { cantidad: 0, porcentaje: 0 },
      },
      porCourier: [],
      porProvincia: [],
      porMes: [],
      catalogoCanonicas: MODALIDADES_CANONICAS,
    };
    if (!ctx.modoDios) {
      return { ...emptyBase, scope: "cliente" };
    }
    return { ...emptyBase, porEmpresa: [], scope: "shipro" };
  }

  // distribucionGlobal.
  const todasLasModalidades = enviosNormalizados.map(e => e.modalidadNormalizada);
  const distribucionGlobal = construirDistribucion(todasLasModalidades);

  // splitForwardReverse.
  let forwardCount = 0;
  let reverseCount = 0;
  for (const m of todasLasModalidades) {
    if (m === MODALIDAD_DESCONOCIDA) continue;
    if (esModalidadForward(m as ModalidadCanonica)) forwardCount++;
    else if (esModalidadReverse(m as ModalidadCanonica)) reverseCount++;
  }
  const totalParaSplit = forwardCount + reverseCount;
  const splitForwardReverse: SplitForwardReverse = {
    forward: {
      cantidad: forwardCount,
      porcentaje: totalParaSplit > 0
        ? Math.round((forwardCount / totalParaSplit) * 1000) / 10
        : 0,
    },
    reverse: {
      cantidad: reverseCount,
      porcentaje: totalParaSplit > 0
        ? Math.round((reverseCount / totalParaSplit) * 1000) / 10
        : 0,
    },
  };

  // Accumulators.
  type CourierAccum = { courierId: number; courierNombre: string; modalidades: string[] };
  const courierMap = new Map<number, CourierAccum>();

  type ProvinciaAccum = { provincia: string; modalidades: string[] };
  const provinciaMap = new Map<string, ProvinciaAccum>();

  type MesAccum = { mes: string; modalidades: string[] };
  const mesMap = new Map<string, MesAccum>();

  type EmpresaAccum = { empresaId: number; empresaNombre: string; modalidades: string[] };
  const empresaMap = new Map<number, EmpresaAccum>();

  for (const e of enviosNormalizados) {
    // porCourier.
    if (e.courier && e.courierId !== null) {
      if (!courierMap.has(e.courierId)) {
        courierMap.set(e.courierId, {
          courierId: e.courierId,
          courierNombre: e.courier.nombre,
          modalidades: [],
        });
      }
      courierMap.get(e.courierId)!.modalidades.push(e.modalidadNormalizada);
    }

    // porProvincia.
    const provKey = e.destino?.provincia?.trim().toLowerCase();
    if (provKey) {
      if (!provinciaMap.has(provKey)) {
        provinciaMap.set(provKey, { provincia: provKey, modalidades: [] });
      }
      provinciaMap.get(provKey)!.modalidades.push(e.modalidadNormalizada);
    }

    // porMes.
    if (e.fechaImpresion) {
      const mesKey = `${e.fechaImpresion.getFullYear()}-${String(e.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;
      if (!mesMap.has(mesKey)) {
        mesMap.set(mesKey, { mes: mesKey, modalidades: [] });
      }
      mesMap.get(mesKey)!.modalidades.push(e.modalidadNormalizada);
    }

    // porEmpresa (solo modoDios global).
    if (ctx.modoDios && ctx.empresaId === null && e.empresa) {
      const eid = e.empresa.id;
      if (!empresaMap.has(eid)) {
        empresaMap.set(eid, {
          empresaId: eid,
          empresaNombre: e.empresa.nombre,
          modalidades: [],
        });
      }
      empresaMap.get(eid)!.modalidades.push(e.modalidadNormalizada);
    }
  }

  const porCourier: GrupoCourierModalidades[] = Array.from(courierMap.values())
    .map(c => ({
      courierId: c.courierId,
      courierNombre: c.courierNombre,
      cantidad: c.modalidades.length,
      distribucion: construirDistribucion(c.modalidades),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const porProvincia: GrupoProvinciaModalidades[] = Array.from(provinciaMap.values())
    .map(p => ({
      provincia: p.provincia,
      cantidad: p.modalidades.length,
      distribucion: construirDistribucion(p.modalidades),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const porMes: GrupoMesModalidades[] = Array.from(mesMap.values())
    .map(m => ({
      mes: m.mes,
      cantidad: m.modalidades.length,
      distribucion: construirDistribucion(m.modalidades),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const baseShape: ResultadoModalidadesBase = {
    ventanaDias,
    cantidadEnviosTotal,
    cantidadEnviosValidos,
    cantidadEnviosDesconocida,
    distribucionGlobal,
    splitForwardReverse,
    porCourier,
    porProvincia,
    porMes,
    catalogoCanonicas: MODALIDADES_CANONICAS,
  };

  if (!ctx.modoDios) {
    return { ...baseShape, scope: "cliente" };
  }

  const porEmpresa: GrupoEmpresaModalidades[] = Array.from(empresaMap.values())
    .map(e => ({
      empresaId: e.empresaId,
      empresaNombre: e.empresaNombre,
      cantidad: e.modalidades.length,
      distribucion: construirDistribucion(e.modalidades),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return { ...baseShape, porEmpresa, scope: "shipro" };
}
