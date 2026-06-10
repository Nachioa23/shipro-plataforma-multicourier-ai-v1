// ============================================================================
// TORRE DE CONTROL — METRICA 2.5 "Anatomia de la Devolucion"
//
// Analisis detallado de envios DEVUELTO_AL_REMITENTE en ventana 90 dias.
// Expone: motivo, costo, dias de inmovilizacion, touchpoints, punto de
// perdida, cortes por courier / provincia / mes / modalidad / motivo.
//
// Decisiones (director 2026-06-09):
// - Universo: solo envios DEVUELTO_AL_REMITENTE en la ventana.
// - Costo: precioFactura (lo que Shipro le cobra a la empresa cliente).
// - Tiempo: dias desde fechaImpresion (inmovilizacion de stock).
// - Touchpoints: eventos courier × 2.
// - Punto de perdida: ultimo estado courier antes de DEVUELTO.
// - Top 20 detalles individuales ordenados por impacto (costo + dias).
//
// Auth: modoDios (admin_shipro / operador_shipro). Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";
import {
  extraerInfoDevolucion,
  resumirDevoluciones,
  type AnatomiaDevolucion,
} from "@/lib/utils/efectividad-primera-visita";

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

    // Fetch envios DEVUELTO_AL_REMITENTE con eventos + finanzas + courier + destino.
    const envios = await prisma.envio.findMany({
      where: {
        estadoActual: "DEVUELTO_AL_REMITENTE",
        fechaImpresion: { gte: ventanaInicio },
      },
      include: {
        eventos: { orderBy: { fecha: "asc" } },
        courier: { select: { id: true, nombre: true } },
        destino: { select: { provincia: true, localidad: true, cp: true } },
        finanzas: true,
      },
    });

    // ============================================================
    // 1. Construir anatomia individual de cada envio.
    // ============================================================
    const anatomias: Array<AnatomiaDevolucion & {
      courierNombre: string;
      provincia: string;
      localidad: string;
      modalidad: string;
      fechaImpresion: Date;
    }> = envios.map(envio => {
      const anatomia = extraerInfoDevolucion(envio, envio.eventos);
      return {
        ...anatomia,
        courierNombre: envio.courier.nombre,
        provincia: envio.destino?.provincia || "Sin provincia",
        localidad: envio.destino?.localidad || "Sin localidad",
        modalidad: envio.modalidad || "Estandar",
        fechaImpresion: envio.fechaImpresion,
      };
    });

    // ============================================================
    // 2. Resumen agregado global.
    // ============================================================
    const resumen = resumirDevoluciones(anatomias);

    // ============================================================
    // 3. Detalles individuales: top 20 por impacto (costo + dias).
    // ============================================================
    const detalles = [...anatomias]
      .sort((a, b) => {
        // Score combinado: precio normalizado + dias normalizado.
        const scoreA = (a.precioFactura || 0) + (a.diasInmovilizacion || 0) * 100;
        const scoreB = (b.precioFactura || 0) + (b.diasInmovilizacion || 0) * 100;
        return scoreB - scoreA;
      })
      .slice(0, 20);

    // ============================================================
    // 4. Cortes agregados.
    // ============================================================
    type Grupo = {
      cantidad: number;
      costoTotal: number;
      diasTotal: number;
      diasCount: number;
    };
    const grupoVacio = (): Grupo => ({ cantidad: 0, costoTotal: 0, diasTotal: 0, diasCount: 0 });

    const porCourierMap = new Map<string, { courierId: number; nombre: string; grupo: Grupo }>();
    const porProvinciaMap = new Map<string, Grupo>();
    const porMesMap = new Map<string, Grupo>();
    const porModalidadMap = new Map<string, Grupo>();

    for (const envio of envios) {
      const anatomia = extraerInfoDevolucion(envio, envio.eventos);

      // Por courier.
      const courierKey = `${envio.courier.id}`;
      if (!porCourierMap.has(courierKey)) {
        porCourierMap.set(courierKey, { courierId: envio.courier.id, nombre: envio.courier.nombre, grupo: grupoVacio() });
      }
      const grpC = porCourierMap.get(courierKey)!.grupo;
      grpC.cantidad++;
      if (anatomia.precioFactura != null) grpC.costoTotal += anatomia.precioFactura;
      if (anatomia.diasInmovilizacion != null) {
        grpC.diasTotal += anatomia.diasInmovilizacion;
        grpC.diasCount++;
      }

      // Por provincia (normalizada lowercase + trim).
      const provNorm = (envio.destino?.provincia || "Sin provincia").toLowerCase().trim();
      if (!porProvinciaMap.has(provNorm)) porProvinciaMap.set(provNorm, grupoVacio());
      const grpP = porProvinciaMap.get(provNorm)!;
      grpP.cantidad++;
      if (anatomia.precioFactura != null) grpP.costoTotal += anatomia.precioFactura;
      if (anatomia.diasInmovilizacion != null) {
        grpP.diasTotal += anatomia.diasInmovilizacion;
        grpP.diasCount++;
      }

      // Por mes.
      const mesKey = `${envio.fechaImpresion.getFullYear()}-${String(envio.fechaImpresion.getMonth() + 1).padStart(2, "0")}`;
      if (!porMesMap.has(mesKey)) porMesMap.set(mesKey, grupoVacio());
      const grpM = porMesMap.get(mesKey)!;
      grpM.cantidad++;
      if (anatomia.precioFactura != null) grpM.costoTotal += anatomia.precioFactura;
      if (anatomia.diasInmovilizacion != null) {
        grpM.diasTotal += anatomia.diasInmovilizacion;
        grpM.diasCount++;
      }

      // Por modalidad.
      const modKey = envio.modalidad || "Estandar";
      if (!porModalidadMap.has(modKey)) porModalidadMap.set(modKey, grupoVacio());
      const grpMod = porModalidadMap.get(modKey)!;
      grpMod.cantidad++;
      if (anatomia.precioFactura != null) grpMod.costoTotal += anatomia.precioFactura;
      if (anatomia.diasInmovilizacion != null) {
        grpMod.diasTotal += anatomia.diasInmovilizacion;
        grpMod.diasCount++;
      }
    }

    const grupoToShape = (grupo: Grupo) => ({
      cantidad: grupo.cantidad,
      costoTotal: Math.round(grupo.costoTotal * 100) / 100,
      diasPromedio: grupo.diasCount > 0 ? Math.round(grupo.diasTotal / grupo.diasCount) : null,
    });

    const porCourier = Array.from(porCourierMap.values())
      .map(({ courierId, nombre, grupo }) => ({ courierId, nombre, ...grupoToShape(grupo) }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const porProvincia = Array.from(porProvinciaMap.entries())
      .map(([provincia, grupo]) => ({ provincia, ...grupoToShape(grupo) }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);

    const porMes = Array.from(porMesMap.entries())
      .map(([mes, grupo]) => ({ mes, ...grupoToShape(grupo) }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    const porModalidad = Array.from(porModalidadMap.entries())
      .map(([modalidad, grupo]) => ({ modalidad, ...grupoToShape(grupo) }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // ============================================================
    // 5. Top motivos de devolucion (top 5).
    // ============================================================
    const motivosFreq = new Map<string, number>();
    for (const a of anatomias) {
      if (a.motivo) {
        motivosFreq.set(a.motivo, (motivosFreq.get(a.motivo) || 0) + 1);
      }
    }
    const totalConMotivo = Array.from(motivosFreq.values()).reduce((sum, v) => sum + v, 0);
    const topMotivos = Array.from(motivosFreq.entries())
      .map(([motivo, cantidad]) => ({
        motivo,
        cantidad,
        porcentaje: totalConMotivo > 0 ? Math.round((cantidad / totalConMotivo) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    return NextResponse.json({
      resumen,
      detalles,
      porCourier,
      porProvincia,
      porMes,
      porModalidad,
      topMotivos,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en anatomia-devolucion:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Anatomia de la Devolucion" },
      { status: 500 }
    );
  }
}
