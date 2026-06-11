// ============================================================================
// TORRE DE CONTROL — METRICA 3.4 "Desvio Financiero por Peso Volumetrico"
//
// Mide el dinero perdido por desvio entre peso declarado al cotizar y peso
// real medido por el courier en su liquidacion mensual. Hace visible la
// calidad de los datos de paquete que cada empresa cliente carga al imprimir.
//
// Decisiones (director 2026-06-11):
// - Helper centralizado lib/utils/desvio-peso.ts hace el calculo individual.
// - Universo: envios en ventana 90 dias con FinanzasEnvio.pesoAforado > 0.
// - Fuga monetaria = precioFactura - precioMostrado (heredado legacy).
// - Severidad: leve <=1kg / moderado 1-3kg / grave >3kg.
// - Tasa expuesta en 2 formas: sobre total envios y sobre envios con aforo.
//
// NIVEL 1 (V1): solo data de FinanzasEnvio (post-conciliacion Excel courier).
// NIVEL 2 (DEUDA 57 potencial): persistir dimensiones del paquete para
//   recomputar pesoVolumetrico y detectar abusos del courier.
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  auditarDesvio,
  resumirAuditorias,
  type AuditoriaDesvio,
} from "@/lib/utils/desvio-peso";

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

    // Fetch envios + finanzas + courier + empresa.
    const envios = await prisma.envio.findMany({
      where: {
        fechaImpresion: { gte: ventanaInicio },
      },
      include: {
        finanzas: true,
        courier: { select: { id: true, nombre: true } },
        empresa: { select: { id: true, nombre: true } },
      },
    });

    const totalEnvios = envios.length;

    // Auditar cada envio + mantener referencia.
    type EnvioAuditado = {
      envio: typeof envios[number];
      auditoria: AuditoriaDesvio;
    };
    const auditados: EnvioAuditado[] = envios
      .filter(e => e.finanzas != null)
      .map(e => ({
        envio: e,
        auditoria: auditarDesvio({
          pesoCobrado: e.finanzas!.pesoCobrado,
          pesoAforado: e.finanzas!.pesoAforado,
          precioMostrado: e.finanzas!.precioMostrado,
          precioFactura: e.finanzas!.precioFactura,
        }),
      }));

    const auditorias = auditados.map(a => a.auditoria);

    // Resumen agregado via helper.
    const resumen = resumirAuditorias(auditorias, totalEnvios);

    // ============================================================
    // 1. Por courier (rigurosidad: % envios con desvio).
    // ============================================================
    type GrupoCourier = {
      courierId: number;
      nombre: string;
      enviosTotal: number;
      enviosConAforo: number;
      enviosConDesvio: number;
      porcentajeDesvio: number;
      fugaTotal: number;
      desvioPromedioKg: number;
    };

    const porCourierMap = new Map<number, {
      courierId: number;
      nombre: string;
      enviosTotal: number;
      enviosConAforo: number;
      enviosConDesvio: number;
      sumaFuga: number;
      sumaDesvioKg: number;
    }>();

    for (const a of auditados) {
      const cId = a.envio.courier.id;
      if (!porCourierMap.has(cId)) {
        porCourierMap.set(cId, {
          courierId: cId,
          nombre: a.envio.courier.nombre,
          enviosTotal: 0,
          enviosConAforo: 0,
          enviosConDesvio: 0,
          sumaFuga: 0,
          sumaDesvioKg: 0,
        });
      }
      const g = porCourierMap.get(cId)!;
      g.enviosTotal++;
      if (a.auditoria.tieneAforo) g.enviosConAforo++;
      if (a.auditoria.tieneDesvio) {
        g.enviosConDesvio++;
        g.sumaFuga += a.auditoria.fugaPesos;
        g.sumaDesvioKg += a.auditoria.diffKg;
      }
    }

    const porCourier: GrupoCourier[] = Array.from(porCourierMap.values())
      .map(g => ({
        courierId: g.courierId,
        nombre: g.nombre,
        enviosTotal: g.enviosTotal,
        enviosConAforo: g.enviosConAforo,
        enviosConDesvio: g.enviosConDesvio,
        porcentajeDesvio: g.enviosConAforo > 0
          ? Math.round((g.enviosConDesvio / g.enviosConAforo) * 1000) / 10
          : 0,
        fugaTotal: Math.round(g.sumaFuga * 100) / 100,
        desvioPromedioKg: g.enviosConDesvio > 0
          ? Math.round((g.sumaDesvioKg / g.enviosConDesvio) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.porcentajeDesvio - a.porcentajeDesvio);

    // ============================================================
    // 2. Por empresa.
    // ============================================================
    type GrupoEmpresa = {
      empresaId: number;
      nombre: string;
      enviosTotal: number;
      enviosConDesvio: number;
      fugaTotal: number;
      desvioPromedioKg: number;
    };

    const porEmpresaMap = new Map<number, {
      empresaId: number;
      nombre: string;
      enviosTotal: number;
      enviosConDesvio: number;
      sumaFuga: number;
      sumaDesvioKg: number;
    }>();

    for (const a of auditados) {
      const eId = a.envio.empresa.id;
      if (!porEmpresaMap.has(eId)) {
        porEmpresaMap.set(eId, {
          empresaId: eId,
          nombre: a.envio.empresa.nombre,
          enviosTotal: 0,
          enviosConDesvio: 0,
          sumaFuga: 0,
          sumaDesvioKg: 0,
        });
      }
      const g = porEmpresaMap.get(eId)!;
      g.enviosTotal++;
      if (a.auditoria.tieneDesvio) {
        g.enviosConDesvio++;
        g.sumaFuga += a.auditoria.fugaPesos;
        g.sumaDesvioKg += a.auditoria.diffKg;
      }
    }

    const porEmpresa: GrupoEmpresa[] = Array.from(porEmpresaMap.values())
      .map(g => ({
        empresaId: g.empresaId,
        nombre: g.nombre,
        enviosTotal: g.enviosTotal,
        enviosConDesvio: g.enviosConDesvio,
        fugaTotal: Math.round(g.sumaFuga * 100) / 100,
        desvioPromedioKg: g.enviosConDesvio > 0
          ? Math.round((g.sumaDesvioKg / g.enviosConDesvio) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.fugaTotal - a.fugaTotal);

    // ============================================================
    // 3. Por mes.
    // ============================================================
    const porMesMap = new Map<string, {
      enviosConDesvio: number;
      sumaFuga: number;
    }>();

    for (const a of auditados) {
      if (!a.auditoria.tieneDesvio) continue;
      const fecha = a.envio.fechaImpresion;
      const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;

      if (!porMesMap.has(mesKey)) {
        porMesMap.set(mesKey, { enviosConDesvio: 0, sumaFuga: 0 });
      }
      const g = porMesMap.get(mesKey)!;
      g.enviosConDesvio++;
      g.sumaFuga += a.auditoria.fugaPesos;
    }

    const porMes = Array.from(porMesMap.entries())
      .map(([mes, g]) => ({
        mes,
        enviosConDesvio: g.enviosConDesvio,
        fugaTotal: Math.round(g.sumaFuga * 100) / 100,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    // ============================================================
    // 4. Top envios individuales (por fuga descendente).
    // ============================================================
    const topEnvios = auditados
      .filter(a => a.auditoria.tieneDesvio)
      .sort((a, b) => b.auditoria.fugaPesos - a.auditoria.fugaPesos)
      .slice(0, 20)
      .map(a => ({
        envioId: a.envio.id,
        fechaImpresion: a.envio.fechaImpresion,
        empresaNombre: a.envio.empresa.nombre,
        courierNombre: a.envio.courier.nombre,
        pesoCobrado: a.auditoria.pesoCobrado,
        pesoAforado: a.auditoria.pesoAforado,
        diffKg: a.auditoria.diffKg,
        severidad: a.auditoria.severidad,
        fugaPesos: a.auditoria.fugaPesos,
      }));

    return NextResponse.json({
      resumen,
      porCourier,
      porEmpresa,
      porMes,
      topEnvios,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        fuente: "FinanzasEnvio.pesoAforado (poblado via /api/conciliacion al subir Excel mensual del courier)",
        nivelImplementado: "NIVEL 1 (pesoCobrado vs pesoAforado)",
        nivelPendiente: "NIVEL 2 (recomputo de pesoVolumetrico desde dimensiones) - DEUDA 57",
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en desvio-peso:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Desvio Financiero por Peso Volumetrico" },
      { status: 500 }
    );
  }
}
