// ============================================================================
// TORRE DE CONTROL — METRICA 3.1 "Auditoria de Direcciones"
//
// Audita la calidad de las direcciones destino de envios recientes.
// Detecta problemas de completitud + consistencia con el nomenclador
// (CodigoPostal + Localidad + Provincia tables).
//
// Decisiones (director 2026-06-10):
// - Universo: direcciones destino de envios en ventana 90 dias.
// - Auditoria: helper lib/utils/auditoria-direcciones.ts con 8 tipos
//   de problemas + sistema de score (100 base, -20 ALTA, -10 MEDIA).
// - Cortes: por categoria + topProblemas + porEmpresa + porMes +
//   topDireccionesProblematicas (top 20).
// - Nomenclador: cargado una vez por request (sin cache global).
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  auditarDireccion,
  resumirAuditorias,
  type ContextoNomenclador,
  type AuditoriaDireccion,
} from "@/lib/utils/auditoria-direcciones";

const VENTANA_DIAS = 90;

export async function GET(request: Request) {
  try {
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.modoDios) {
      return NextResponse.json({ error: "Acceso solo para roles Shipro." }, { status: 403 });
    }

    const ventanaInicio = new Date();
    ventanaInicio.setDate(ventanaInicio.getDate() - VENTANA_DIAS);

    // ============================================================
    // 1. Cargar nomenclador completo (CodigoPostal + Localidad + Provincia).
    // ============================================================
    const codigosPostales = await prisma.codigoPostal.findMany({
      include: {
        localidades: {
          include: {
            provincia: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    const contextoNomenclador: ContextoNomenclador = {
      cpToLocalidades: new Map(),
      cpToProvincias: new Map(),
    };

    for (const cp of codigosPostales) {
      const codigo = cp.codigo;
      const localidadesSet = new Set<string>();
      const provinciasSet = new Set<string>();

      for (const loc of cp.localidades) {
        localidadesSet.add(loc.nombre);
        provinciasSet.add(loc.provincia.nombre);
      }

      contextoNomenclador.cpToLocalidades.set(codigo, localidadesSet);
      contextoNomenclador.cpToProvincias.set(codigo, provinciasSet);
    }

    // ============================================================
    // 2. Fetch envios en ventana con direccion destino + empresa.
    // ============================================================
    const envios = await prisma.envio.findMany({
      where: {
        fechaImpresion: { gte: ventanaInicio },
      },
      include: {
        destino: {
          select: {
            id: true,
            cp: true,
            calle: true,
            altura: true,
            localidad: true,
            provincia: true,
          },
        },
        empresa: { select: { id: true, nombre: true } },
      },
    });

    // ============================================================
    // 3. Auditar cada direccion (deduplicando por direccionId).
    // ============================================================
    const auditoriasPorDireccion = new Map<number, AuditoriaDireccion>();
    const direccionAEmpresas = new Map<number, Set<string>>(); // direccionId -> set de empresas
    const direccionAMeses = new Map<number, Set<string>>(); // direccionId -> set de meses
    const direccionAEnvioIds = new Map<number, number[]>(); // direccionId -> envios

    for (const envio of envios) {
      if (!envio.destino) continue;

      const dirId = envio.destino.id;

      // Auditar solo una vez por direccion (puede repetirse en multiples envios).
      if (!auditoriasPorDireccion.has(dirId)) {
        const auditoria = auditarDireccion(envio.destino, contextoNomenclador);
        auditoriasPorDireccion.set(dirId, auditoria);
      }

      // Tracking de empresas que usaron esta direccion.
      if (!direccionAEmpresas.has(dirId)) {
        direccionAEmpresas.set(dirId, new Set());
      }
      direccionAEmpresas.get(dirId)!.add(envio.empresa.nombre);

      // Tracking de meses en los que se usaron.
      const mesKey = `${envio.fechaImpresion.getFullYear()}-${String(envio.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;
      if (!direccionAMeses.has(dirId)) {
        direccionAMeses.set(dirId, new Set());
      }
      direccionAMeses.get(dirId)!.add(mesKey);

      // Tracking de envios.
      if (!direccionAEnvioIds.has(dirId)) {
        direccionAEnvioIds.set(dirId, []);
      }
      direccionAEnvioIds.get(dirId)!.push(envio.id);
    }

    const auditorias = Array.from(auditoriasPorDireccion.values());

    // ============================================================
    // 4. Resumen agregado.
    // ============================================================
    const resumen = resumirAuditorias(auditorias);

    // ============================================================
    // 5. Top direcciones problematicas (top 20 con peor score).
    // ============================================================
    const direccionesProblematicas = auditorias
      .filter(a => a.problemas.length > 0)
      .sort((a, b) => a.score - b.score) // peor score primero
      .slice(0, 20);

    // Enriquecer con detalle de la direccion.
    const direccionesDetallesMap = new Map<number, any>();
    for (const envio of envios) {
      if (envio.destino && !direccionesDetallesMap.has(envio.destino.id)) {
        direccionesDetallesMap.set(envio.destino.id, envio.destino);
      }
    }

    const topDireccionesProblematicas = direccionesProblematicas.map(a => {
      const detalle = direccionesDetallesMap.get(a.direccionId);
      const empresas = Array.from(direccionAEmpresas.get(a.direccionId) || []);
      const envioIds = direccionAEnvioIds.get(a.direccionId) || [];
      return {
        ...a,
        detalle: {
          cp: detalle?.cp || "",
          calle: detalle?.calle || null,
          altura: detalle?.altura || null,
          localidad: detalle?.localidad || null,
          provincia: detalle?.provincia || null,
        },
        empresasAfectadas: empresas,
        cantidadEnvios: envioIds.length,
      };
    });

    // ============================================================
    // 6. Por empresa.
    // ============================================================
    type GrupoEmpresa = {
      empresaId: number;
      nombre: string;
      direccionesTotal: number;
      direccionesConProblemas: number;
      scorePromedio: number;
    };

    const empresasMap = new Map<number, {
      empresaId: number;
      nombre: string;
      direcciones: Set<number>;
      sumaScore: number;
      conProblemas: Set<number>;
    }>();

    for (const envio of envios) {
      if (!envio.destino) continue;
      const empId = envio.empresa.id;

      if (!empresasMap.has(empId)) {
        empresasMap.set(empId, {
          empresaId: empId,
          nombre: envio.empresa.nombre,
          direcciones: new Set(),
          sumaScore: 0,
          conProblemas: new Set(),
        });
      }

      const grupo = empresasMap.get(empId)!;
      if (!grupo.direcciones.has(envio.destino.id)) {
        grupo.direcciones.add(envio.destino.id);
        const auditoria = auditoriasPorDireccion.get(envio.destino.id);
        if (auditoria) {
          grupo.sumaScore += auditoria.score;
          if (auditoria.problemas.length > 0) {
            grupo.conProblemas.add(envio.destino.id);
          }
        }
      }
    }

    const porEmpresa: GrupoEmpresa[] = Array.from(empresasMap.values())
      .map(g => ({
        empresaId: g.empresaId,
        nombre: g.nombre,
        direccionesTotal: g.direcciones.size,
        direccionesConProblemas: g.conProblemas.size,
        scorePromedio: g.direcciones.size > 0
          ? Math.round((g.sumaScore / g.direcciones.size) * 10) / 10
          : 0,
      }))
      .sort((a, b) => a.scorePromedio - b.scorePromedio); // peor primero

    // ============================================================
    // 7. Por mes.
    // ============================================================
    type GrupoMes = {
      mes: string;
      direccionesTotal: number;
      direccionesConProblemas: number;
      tasaAuditoria: number;
    };

    const mesesMap = new Map<string, {
      direcciones: Set<number>;
      conProblemas: Set<number>;
    }>();

    for (const envio of envios) {
      if (!envio.destino) continue;
      const mesKey = `${envio.fechaImpresion.getFullYear()}-${String(envio.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;

      if (!mesesMap.has(mesKey)) {
        mesesMap.set(mesKey, { direcciones: new Set(), conProblemas: new Set() });
      }

      const grupo = mesesMap.get(mesKey)!;
      if (!grupo.direcciones.has(envio.destino.id)) {
        grupo.direcciones.add(envio.destino.id);
        const auditoria = auditoriasPorDireccion.get(envio.destino.id);
        if (auditoria && auditoria.problemas.length > 0) {
          grupo.conProblemas.add(envio.destino.id);
        }
      }
    }

    const porMes: GrupoMes[] = Array.from(mesesMap.entries())
      .map(([mes, g]) => ({
        mes,
        direccionesTotal: g.direcciones.size,
        direccionesConProblemas: g.conProblemas.size,
        tasaAuditoria: g.direcciones.size > 0
          ? Math.round((g.conProblemas.size / g.direcciones.size) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return NextResponse.json({
      resumen,
      topDireccionesProblematicas,
      porEmpresa,
      porMes,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        nomencladorCargado: codigosPostales.length > 0,
        codigosPostalesEnNomenclador: codigosPostales.length,
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en auditoria-direcciones:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Auditoria de Direcciones" },
      { status: 500 }
    );
  }
}
