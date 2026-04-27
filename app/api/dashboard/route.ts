import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaIdParam = searchParams.get("empresaId");
    const rango = searchParams.get("rango");
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    if (!empresaIdParam) return NextResponse.json({ error: "Falta empresaId" }, { status: 400 });

    const baseWhere = empresaIdParam !== "TODAS" ? { empresaId: parseInt(empresaIdParam) } : {};

    const ahora = new Date();
    let fechaInicio = new Date();
    let fechaFin = new Date();
    let usaFechaFin = false;

    if (desde && hasta) {
      fechaInicio = new Date(`${desde}T00:00:00.000Z`);
      fechaFin = new Date(`${hasta}T23:59:59.999Z`);
      usaFechaFin = true;
    } else {
      if (rango === 'hoy') fechaInicio.setHours(0, 0, 0, 0);
      else if (rango === 'semana') fechaInicio.setDate(ahora.getDate() - 7);
      else if (rango === 'trimestre') fechaInicio.setDate(ahora.getDate() - 90);
      else fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    }

    const whereMes = {
      ...baseWhere,
      fechaImpresion: usaFechaFin ? { gte: fechaInicio, lte: fechaFin } : { gte: fechaInicio }
    };

    const hace180Dias = new Date(); hace180Dias.setDate(ahora.getDate() - 180);
    const where180 = { ...baseWhere, fechaImpresion: { gte: hace180Dias } };

    const enviosData = await prisma.envio.findMany({
      where: whereMes,
      include: {
        finanzas: true, courier: true, destino: true, tickets: true,
        eventos: { orderBy: { fecha: 'asc' } }
      }
    });

    const dataAgrupada = await prisma.envio.groupBy({
      by: ['modalidad'],
      where: whereMes,
      _count: { modalidad: true }
    });

    const couriersAsociados = await prisma.envio.groupBy({
      by: ['courierId'],
      where: whereMes,
      _count: { courierId: true }
    });

    const courierIds = couriersAsociados.map(c => c.courierId);
    const nombresCouriers = await prisma.courier.findMany({
      where: { id: { in: courierIds } },
      select: { id: true, nombre: true }
    });

    const enviosMes = enviosData.length;
    const paquetesSalidos = await prisma.envio.count({ where: where180 });
    const paquetesEntregados = await prisma.envio.count({ where: { ...where180, estadoActual: "ENTREGADO" } });
    const porcentajeExito = paquetesSalidos > 0 ? ((paquetesEntregados / paquetesSalidos) * 100).toFixed(1) : "0.0";

    const gastoTotal = enviosData.reduce((acc, e) => acc + (e.finanzas?.precioFactura || e.finanzas?.precioMostrado || 0), 0);

    const ticketsActivos = await prisma.ticketSoporte.count({
      where: {
        envio: { empresaId: empresaIdParam !== "TODAS" ? parseInt(empresaIdParam) : undefined },
        estado: { not: "CERRADO" }
      }
    });

    // ====== M2: AUDITORÍA DE DIRECCIONES ======
    let countRetenidos = 0; let countAutoGestion = 0; let countSoporte = 0;
    let sumaMinutosCorreccion = 0; let enviosCorregidos = 0;
    const motivosRetencionCount: Record<string, number> = {};

    enviosData.forEach(envio => {
      const eventosRetenidos = (envio.eventos || []).filter(ev => ev.estado === "RETENIDO");

      eventosRetenidos.forEach(eventoRet => {
        countRetenidos++;
        let motivo = eventoRet.observacion || "Motivo desconocido";
        if (motivo.includes("Retenido en Peaje:")) motivo = motivo.replace("Retenido en Peaje:", "").trim();
        motivosRetencionCount[motivo] = (motivosRetencionCount[motivo] || 0) + 1;

        const indexRetenido = (envio.eventos || []).findIndex(e => e.id === eventoRet.id);
        if (indexRetenido !== -1 && indexRetenido < (envio.eventos || []).length - 1) {
          const eventoResolucion = (envio.eventos || []).slice(indexRetenido + 1).find(e => e.estado === "Pendiente" || e.estado === "Impreso" || e.estado === "RETENIDO_RESUELTO");

          if (eventoResolucion) {
            enviosCorregidos++;
            const diffMs = (eventoResolucion.fecha?.getTime() || 0) - (eventoRet.fecha?.getTime() || 0);
            sumaMinutosCorreccion += diffMs / (1000 * 60);

            if (eventoResolucion.observacion && eventoResolucion.observacion.toLowerCase().includes("destinatario")) {
              countAutoGestion++;
            } else {
              countSoporte++;
            }
          }
        }
      });
    });

    let tiempoMedioCorreccion = "-";
    if (enviosCorregidos > 0) {
      const promMinutos = sumaMinutosCorreccion / enviosCorregidos;
      if (promMinutos < 60) tiempoMedioCorreccion = `${Math.round(promMinutos)}m`;
      else tiempoMedioCorreccion = `${Math.floor(promMinutos / 60)}h ${Math.round(promMinutos % 60)}m`;
    }

    const auditoriaStats = {
      totalRetenidos: countRetenidos,
      porcentajeFallaOrigen: enviosMes > 0 ? Number(((countRetenidos / enviosMes) * 100).toFixed(1)) : 0,
      tasaAutoGestion: enviosCorregidos > 0 ? Number(((countAutoGestion / enviosCorregidos) * 100).toFixed(1)) : 0,
      tasaSoporte: enviosCorregidos > 0 ? Number(((countSoporte / enviosCorregidos) * 100).toFixed(1)) : 0,
      tiempoMedioCorreccion,
      topProblemas: Object.entries(motivosRetencionCount).map(([motivo, cant]) => ({ motivo, cant })).sort((a, b) => b.cant - a.cant).slice(0, 3)
    };

    // ====== M3: FUGA POR RUTEO ======
    let fugaRuteoTotal = 0; let enviosConFugaRuteo = 0; let enviosSinFugaRuteo = 0;
    const desviosPorZona: Record<string, any> = {};

    enviosData.forEach(envio => {
      const fuga = envio.finanzas?.fugaFinanciera || 0;
      if (fuga > 0) {
        fugaRuteoTotal += fuga;
        enviosConFugaRuteo++;
        const zona = envio.destino?.provincia || "Desconocida";
        const elegido = `${envio.courier?.nombre || 'Courier'} ${envio.modalidad || ''}`.trim();
        const sugerido = `${envio.finanzas?.courierSugerido || 'Otro'} ${envio.finanzas?.servicioSugerido || ''}`.trim();

        if (!desviosPorZona[zona]) {
          desviosPorZona[zona] = { destino: zona, totalPerdido: 0, enviosAfectados: 0, elegidosMap: {} as Record<string, number>, sugeridosMap: {} as Record<string, number> };
        }
        desviosPorZona[zona].totalPerdido += fuga;
        desviosPorZona[zona].enviosAfectados += 1;
        desviosPorZona[zona].elegidosMap[elegido] = (desviosPorZona[zona].elegidosMap[elegido] || 0) + 1;
        desviosPorZona[zona].sugeridosMap[sugerido] = (desviosPorZona[zona].sugeridosMap[sugerido] || 0) + 1;
      } else {
        enviosSinFugaRuteo++;
      }
    });

    const totalEvaluadosRuteo = enviosConFugaRuteo + enviosSinFugaRuteo;
    const ruteoStats = {
      fugaFinancieraTotal: fugaRuteoTotal,
      enviosOptimizados: totalEvaluadosRuteo > 0 ? Math.round((enviosSinFugaRuteo / totalEvaluadosRuteo) * 100) : 100,
      enviosIneficientes: totalEvaluadosRuteo > 0 ? Math.round((enviosConFugaRuteo / totalEvaluadosRuteo) * 100) : 0,
      costoPromedioExtra: enviosConFugaRuteo > 0 ? Math.round(fugaRuteoTotal / enviosConFugaRuteo) : 0,
      topDesvios: Object.values(desviosPorZona).map((z: any) => {
        const masElegido = Object.keys(z.elegidosMap).reduce((a, b) => z.elegidosMap[a] > z.elegidosMap[b] ? a : b);
        const masSugerido = Object.keys(z.sugeridosMap).reduce((a, b) => z.sugeridosMap[a] > z.sugeridosMap[b] ? a : b);
        return { destino: z.destino, elegidos: masElegido, sugerido: masSugerido, costoPromedioExtra: Math.round(z.totalPerdido / z.enviosAfectados), totalPerdido: z.totalPerdido, enviosAfectados: z.enviosAfectados };
      }).sort((a, b) => b.totalPerdido - a.totalPerdido).slice(0, 3)
    };

    // ====== M4: AFORO ======
    let aforoFugaTotal = 0; let enviosConFugaAforo = 0; let sumaDesvioKg = 0; let leveCount = 0; let moderadoCount = 0; let graveCount = 0;
    const couriersAforoStats: Record<string, { total: number, conFuga: number }> = {};

    enviosData.forEach(e => {
      const f = e.finanzas;
      if (!f) return;
      if (f.pesoAforado !== null && f.pesoAforado !== undefined) {
        const pesoCobrado = f.pesoCobrado || 0;
        const pesoAforado = f.pesoAforado || 0;
        const cName = e.courier?.nombre || "Desconocido";

        if (!couriersAforoStats[cName]) couriersAforoStats[cName] = { total: 0, conFuga: 0 };
        couriersAforoStats[cName].total++;

        if (pesoAforado > pesoCobrado) {
          enviosConFugaAforo++;
          couriersAforoStats[cName].conFuga++;
          const perdidaReal = (f.precioFactura || 0) - (f.precioMostrado || 0);
          if (perdidaReal > 0) aforoFugaTotal += perdidaReal;

          const diffKg = pesoAforado - pesoCobrado;
          sumaDesvioKg += diffKg;
          if (diffKg <= 1) leveCount++; else if (diffKg <= 3) moderadoCount++; else graveCount++;
        }
      }
    });

    const baseTotalAforo = enviosData.length > 0 ? enviosData.length : 1;
    const aforoStats = {
      fugaTotal: aforoFugaTotal,
      porcentajeFugaPeso: Math.round((enviosConFugaAforo / baseTotalAforo) * 100),
      desvioPromedioKg: enviosConFugaAforo > 0 ? Number((sumaDesvioKg / enviosConFugaAforo).toFixed(1)) : 0,
      costoPromedioDesvio: enviosConFugaAforo > 0 ? Math.round(aforoFugaTotal / enviosConFugaAforo) : 0,
      distribucionError: {
        leve: enviosConFugaAforo > 0 ? Math.round((leveCount / enviosConFugaAforo) * 100) : 0,
        moderado: enviosConFugaAforo > 0 ? Math.round((moderadoCount / enviosConFugaAforo) * 100) : 0,
        grave: enviosConFugaAforo > 0 ? Math.round((graveCount / enviosConFugaAforo) * 100) : 0
      },
      topEstrictos: Object.entries(couriersAforoStats).map(([courier, stats]) => ({ courier, porcentajeAforos: stats.total > 0 ? Math.round((stats.conFuga / stats.total) * 100) : 0 })).sort((a, b) => b.porcentajeAforos - a.porcentajeAforos).slice(0, 3)
    };

    // ====== M5: EFECTIVIDAD ======
    let e1raVisita = 0; let eForzada = 0; let eDevuelto = 0; let costoInversaEstimado = 0;
    const fallasCount: Record<string, number> = {}; const devMapa: Record<string, number> = {};

    enviosData.forEach(e => {
      const repartos = (e.eventos || []).filter(ev => ev.estado === "REPARTO" || ev.estado === "TRANSITO").length;
      if (e.estadoActual === "ENTREGADO") {
        if (repartos <= 1) e1raVisita++; else eForzada++;
      } else if (e.estadoActual === "DEVUELTO" || e.estadoActual === "CANCELADO") {
        eDevuelto++;
        costoInversaEstimado += (e.finanzas?.precioFactura || e.finanzas?.precioMostrado || 0);
        const prov = e.destino?.provincia || "Desconocida";
        devMapa[prov] = (devMapa[prov] || 0) + 1;
      }
      (e.eventos || []).forEach(ev => {
        if (ev.estado === "NO_ENTREGADO" || ev.estado === "VISITA_FALLIDA") {
           const motivo = ev.observacion || "Motivo sin especificar";
           fallasCount[motivo] = (fallasCount[motivo] || 0) + 1;
        }
      });
    });

    const valEf = e1raVisita + eForzada + eDevuelto || 1;
    const totalFallas = Object.values(fallasCount).reduce((a,b) => a+b, 0) || 1;

    const efectividadStats = {
      tasaPrimeraVisita: enviosData.length > 0 ? Math.round((e1raVisita / valEf) * 100) : (porcentajeExito !== "0.0" ? parseFloat(porcentajeExito) : 82),
      tasaEntregasForzadas: Math.round((eForzada / valEf) * 100),
      tasaDevolucion: Math.round((eDevuelto / valEf) * 100),
      costoInversaEstimado,
      topMotivosFalla: Object.keys(fallasCount).map(k => ({ motivo: k, porcentaje: Math.round((fallasCount[k] / totalFallas) * 100) })).sort((a, b) => b.porcentaje - a.porcentaje).slice(0, 3),
      mapaDevoluciones: Object.keys(devMapa).map(k => ({ provincia: k, devoluciones: devMapa[k], porcentaje: Math.round((devMapa[k] / (eDevuelto || 1)) * 100) })).sort((a, b) => b.devoluciones - a.devoluciones).slice(0, 3)
    };

    // ====== M6: SOPORTE ======
    let totalTicketsCount = 0; let tAbiertos = 0; let tProgreso = 0; let tCerrados = 0; let totalHorasResolucion = 0; let ticketsCerradosCount = 0;
    const motivosSoporte: Record<string, { count: number, courier: string }> = {};
    let clienteAutoServicio = 0; let shiproRadar = 0;

    enviosData.forEach(e => {
      (e.tickets || []).forEach(t => {
        totalTicketsCount++;
        if (t.estado === "ABIERTO") tAbiertos++; else if (t.estado === "PROGRESO") tProgreso++; else if (t.estado === "CERRADO") {
          tCerrados++;
          if (t.fechaCierre && t.fechaCreacion) {
            totalHorasResolucion += (t.fechaCierre.getTime() - t.fechaCreacion.getTime()) / (1000 * 3600);
            ticketsCerradosCount++;
          }
        }
        const mot = t.motivo || "Consulta General";
        const cName = e.courier?.nombre || "General";
        if (!motivosSoporte[mot]) motivosSoporte[mot] = { count: 0, courier: cName };
        motivosSoporte[mot].count++;
        if (t.observacion?.includes("[Alerta Automática]")) shiproRadar++; else clienteAutoServicio++;
      });
    });

    const soporteStats = {
      tasaSoporte: enviosMes > 0 ? Number(((totalTicketsCount / enviosMes) * 100).toFixed(1)) : 0,
      ticketsAbiertos: tAbiertos,
      tiempoMedioResolucion: ticketsCerradosCount > 0 ? `${Math.round(totalHorasResolucion / ticketsCerradosCount)}h` : "0h",
      distribucionEstados: { abiertos: totalTicketsCount > 0 ? Math.round((tAbiertos / totalTicketsCount) * 100) : 0, progreso: totalTicketsCount > 0 ? Math.round((tProgreso / totalTicketsCount) * 100) : 0, resueltos: totalTicketsCount > 0 ? Math.round((tCerrados / totalTicketsCount) * 100) : 0 },
      topMotivos: Object.keys(motivosSoporte).map(k => ({ motivo: k, porcentaje: Math.round((motivosSoporte[k].count / totalTicketsCount) * 100), courierAsociado: motivosSoporte[k].courier })).sort((a,b) => b.porcentaje - a.porcentaje).slice(0, 3),
      creadorTicket: { clienteAutoServicio: totalTicketsCount > 0 ? Math.round((clienteAutoServicio / totalTicketsCount) * 100) : 0, shiproRadar: totalTicketsCount > 0 ? Math.round((shiproRadar / totalTicketsCount) * 100) : 0 }
    };

    // ====== M11: NPS (CÁLCULO REAL CON MATRIZ DE FRICCIÓN) ======
    const encuestasDB = await prisma.encuestaNPS.findMany({
      where: { envio: whereMes }, // <-- ACÁ CORREGIMOS EL ERROR: usamos whereMes en lugar de donde
      include: { courier: true, envio: true },
      orderBy: { fechaVoto: 'desc' }
    });

    let promotores = 0; let pasivos = 0; let detractores = 0;
    const npsPorCourier: Record<string, { promotores: number, pasivos: number, detractores: number, total: number }> = {};
    const friccionEntrega: Record<string, number> = {};
    
    encuestasDB.forEach(enc => {
      const cName = enc.courier?.nombre || "Desconocido";
      if (!npsPorCourier[cName]) npsPorCourier[cName] = { promotores: 0, pasivos: 0, detractores: 0, total: 0 };
      
      npsPorCourier[cName].total++;

      if (enc.categoria === "PROMOTOR") { promotores++; npsPorCourier[cName].promotores++; }
      else if (enc.categoria === "PASIVO") { pasivos++; npsPorCourier[cName].pasivos++; }
      else if (enc.categoria === "DETRACTOR") { detractores++; npsPorCourier[cName].detractores++; }

      if (enc.experienciaEntrega) {
        friccionEntrega[enc.experienciaEntrega] = (friccionEntrega[enc.experienciaEntrega] || 0) + 1;
      }
    });

    const totalEncuestas = encuestasDB.length || 1;
    const pctPromotores = encuestasDB.length > 0 ? Math.round((promotores / totalEncuestas) * 100) : 0;
    const pctDetractores = encuestasDB.length > 0 ? Math.round((detractores / totalEncuestas) * 100) : 0;
    
    const npsCalculado = encuestasDB.length > 0 ? (pctPromotores - pctDetractores) : 0;

    const npsCourierFinal: Record<string, any> = {};
    Object.keys(npsPorCourier).forEach(c => {
       const t = npsPorCourier[c].total;
       const p = Math.round((npsPorCourier[c].promotores / t) * 100);
       const d = Math.round((npsPorCourier[c].detractores / t) * 100);
       npsCourierFinal[c] = { scoreNps: p - d, total: t };
    });

    const nps = {
      global: npsCalculado,
      promotores: pctPromotores,
      pasivos: encuestasDB.length > 0 ? Math.round((pasivos / totalEncuestas) * 100) : 0,
      detractores: pctDetractores,
      porCourier: npsCourierFinal,
      friccionEntrega: Object.keys(friccionEntrega).map(k => ({ motivo: k, cantidad: friccionEntrega[k] })).sort((a,b) => b.cantidad - a.cantidad),
      ultimosComentarios: encuestasDB.filter(e => e.comentario).slice(0, 6).map(e => ({
        score: e.score,
        tracking: e.envio?.trackingNumber || "N/A",
        comentario: e.comentario,
        courier: e.courier?.nombre,
        satisfaccionProducto: e.satisfaccionProducto,
        recompra: e.probabilidadRecompra
      }))
    };

    // ====== M7 Y M8: COLECTA Y MODALIDADES ======
    let qtySameDay = 0, qtyNextDay = 0, qtyDemorado = 0;
    const statsCourierDespacho: any = {};

    enviosData.forEach(e => {
      const cName = e.courier?.nombre || "Otros";
      if (e.fechaColecta && e.fechaImpresion) {
        const hs = (e.fechaColecta.getTime() - e.fechaImpresion.getTime()) / (1000 * 3600);
        if (hs <= 24) qtySameDay++; else if (hs <= 48) qtyNextDay++; else qtyDemorado++;
      }
      if (!statsCourierDespacho[cName]) statsCourierDespacho[cName] = { hs: 0, count: 0 };
      statsCourierDespacho[cName].count++;
    });

    const enviosValidos = enviosData.length || 1;
    const despachoSegmentos = { sameDay: Math.round((qtySameDay / enviosValidos) * 100) || 0, nextDay: Math.round((qtyNextDay / enviosValidos) * 100) || 0, demorado: Math.round((qtyDemorado / enviosValidos) * 100) || 0 };
    const despachoPorCourier = Object.keys(statsCourierDespacho).map(c => ({ courier: c, promedioHs: Math.round((statsCourierDespacho[c].count / enviosValidos) * 100) })).sort((a,b) => b.promedioHs - a.promedioHs).slice(0,3);

    // ====== M10: SLA INDEX ======
    let totalE2E = 0; let cumplidosE2E = 0; let totalSlaCourier = 0; let sumaIndicesSla = 0; 
    const desgloseZonas: Record<string, any> = {};

    const slasDB = await prisma.slaCourier.findMany();
    const diccionarioSlas = new Map<string, number>();
    slasDB.forEach(sla => {
      diccionarioSlas.set(`${sla.courierId}-${sla.zonaNombre}`, sla.diasPactados);
    });

    enviosData.forEach(e => {
      const estadoUpper = (e.estadoActual || "").toUpperCase();
      const evtEntregado = (e.eventos || []).find(ev => ev.estado.toUpperCase() === "ENTREGADO");
      const evtVisitaFallida = (e.eventos || []).find(ev => ev.estado.toUpperCase() === "VISITA_FALLIDA");
      
      const fechaEntregaReal = evtEntregado?.fecha || e.fechaEntrega;
      const fechaHitoSla = evtEntregado?.fecha || evtVisitaFallida?.fecha || e.fechaEntrega;

      if (e.fechaImpresion && estadoUpper === "ENTREGADO" && fechaEntregaReal) {
        totalE2E++;
        const diasRealesE2E = (fechaEntregaReal.getTime() - e.fechaImpresion.getTime()) / (1000 * 3600 * 24);
        const promesa = e.diasPrometidosCheckout || 5; 
        if (diasRealesE2E <= promesa) cumplidosE2E++;
      }

      if (e.fechaColecta && fechaHitoSla) {
        totalSlaCourier++;
        let zona = e.destino?.provincia || "Otras";
        if (zona.includes("Buenos Aires")) zona = "Buenos Aires";
        if (zona.includes("Capital") || zona === "CABA") zona = "CABA";

        const meta = diccionarioSlas.get(`${e.courierId}-${zona}`) || 5;
        const diasTransito = (fechaHitoSla.getTime() - e.fechaColecta.getTime()) / (1000 * 3600 * 24);
        
        const indice = Number((diasTransito / meta).toFixed(2));
        sumaIndicesSla += indice;

        if (!desgloseZonas[zona]) {
          desgloseZonas[zona] = { total: 0, sumaIndice: 0, sumaTransito: 0, meta: meta, cumple: 0 };
        }
        desgloseZonas[zona].total++;
        desgloseZonas[zona].sumaIndice += indice;
        desgloseZonas[zona].sumaTransito += diasTransito;
        if (diasTransito <= meta) desgloseZonas[zona].cumple++;
      }
    });

    let sumaDiasPrepGlobal = 0;
    let enviosConPrep = 0;
    enviosData.forEach(e => {
      if (e.fechaColecta && e.fechaImpresion) {
        sumaDiasPrepGlobal += (e.fechaColecta.getTime() - e.fechaImpresion.getTime()) / (1000 * 3600 * 24);
        enviosConPrep++;
      }
    });

    const slaStats = {
      cumplimientoE2E: totalE2E > 0 ? Math.round((cumplidosE2E / totalE2E) * 100) : 0,
      slaHealthIndex: totalSlaCourier > 0 ? Number((sumaIndicesSla / totalSlaCourier).toFixed(2)) : 0,
      promedioPreparacion: enviosConPrep > 0 ? Number((sumaDiasPrepGlobal / enviosConPrep).toFixed(1)) : 0,
      mapaZonas: Object.keys(desgloseZonas).map(z => ({
        zona: z,
        indice: Number((desgloseZonas[z].sumaIndice / desgloseZonas[z].total).toFixed(2)),
        transitoReal: Number((desgloseZonas[z].sumaTransito / desgloseZonas[z].total).toFixed(1)),
        metaPactada: desgloseZonas[z].meta,
        cumplimiento: Math.round((desgloseZonas[z].cumple / desgloseZonas[z].total) * 100),
        volumen: desgloseZonas[z].total
      })).sort((a,b) => b.volumen - a.volumen)
    };

    return NextResponse.json({
      totalEnvios: enviosMes, enviosMes, porcentajeExito, gastoTotal, ticketsActivos,
      ruteoStats, aforoStats, efectividadStats, soporteStats, nps, slaStats,
      despachoSegmentos, despachoPorCourier, auditoriaStats,
      modalidades: dataAgrupada || [],
      couriers: couriersAsociados || [],
      nombresCouriers: nombresCouriers || []
    });

  } catch (error: any) {
    console.error("❌ ERROR CRÍTICO EN API UNIVERSAL:", error.message);
    return NextResponse.json({ error: "Error interno al calcular métricas" }, { status: 500 });
  }
}