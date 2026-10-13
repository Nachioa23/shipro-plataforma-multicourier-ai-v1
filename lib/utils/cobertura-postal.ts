// ============================================================================
// HELPER — Cobertura Postal Activa (Métrica 4.3 Torre de Control)
//
// Mide la "cobertura vacía": cotizaciones donde el motor devolvió CERO
// couriers (ni domicilio ni sucursal) para el CP destino + peso + dims
// pedido. El writer lo hace lib/cotizador.ts (desde Fase J) sobre
// RegistroCoberturaVacia. Este helper es solo READ.
//
// SCOPE-AWARE (mismo patrón que lib/utils/fuga-ruteo.ts):
//
// - Cliente (modoDios=false): filtra por ctx.empresaId, omite cortes
//   por empresa, retorna shape "cliente".
// - Shipro (modoDios=true) sin filtroEmpresa: scope global, retorna
//   shape "shipro" con corte por empresa.
// - Shipro (modoDios=true) con filtroEmpresa: scope empresa específica,
//   retorna shape "shipro" sin corte por empresa (vista de inspección).
//
// DENOMINADOR HONESTO (decisión 2026-10-13):
// La tasa de cobertura vacía = vacías / total cotizaciones. El total
// cotizaciones vive en CotizacionSnapshot, pero su writer actual es solo
// el rates callback de Tiendanube (/api/tiendanube/rates). El tráfico
// del dashboard + WooCommerce + API terceros NO escribe snapshot (ver
// DEUDA 111 PARCIAL). Por lo tanto el denominador es sub-contado si se
// usa CotizacionSnapshot: subestimaríamos ampliamente el total, inflando
// la tasa de vacíos. Decisión: marcar la tasa como "N/D" cuando el
// denominador es claramente parcial (snapshot < 1.5x numerador) y
// reportar numerador + total snapshot aparte para que el usuario infiera.
// Cuando DEUDA 111 cierre (writer dual en /api/cotizar), la tasa se
// vuelve confiable sin cambiar este helper.
//
// Estado vacío = buena noticia: pre-cliente real este modelo puede
// tener poca data, es lo normal. Mensaje al usuario explicita que es OK.
// ============================================================================

import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";

const VENTANA_DIAS_DEFAULT = 90;

export interface ResumenCoberturaPostal {
  totalRegistrosVacios: number;
  totalCotizacionesSnapshot: number; // denominador parcial (ver nota del helper)
  tasaCoberturaVaciaPct: number | null; // null si denominador no confiable
  denominadorConfiable: boolean;
  cpsDistintos: number;
  provinciasAfectadas: number;
}

export interface TopCp {
  cpDestino: string;
  cantidad: number;
  localidad: string | null;
  provincia: string | null;
  pesoPromedioKg: number;
}

export interface PorProvincia {
  provincia: string;
  cantidad: number;
  cpsDistintos: number;
}

export interface PorPeso {
  rango: string; // "0-1 kg", "1-5 kg", "5-15 kg", ">15 kg"
  cantidad: number;
}

export interface PorMes {
  mes: string; // YYYY-MM
  cantidad: number;
}

export interface PorEmpresa {
  empresaId: number;
  empresaNombre: string;
  cantidad: number;
}

export interface CalidadDatosCobertura {
  ventanaDias: number;
  totalRegistrosVentana: number;
  totalCotizacionesSnapshotVentana: number;
  fuente: string;
  notas: string[];
}

export interface ResultadoCoberturaPostalCliente {
  resumen: ResumenCoberturaPostal;
  topCps: TopCp[];
  porProvincia: PorProvincia[];
  porPeso: PorPeso[];
  tendencia: PorMes[];
  calidadDatos: CalidadDatosCobertura;
  scope: "cliente";
}

export interface ResultadoCoberturaPostalShipro {
  resumen: ResumenCoberturaPostal;
  topCps: TopCp[];
  porProvincia: PorProvincia[];
  porPeso: PorPeso[];
  tendencia: PorMes[];
  porEmpresa: PorEmpresa[];
  calidadDatos: CalidadDatosCobertura;
  scope: "shipro";
}

export type ResultadoCoberturaPostal =
  | ResultadoCoberturaPostalCliente
  | ResultadoCoberturaPostalShipro;

function rangoPeso(pesoKg: number): string {
  if (pesoKg <= 1) return "0-1 kg";
  if (pesoKg <= 5) return "1-5 kg";
  if (pesoKg <= 15) return "5-15 kg";
  return ">15 kg";
}

export async function calcularCoberturaPostal(
  ctx: AuthContext,
  ventanaDias: number = VENTANA_DIAS_DEFAULT
): Promise<ResultadoCoberturaPostal> {
  const ventanaInicio = new Date();
  ventanaInicio.setDate(ventanaInicio.getDate() - ventanaDias);

  // Where con scope automático (mismo patrón que fuga-ruteo).
  const whereClause: {
    fecha: { gte: Date };
    empresaId?: number;
  } = {
    fecha: { gte: ventanaInicio },
  };

  if (!ctx.modoDios) {
    whereClause.empresaId = ctx.empresaId as number;
  } else if (ctx.empresaId !== null) {
    whereClause.empresaId = ctx.empresaId;
  }

  const registros = await prisma.registroCoberturaVacia.findMany({
    where: whereClause,
    include: {
      empresa: { select: { id: true, nombre: true } },
    },
  });

  // Denominador honesto: CotizacionSnapshot en la misma ventana.
  // Nota: `CotizacionSnapshot.createdAt` es el timestamp del snapshot;
  // scope por empresaId cuando aplica. Hoy solo rates callback de
  // Tiendanube escribe snapshots — por eso es subconteo (DEUDA 111).
  const whereSnapshot: { createdAt: { gte: Date }; empresaId?: number } = {
    createdAt: { gte: ventanaInicio },
  };
  if (!ctx.modoDios) {
    whereSnapshot.empresaId = ctx.empresaId as number;
  } else if (ctx.empresaId !== null) {
    whereSnapshot.empresaId = ctx.empresaId;
  }
  const totalSnapshot = await prisma.cotizacionSnapshot.count({ where: whereSnapshot });

  // Enriquecimiento geográfico: resolver CPs únicos contra el catálogo.
  // CodigoPostal.localidades es many-to-many; tomamos la primera localidad
  // (típicamente 1-2 por CP) + su provincia.
  const cpsUnicos = Array.from(new Set(registros.map((r) => r.cpDestino))).filter(
    (cp) => !!cp
  );
  const catalogoCps =
    cpsUnicos.length > 0
      ? await prisma.codigoPostal.findMany({
          where: { codigo: { in: cpsUnicos } },
          include: {
            localidades: {
              take: 1,
              include: { provincia: { select: { nombre: true } } },
            },
          },
        })
      : [];
  const cpInfo = new Map<string, { localidad: string | null; provincia: string | null }>();
  for (const row of catalogoCps) {
    const loc = row.localidades[0];
    cpInfo.set(row.codigo, {
      localidad: loc?.nombre ?? null,
      provincia: loc?.provincia?.nombre ?? null,
    });
  }

  // Agregaciones.
  const porCp: Record<
    string,
    { cantidad: number; pesoAcum: number }
  > = {};
  const porProv: Record<string, { cantidad: number; cps: Set<string> }> = {};
  const porPesoMap: Record<string, number> = {
    "0-1 kg": 0,
    "1-5 kg": 0,
    "5-15 kg": 0,
    ">15 kg": 0,
  };
  const porMesMap: Record<string, number> = {};
  const porEmpresaMap: Record<number, { nombre: string; cantidad: number }> = {};

  for (const r of registros) {
    // Por CP.
    if (!porCp[r.cpDestino]) porCp[r.cpDestino] = { cantidad: 0, pesoAcum: 0 };
    porCp[r.cpDestino].cantidad++;
    porCp[r.cpDestino].pesoAcum += r.pesoKg || 0;

    // Por provincia (desde enriquecimiento).
    const prov = cpInfo.get(r.cpDestino)?.provincia ?? "Sin catalogar";
    if (!porProv[prov]) porProv[prov] = { cantidad: 0, cps: new Set() };
    porProv[prov].cantidad++;
    porProv[prov].cps.add(r.cpDestino);

    // Por peso.
    porPesoMap[rangoPeso(r.pesoKg || 0)]++;

    // Por mes (YYYY-MM).
    const mes = r.fecha.toISOString().substring(0, 7);
    porMesMap[mes] = (porMesMap[mes] || 0) + 1;

    // Por empresa (solo modoDios sin filtro).
    if (ctx.modoDios && ctx.empresaId === null && r.empresa) {
      if (!porEmpresaMap[r.empresa.id]) {
        porEmpresaMap[r.empresa.id] = {
          nombre: r.empresa.nombre,
          cantidad: 0,
        };
      }
      porEmpresaMap[r.empresa.id].cantidad++;
    }
  }

  const totalRegistros = registros.length;
  const cpsDistintos = Object.keys(porCp).length;
  const provinciasAfectadas = Object.keys(porProv).filter(
    (p) => p !== "Sin catalogar"
  ).length;

  // Denominador honesto: confiable solo si el total snapshot excede ampliamente
  // el numerador. Umbral conservador: snapshot debe ser ≥ 1.5x los registros
  // vacíos para que la tasa tenga sentido (si no, el denominador es claramente
  // parcial — hoy casi siempre por DEUDA 111).
  const denominadorConfiable =
    totalSnapshot >= Math.max(totalRegistros * 1.5, 1);
  const tasaCoberturaVaciaPct =
    denominadorConfiable && totalSnapshot > 0
      ? Math.round((totalRegistros / totalSnapshot) * 1000) / 10
      : null;

  const resumen: ResumenCoberturaPostal = {
    totalRegistrosVacios: totalRegistros,
    totalCotizacionesSnapshot: totalSnapshot,
    tasaCoberturaVaciaPct,
    denominadorConfiable,
    cpsDistintos,
    provinciasAfectadas,
  };

  const topCps: TopCp[] = Object.entries(porCp)
    .map(([cp, v]) => {
      const info = cpInfo.get(cp);
      return {
        cpDestino: cp,
        cantidad: v.cantidad,
        localidad: info?.localidad ?? null,
        provincia: info?.provincia ?? null,
        pesoPromedioKg: Math.round((v.pesoAcum / v.cantidad) * 10) / 10,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 20);

  const porProvincia: PorProvincia[] = Object.entries(porProv)
    .map(([provincia, v]) => ({
      provincia,
      cantidad: v.cantidad,
      cpsDistintos: v.cps.size,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const porPeso: PorPeso[] = Object.entries(porPesoMap).map(([rango, cantidad]) => ({
    rango,
    cantidad,
  }));

  const tendencia: PorMes[] = Object.entries(porMesMap)
    .map(([mes, cantidad]) => ({ mes, cantidad }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const notas: string[] = [];
  if (!denominadorConfiable) {
    notas.push(
      "Tasa N/D: el denominador (CotizacionSnapshot) hoy solo persiste desde el rates callback de Tiendanube (DEUDA 111 PARCIAL). Se reporta numerador y total snapshot por separado hasta que el writer dual se cablee."
    );
  }
  if (totalRegistros === 0) {
    notas.push(
      "Sin CPs sin cobertura detectados en la ventana — buena noticia pre-cliente, se poblará desde el día 1 con tráfico real."
    );
  }

  const calidadDatos: CalidadDatosCobertura = {
    ventanaDias,
    totalRegistrosVentana: totalRegistros,
    totalCotizacionesSnapshotVentana: totalSnapshot,
    fuente:
      "RegistroCoberturaVacia (writer en lib/cotizador.ts desde Fase J) + CotizacionSnapshot (denominador parcial via rates callback Tiendanube)",
    notas,
  };

  if (!ctx.modoDios) {
    return {
      resumen,
      topCps,
      porProvincia,
      porPeso,
      tendencia,
      calidadDatos,
      scope: "cliente",
    };
  }

  const porEmpresa: PorEmpresa[] = Object.entries(porEmpresaMap)
    .map(([id, v]) => ({
      empresaId: parseInt(id),
      empresaNombre: v.nombre,
      cantidad: v.cantidad,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    resumen,
    topCps,
    porProvincia,
    porPeso,
    tendencia,
    porEmpresa,
    calidadDatos,
    scope: "shipro",
  };
}
