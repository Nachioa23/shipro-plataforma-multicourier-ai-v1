import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  normalizarModalidad,
  esModalidadForward,
  esModalidadReverse,
  MODALIDADES_CANONICAS,
  type ModalidadCanonica,
  type ModalidadCanonicaOrDesconocida,
} from "@/lib/utils/modalidades";

// Ventana temporal por defecto en dias. Coherente con otras metricas
// de Torre de Control (1.1, 2.1, 2.3).
const VENTANA_DIAS_DEFAULT = 90;

interface DistribucionItem {
  modalidad: ModalidadCanonicaOrDesconocida;
  cantidad: number;
  porcentaje: number;
}

interface PorCourierItem {
  courierId: number;
  courierNombre: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

interface PorProvinciaItem {
  provincia: string;
  cantidad: number;
  distribucion: DistribucionItem[];
}

interface PorMesItem {
  mes: string; // formato YYYY-MM
  cantidad: number;
  distribucion: DistribucionItem[];
}

/**
 * Construye la distribucion de modalidades sobre un array de envios.
 * Cada envio tiene su Envio.modalidad normalizada al catalogo canonico.
 */
function construirDistribucion(
  modalidades: ModalidadCanonicaOrDesconocida[]
): DistribucionItem[] {
  const total = modalidades.length;
  if (total === 0) return [];

  const counts = new Map<ModalidadCanonicaOrDesconocida, number>();
  for (const m of modalidades) {
    counts.set(m, (counts.get(m) || 0) + 1);
  }

  const items: DistribucionItem[] = [];
  for (const [modalidad, cantidad] of counts.entries()) {
    items.push({
      modalidad,
      cantidad,
      porcentaje: Math.round((cantidad / total) * 1000) / 10, // 1 decimal
    });
  }

  // Ordenar de mayor a menor por cantidad.
  items.sort((a, b) => b.cantidad - a.cantidad);
  return items;
}

/**
 * GET /api/torre-de-control/modalidades
 *
 * Devuelve la distribucion de modalidades canonicas con cortes por courier,
 * provincia destino y mes. Solo accesible para usuarios Shipro (modoDios).
 *
 * Query params (opcionales):
 *   - ventanaDias: numero de dias hacia atras (default 90)
 */
export async function GET(request: Request) {
  const ctx = resolverContext(request);
  if (ctx instanceof NextResponse) return ctx;

  // Solo Shipro puede consultar Torre de Control.
  if (!ctx.modoDios) {
    return NextResponse.json(
      { error: "No autorizado: Torre de Control es exclusivo de Shipro." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const ventanaDias = parseInt(url.searchParams.get("ventanaDias") || String(VENTANA_DIAS_DEFAULT), 10);

  const ventanaInicio = new Date(Date.now() - ventanaDias * 24 * 60 * 60 * 1000);

  // Fetch envios in window with relations needed (courier + destino).
  // El campo Envio.modalidad ya tiene valores canonicos para envios nuevos
  // (a partir del fix de DEUDA 47). Para envios legacy, normalizamos en el
  // codigo del endpoint.
  const envios = await prisma.envio.findMany({
    where: {
      fechaImpresion: { gte: ventanaInicio },
    },
    select: {
      id: true,
      modalidad: true,
      fechaImpresion: true,
      courierId: true,
      courier: { select: { nombre: true } },
      destino: { select: { provincia: true } },
    },
  });

  // Normalizar la modalidad de cada envio al catalogo canonico.
  // Esto cubre envios legacy con valores como "Estandar" o "Devolucion Inversa".
  const enviosNormalizados = envios.map(e => ({
    ...e,
    modalidadNormalizada: normalizarModalidad(e.modalidad),
  }));

  // Cantidad total y desconocidas.
  const cantidadEnviosTotal = enviosNormalizados.length;
  const cantidadEnviosDesconocida = enviosNormalizados.filter(
    e => e.modalidadNormalizada === "Desconocida"
  ).length;
  const cantidadEnviosValidos = cantidadEnviosTotal - cantidadEnviosDesconocida;

  if (cantidadEnviosTotal === 0) {
    return NextResponse.json({
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
    });
  }

  // ============================================================
  // 1. DISTRIBUCION GLOBAL
  // ============================================================
  const todasLasModalidades = enviosNormalizados.map(e => e.modalidadNormalizada);
  const distribucionGlobal = construirDistribucion(todasLasModalidades);

  // ============================================================
  // 2. SPLIT FORWARD / REVERSE
  // ============================================================
  let cantidadForward = 0;
  let cantidadReverse = 0;
  for (const m of todasLasModalidades) {
    if (m !== "Desconocida") {
      if (esModalidadForward(m as ModalidadCanonica)) cantidadForward++;
      else if (esModalidadReverse(m as ModalidadCanonica)) cantidadReverse++;
    }
  }
  const totalParaSplit = cantidadForward + cantidadReverse;
  const splitForwardReverse = {
    forward: {
      cantidad: cantidadForward,
      porcentaje: totalParaSplit > 0 ? Math.round((cantidadForward / totalParaSplit) * 1000) / 10 : 0,
    },
    reverse: {
      cantidad: cantidadReverse,
      porcentaje: totalParaSplit > 0 ? Math.round((cantidadReverse / totalParaSplit) * 1000) / 10 : 0,
    },
  };

  // ============================================================
  // 3. POR COURIER
  // ============================================================
  const porCourierMap = new Map<number, {
    courierId: number;
    courierNombre: string;
    modalidades: ModalidadCanonicaOrDesconocida[];
  }>();

  for (const e of enviosNormalizados) {
    const key = e.courierId;
    if (!porCourierMap.has(key)) {
      porCourierMap.set(key, {
        courierId: key,
        courierNombre: e.courier?.nombre || "Desconocido",
        modalidades: [],
      });
    }
    porCourierMap.get(key)!.modalidades.push(e.modalidadNormalizada);
  }

  const porCourier: PorCourierItem[] = [];
  for (const grupo of porCourierMap.values()) {
    porCourier.push({
      courierId: grupo.courierId,
      courierNombre: grupo.courierNombre,
      cantidad: grupo.modalidades.length,
      distribucion: construirDistribucion(grupo.modalidades),
    });
  }
  porCourier.sort((a, b) => b.cantidad - a.cantidad);

  // ============================================================
  // 4. POR PROVINCIA
  // ============================================================
  const porProvinciaMap = new Map<string, ModalidadCanonicaOrDesconocida[]>();

  for (const e of enviosNormalizados) {
    const prov = (e.destino?.provincia || "").trim().toLowerCase();
    if (!prov) continue;
    if (!porProvinciaMap.has(prov)) {
      porProvinciaMap.set(prov, []);
    }
    porProvinciaMap.get(prov)!.push(e.modalidadNormalizada);
  }

  const porProvincia: PorProvinciaItem[] = [];
  for (const [prov, modalidades] of porProvinciaMap.entries()) {
    porProvincia.push({
      provincia: prov,
      cantidad: modalidades.length,
      distribucion: construirDistribucion(modalidades),
    });
  }
  porProvincia.sort((a, b) => b.cantidad - a.cantidad);

  // ============================================================
  // 5. POR MES
  // ============================================================
  // Construir un map de "YYYY-MM" -> modalidades en ese mes.
  const porMesMap = new Map<string, ModalidadCanonicaOrDesconocida[]>();

  for (const e of enviosNormalizados) {
    if (!e.fechaImpresion) continue;
    const fecha = new Date(e.fechaImpresion);
    const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
    if (!porMesMap.has(mesKey)) {
      porMesMap.set(mesKey, []);
    }
    porMesMap.get(mesKey)!.push(e.modalidadNormalizada);
  }

  const porMes: PorMesItem[] = [];
  for (const [mes, modalidades] of porMesMap.entries()) {
    porMes.push({
      mes,
      cantidad: modalidades.length,
      distribucion: construirDistribucion(modalidades),
    });
  }
  // Ordenar cronologicamente ascendente.
  porMes.sort((a, b) => a.mes.localeCompare(b.mes));

  // ============================================================
  // RESPONSE
  // ============================================================
  return NextResponse.json({
    ventanaDias,
    cantidadEnviosTotal,
    cantidadEnviosValidos,
    cantidadEnviosDesconocida,
    distribucionGlobal,
    splitForwardReverse,
    porCourier,
    porProvincia,
    porMes,
    // Metadata util para debugging y observabilidad.
    catalogo: MODALIDADES_CANONICAS,
  });
}
