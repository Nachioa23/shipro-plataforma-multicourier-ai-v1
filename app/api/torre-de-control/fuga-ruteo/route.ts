// ============================================================================
// TORRE DE CONTROL — METRICA 3.2 "Fuga por Ruteo Ineficiente"
//
// Mide el dinero perdido por elegir un courier mas caro cuando habia otro
// mas barato disponible dentro del mix activo del cliente.
//
// NIVEL 1 (implementado): fuga DENTRO del mix activo del cliente.
//   - Data fuente: FinanzasEnvio.fugaFinanciera (precomputada al crear envio).
//   - courierSugerido + servicioSugerido tambien estan precomputados.
//
// NIVEL 2 (DEUDA 56): fuga vs RED COMPLETA de Shipro (couriers no activos).
//   - Requiere snapshot al crear envio de cotizaciones contra TODOS los
//     couriers integrados, no solo los activos para esa empresa.
//   - Sin implementacion en V1.
//
// Decisiones (director 2026-06-10):
// - Universo: envios en ventana 90 dias con FinanzasEnvio relacionada.
// - Tasa de ineficiencia: enviosConFuga / totalEnvios * 100.
// - Ahorro proyectado anual: fugaTotal * (365 / 90).
//
// Auth: modoDios. Scope global.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

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

    // Filtrar envios con finanzas + fuga > 0.
    const enviosConFuga = envios.filter(
      e => e.finanzas != null && (e.finanzas.fugaFinanciera || 0) > 0
    );

    const totalEnvios = envios.length;
    const cantidadConFuga = enviosConFuga.length;
    const tasaIneficiencia = totalEnvios > 0
      ? Math.round((cantidadConFuga / totalEnvios) * 1000) / 10
      : 0;

    // ============================================================
    // 1. Resumen agregado.
    // ============================================================
    const fugaTotal = enviosConFuga.reduce(
      (sum, e) => sum + (e.finanzas!.fugaFinanciera || 0),
      0
    );
    const fugaPromedio = cantidadConFuga > 0
      ? Math.round((fugaTotal / cantidadConFuga) * 100) / 100
      : 0;
    const fugaMax = enviosConFuga.length > 0
      ? Math.max(...enviosConFuga.map(e => e.finanzas!.fugaFinanciera || 0))
      : 0;

    // Ahorro proyectado anual: extrapolar la fuga de 90 dias a 365.
    const ahorroProyectadoAnual = Math.round(fugaTotal * (365 / VENTANA_DIAS) * 100) / 100;

    // ============================================================
    // 2. Top desvios (combos elegido -> sugerido).
    // ============================================================
    type DesvioKey = string; // "elegidoNombre || sugerido || servicio"
    const desviosMap = new Map<DesvioKey, {
      courierElegido: string;
      courierSugerido: string;
      servicioSugerido: string;
      cantidad: number;
      fugaTotal: number;
    }>();

    for (const e of enviosConFuga) {
      const elegido = e.courier.nombre;
      const sugerido = e.finanzas!.courierSugerido || "Sin sugerencia";
      const servicio = e.finanzas!.servicioSugerido || "Sin servicio";
      const key = `${elegido}||${sugerido}||${servicio}`;

      if (!desviosMap.has(key)) {
        desviosMap.set(key, {
          courierElegido: elegido,
          courierSugerido: sugerido,
          servicioSugerido: servicio,
          cantidad: 0,
          fugaTotal: 0,
        });
      }
      const d = desviosMap.get(key)!;
      d.cantidad++;
      d.fugaTotal += e.finanzas!.fugaFinanciera || 0;
    }

    const topDesvios = Array.from(desviosMap.values())
      .map(d => ({
        ...d,
        fugaTotal: Math.round(d.fugaTotal * 100) / 100,
        fugaPromedio: Math.round((d.fugaTotal / d.cantidad) * 100) / 100,
      }))
      .sort((a, b) => b.fugaTotal - a.fugaTotal)
      .slice(0, 10);

    // ============================================================
    // 3. Por empresa.
    // ============================================================
    const porEmpresaMap = new Map<number, {
      empresaId: number;
      nombre: string;
      cantidadConFuga: number;
      fugaTotal: number;
    }>();

    for (const e of enviosConFuga) {
      const empId = e.empresa.id;
      if (!porEmpresaMap.has(empId)) {
        porEmpresaMap.set(empId, {
          empresaId: empId,
          nombre: e.empresa.nombre,
          cantidadConFuga: 0,
          fugaTotal: 0,
        });
      }
      const grp = porEmpresaMap.get(empId)!;
      grp.cantidadConFuga++;
      grp.fugaTotal += e.finanzas!.fugaFinanciera || 0;
    }

    const porEmpresa = Array.from(porEmpresaMap.values())
      .map(g => ({
        ...g,
        fugaTotal: Math.round(g.fugaTotal * 100) / 100,
        fugaPromedio: g.cantidadConFuga > 0
          ? Math.round((g.fugaTotal / g.cantidadConFuga) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.fugaTotal - a.fugaTotal);

    // ============================================================
    // 4. Por mes.
    // ============================================================
    const porMesMap = new Map<string, { cantidadConFuga: number; fugaTotal: number }>();

    for (const e of enviosConFuga) {
      const fecha = e.fechaImpresion;
      const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;

      if (!porMesMap.has(mesKey)) {
        porMesMap.set(mesKey, { cantidadConFuga: 0, fugaTotal: 0 });
      }
      const grp = porMesMap.get(mesKey)!;
      grp.cantidadConFuga++;
      grp.fugaTotal += e.finanzas!.fugaFinanciera || 0;
    }

    const porMes = Array.from(porMesMap.entries())
      .map(([mes, g]) => ({
        mes,
        cantidadConFuga: g.cantidadConFuga,
        fugaTotal: Math.round(g.fugaTotal * 100) / 100,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    // ============================================================
    // 5. Top envios con mas fuga individual.
    // ============================================================
    const topEnvios = [...enviosConFuga]
      .sort((a, b) => (b.finanzas!.fugaFinanciera || 0) - (a.finanzas!.fugaFinanciera || 0))
      .slice(0, 20)
      .map(e => ({
        envioId: e.id,
        fechaImpresion: e.fechaImpresion,
        empresaNombre: e.empresa.nombre,
        courierElegido: e.courier.nombre,
        courierSugerido: e.finanzas!.courierSugerido || "Sin sugerencia",
        servicioSugerido: e.finanzas!.servicioSugerido || "Sin servicio",
        fuga: Math.round((e.finanzas!.fugaFinanciera || 0) * 100) / 100,
        precioProveedor: e.finanzas!.precioProveedor || 0,
      }));

    return NextResponse.json({
      resumen: {
        totalEnvios,
        enviosConFuga: cantidadConFuga,
        tasaIneficiencia,
        fugaTotal: Math.round(fugaTotal * 100) / 100,
        fugaPromedio,
        fugaMax: Math.round(fugaMax * 100) / 100,
        ahorroProyectadoAnual,
      },
      topDesvios,
      porEmpresa,
      porMes,
      topEnvios,
      calidadDatos: {
        ventanaDias: VENTANA_DIAS,
        fuente: "FinanzasEnvio.fugaFinanciera (precomputada al crear envio)",
        nivelImplementado: "NIVEL 1 (mix activo del cliente)",
        nivelPendiente: "NIVEL 2 (red completa Shipro) - DEUDA 56",
      },
    });

  } catch (error: any) {
    console.error("[Torre de Control] Error en fuga-ruteo:", error);
    return NextResponse.json(
      { error: "Error calculando metrica Fuga por Ruteo Ineficiente" },
      { status: 500 }
    );
  }
}
