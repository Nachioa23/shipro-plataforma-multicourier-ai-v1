import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { enviarMailColecta, enviarMailEntregadoNPS } from "@/lib/mailer";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { ESTADOS_COURIER_REPETIBLES, DIAS_MAXIMO_RASTREO, displayCourier } from "@/lib/utils/estados";
import { pushTrackingEvent } from "@/lib/tiendanube/tracking-api";
import { estadoTiendanube, MAPEO_ESTADO_TIENDANUBE } from "@/lib/tiendanube/tracking-map";
import { decryptSecret } from "@/lib/utils/secret-crypto";

export async function GET(request: Request) {
  try {
    const LOTE_MAXIMO = 200; // Capacidad escalada para +100k envíos/mes
    const LOTE_REINTENTO_TIENDANUBE = 50; // Cap del barrido de reintento de push a Tiendanube (drena backlog gradual).
    const DIAS_MAXIMO_REINTENTO_TIENDANUBE = 3; // Ventana de reintento; más viejo = probablemente structural, no transitorio.
    // DEUDA 14: fail-fast si APP_URL no esta configurada (mejor que mandar
    // mails con links a localhost desde produccion).
    const baseUrl = getAppUrlOrThrow();

    // OBTENER LOS ENVÍOS "MÁS VIEJOS" QUE NO ESTÁN ENTREGADOS
    // Ordenamos por 'fechaActualizacion' ascendente, para que siempre procese los más atrasados primero.
    const cutoffDate = new Date(Date.now() - DIAS_MAXIMO_RASTREO * 24 * 60 * 60 * 1000);
    const enviosARastrear = await prisma.envio.findMany({
      where: {
        // F3 (2026-06-09): solo terminales reales en el filtro de exclusion.
        // INCIDENCIA y NO_ENTREGADO se sacaron porque son bidireccionales
        // (paquete "perdido" puede aparecer y entregarse). DEVUELTO es
        // sinonimo legacy de DEVUELTO_AL_REMITENTE, ambos terminales.
        estadoActual: { notIn: ["ENTREGADO", "CANCELADO", "DEVUELTO", "DEVUELTO_AL_REMITENTE", "BLOQUEADO_SALDO", "BLOQUEADO_DEPOSITO", "BLOQUEADO_PARCIAL", "BLOQUEADO_OPERATIVIDAD", "BLOQUEADO_CREDENCIAL"] },
        trackingNumber: { not: "" },
        // F3 (2026-06-09): cutoff temporal de 45 dias desde impresion.
        // Despues de este cutoff, el envio sale del loop del cron y solo
        // se actualiza manualmente desde la UI.
        fechaImpresion: { gte: cutoffDate }
      },
      include: { 
        destino: true, courier: true, empresa: true,
        tickets: { where: { estado: "ABIERTO" } },
        eventos: { orderBy: { fecha: 'desc' }, take: 1 }
      },
      orderBy: [
        // F2 Bloque 2 (2026-06-09): "oldest first" por timestamp de último
        // rastreo. Envios con NULL (nunca rastreados) van primero. Garantiza
        // que ningún envío se quede sin rastreo en cada ventana.
        { fechaUltimoRastreo: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
      take: LOTE_MAXIMO
    });

    if (enviosARastrear.length === 0) return NextResponse.json({ mensaje: "No hay envíos activos que requieran rastreo." });

    let actualizados = 0; let errores = 0; let ticketsCreados = 0;

    for (const envio of enviosARastrear) {
      try {
        if (envio.trackingNumber.startsWith('SHP-')) continue;

        const nombreCourierBaseDatos = envio.courier.nombre;
        const nombreNormalizado = normalizarParaComparacion(nombreCourierBaseDatos);

        const credencial = await prisma.credencialCourier.findUnique({
          where: { empresaId_nombreCourier: { empresaId: envio.empresaId, nombreCourier: nombreCourierBaseDatos } }
        });

        let llaves = credencial?.usaCredencialesPropias
          ? parsearCredencialesPropias(nombreNormalizado, credencial.credencialesJson)
          : obtenerCredencialesShipro(nombreNormalizado);

        const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);
        const nuevoEstadoCrudo = await motorCourier.rastrear(envio.trackingNumber);
        
        if (nuevoEstadoCrudo && nuevoEstadoCrudo !== "DESCONOCIDO") {
          let estadoShiproLimpio = nuevoEstadoCrudo;
          let mapeo = await prisma.nomenclador.findUnique({
            where: { courierId_estadoCrudo: { courierId: envio.courierId, estadoCrudo: nuevoEstadoCrudo } }
          });

          if (!mapeo) {
            mapeo = await prisma.nomenclador.create({
              data: { courierId: envio.courierId, estadoCrudo: nuevoEstadoCrudo, estadoShipro: null }
            });
          }

          if (mapeo && mapeo.estadoShipro) {
             estadoShiproLimpio = mapeo.estadoShipro.replace('S_', '');
          }

          // F2 Bloque 2 (2026-06-09): pre-computar flags de cambio y repetibilidad.
          // estadoCambio: el courier reporta un estado distinto al actual.
          // esRepetible: el estado (aunque sea el mismo que el actual) genera
          // EventoTracking nuevo porque cuenta como intento adicional (visitas
          // repetidas, fluctuaciones de INCIDENCIA, etc).
          const estadoCambio = estadoShiproLimpio !== envio.estadoActual;
          const esRepetible = (ESTADOS_COURIER_REPETIBLES as readonly string[]).includes(estadoShiproLimpio);

          // F2 Bloque 2: SIEMPRE actualizamos fechaUltimoRastreo (para el
          // ordering "oldest first" del cron). Las demás actualizaciones de
          // estado solo si efectivamente cambió.
          let datosAActualizar: any = { fechaUltimoRastreo: new Date() };

          if (estadoCambio) {
            datosAActualizar.estadoActual = estadoShiproLimpio;
            // F5.3 (2026-06-09): canonicas F1 (los adapters ahora retornan PAQUETE_RECOLECTADO o EN_TRANSITO_A_DESTINO directamente).
            if ((estadoShiproLimpio === "PAQUETE_RECOLECTADO" || estadoShiproLimpio === "EN_TRANSITO_A_DESTINO") && !envio.fechaColecta) {
                datosAActualizar.fechaColecta = new Date();
            }
            if (estadoShiproLimpio === "ENTREGADO" && !envio.fechaEntrega) {
                datosAActualizar.fechaEntrega = new Date();
            }
          }

          await prisma.envio.update({ where: { id: envio.id }, data: datosAActualizar });

          // F2 Bloque 2: crear EventoTracking si el estado cambió O si es un
          // estado repetible. Esto permite a Metrica 2.2 contar intentos
          // discretos de visita (cada llamada del cron que devuelve
          // EN_DISTRIBUCION durante una semana = una visita).
          // Torre de Control Metrica 1.1 (2026-06-04): poblar estadoCrudoOriginal
          // con el estado raw del courier antes del mapeo via Nomenclador.
          if (estadoCambio || esRepetible) {
            const nuevoEvento = await prisma.eventoTracking.create({
              data: {
                estado: estadoShiproLimpio,
                estadoCrudoOriginal: nuevoEstadoCrudo,
                observacion: `El courier reportó: ${nuevoEstadoCrudo}`,
                envioId: envio.id
              }
            });

            // ---- PUSH a Tiendanube (best-effort, sólo envíos Tiendanube) ----
            // DEUDA 104 Movimiento 2/3: si el envío está linkeado a Tiendanube, empujar el evento al
            // timeline del comprador. Self-contained: cualquier fallo se loguea y el evento queda con
            // sincronizadoTiendanubeEn=null para que el barrido de reintento (Movimiento 3) lo levante.
            // Nunca rompe el for-loop del cron ni la lógica existente de tracking/mails.
            const esEnvioTiendanube =
              envio.tiendanubeOrderId != null &&
              envio.tiendanubeFulfillmentOrderId != null &&
              envio.tiendanubeStoreId != null;
            if (esEnvioTiendanube) {
              const statusTn = estadoTiendanube(estadoShiproLimpio);
              if (statusTn) {
                try {
                  const tiendaAuth = await prisma.tiendaTiendanube.findUnique({
                    where: { storeId: envio.tiendanubeStoreId! },
                    select: { accessToken: true },
                  });
                  if (tiendaAuth?.accessToken) {
                    await pushTrackingEvent({
                      storeId: envio.tiendanubeStoreId!,
                      orderId: envio.tiendanubeOrderId!,
                      fulfillmentOrderId: envio.tiendanubeFulfillmentOrderId!,
                      accessToken: decryptSecret(tiendaAuth.accessToken),
                      status: statusTn,
                      description: displayCourier(estadoShiproLimpio as any),
                      happenedAt: nuevoEvento.fecha,
                    });
                    await prisma.eventoTracking.update({
                      where: { id: nuevoEvento.id },
                      data: { sincronizadoTiendanubeEn: new Date() },
                    });
                    console.log("[cron rastreo] tracking pusheado a Tiendanube:", {
                      envioId: envio.id, eventoId: nuevoEvento.id, status: statusTn,
                    });
                  } else {
                    console.warn("[cron rastreo] envío Tiendanube sin accessToken — skip push:", { envioId: envio.id });
                  }
                } catch (pushErr) {
                  console.error("[cron rastreo] push a Tiendanube falló (se reintentará):", {
                    envioId: envio.id, eventoId: nuevoEvento.id,
                    err: pushErr instanceof Error ? pushErr.message : String(pushErr).slice(0, 200),
                  });
                }
              }
            }
          }

          if (estadoCambio) {
            const emailCliente = envio.destino?.email;
            const nombreCliente = envio.destino?.nombre || "Cliente";

            if (emailCliente) {
              const urlSeguimiento = `${baseUrl}/s/${envio.trackingNumber}`;
              // F5.3 (2026-06-09): canonicas F1. Trigger del mail Colecta cuando el envio sale de IMPRESO hacia el ciclo del courier.
              if (envio.estadoActual === "IMPRESO" && (estadoShiproLimpio === "PAQUETE_RECOLECTADO" || estadoShiproLimpio === "EN_TRANSITO_A_DESTINO")) {
                enviarMailColecta(emailCliente, envio.trackingNumber, nombreCliente, nombreCourierBaseDatos, urlSeguimiento);
              }
              if (estadoShiproLimpio === "ENTREGADO") {
                enviarMailEntregadoNPS(emailCliente, envio.trackingNumber, nombreCliente, nombreCourierBaseDatos, baseUrl);
              }
            }
            actualizados++;
          } else {
             if (envio.eventos.length > 0) {
                const ultimoMovimiento = envio.eventos[0].fecha;
                const horasInactivo = (new Date().getTime() - new Date(ultimoMovimiento).getTime()) / (1000 * 60 * 60);

                if (horasInactivo >= 36 && envio.tickets.length === 0) {
                    await prisma.ticketSoporte.create({
                        data: {
                            motivo: "Demora sin actualización del Courier (>36hs)",
                            estado: "ABIERTO",
                            observacion: `[Alerta Automática] El paquete lleva ${Math.round(horasInactivo)} horas atascado en el estado: "${envio.estadoActual}". Requiere intervención.`,
                            envioId: envio.id
                        }
                    });
                    ticketsCreados++;
                }
             }
          }
        }
      } catch (error) {
        errores++;
      }
    }

    // ============================================================
    // DEUDA 104 (Movimiento 3/3) — BARRIDO DE REINTENTO del push a Tiendanube.
    // Recupera eventos Tiendanube que NO se pudieron empujar en su momento
    // (sincronizadoTiendanubeEn=null): fallo de red, timeout, Tiendanube 5xx.
    // Acotado: sólo eventos pusheables, de envíos Tiendanube, recientes (ventana
    // DIAS_MAXIMO_REINTENTO_TIENDANUBE), tope LOTE_REINTENTO_TIENDANUBE, oldest-first.
    // Self-contained: su propio try/catch — un fallo del barrido NO invalida la
    // corrida del cron (que ya terminó OK). Cada evento en su propio try/catch.
    // ============================================================
    let reintentosTiendanubeOk = 0;
    let reintentosTiendanubeFallidos = 0;
    try {
      const cutoffReintento = new Date(
        Date.now() - DIAS_MAXIMO_REINTENTO_TIENDANUBE * 24 * 60 * 60 * 1000,
      );
      const eventosParaReintento = await prisma.eventoTracking.findMany({
        where: {
          sincronizadoTiendanubeEn: null,
          fecha: { gte: cutoffReintento },
          estado: { in: Object.keys(MAPEO_ESTADO_TIENDANUBE) },
          envio: {
            tiendanubeOrderId: { not: null },
            tiendanubeFulfillmentOrderId: { not: null },
            tiendanubeStoreId: { not: null },
          },
        },
        orderBy: { fecha: "asc" },
        take: LOTE_REINTENTO_TIENDANUBE,
        include: {
          envio: {
            select: {
              id: true,
              tiendanubeOrderId: true,
              tiendanubeFulfillmentOrderId: true,
              tiendanubeStoreId: true,
            },
          },
        },
      });

      for (const evento of eventosParaReintento) {
        const statusTn = estadoTiendanube(evento.estado);
        if (!statusTn) continue; // defensivo (el where ya filtró, pero por las dudas)
        try {
          const tiendaAuth = await prisma.tiendaTiendanube.findUnique({
            where: { storeId: evento.envio.tiendanubeStoreId! },
            select: { accessToken: true },
          });
          if (!tiendaAuth?.accessToken) {
            reintentosTiendanubeFallidos++;
            continue; // sin token no se puede; queda null para el próximo barrido
          }
          await pushTrackingEvent({
            storeId: evento.envio.tiendanubeStoreId!,
            orderId: evento.envio.tiendanubeOrderId!,
            fulfillmentOrderId: evento.envio.tiendanubeFulfillmentOrderId!,
            accessToken: decryptSecret(tiendaAuth.accessToken),
            status: statusTn,
            description: displayCourier(evento.estado as any),
            happenedAt: evento.fecha,
          });
          await prisma.eventoTracking.update({
            where: { id: evento.id },
            data: { sincronizadoTiendanubeEn: new Date() },
          });
          reintentosTiendanubeOk++;
        } catch (reintentoErr) {
          // Deja sincronizadoTiendanubeEn=null → el próximo barrido reintenta.
          reintentosTiendanubeFallidos++;
          console.error("[cron rastreo] reintento push Tiendanube falló:", {
            eventoId: evento.id, envioId: evento.envio.id,
            err: reintentoErr instanceof Error ? reintentoErr.message : String(reintentoErr).slice(0, 200),
          });
        }
      }
      if (eventosParaReintento.length > 0) {
        console.log("[cron rastreo] barrido reintento Tiendanube:", {
          encontrados: eventosParaReintento.length,
          ok: reintentosTiendanubeOk,
          fallidos: reintentosTiendanubeFallidos,
        });
      }
    } catch (barridoErr) {
      // Un fallo del barrido (ej. la query) NO invalida la corrida — log + seguir al return.
      console.error("[cron rastreo] barrido de reintento Tiendanube falló (no crítico):", {
        err: barridoErr instanceof Error ? barridoErr.message : String(barridoErr).slice(0, 200),
      });
    }

    return NextResponse.json({
      mensaje: "Ronda de rastreo finalizada",
      procesados: enviosARastrear.length,
      actualizados: actualizados,
      alertasCreadas: ticketsCreados,
      errores: errores,
      reintentosTiendanubeOk: reintentosTiendanubeOk,
      reintentosTiendanubeFallidos: reintentosTiendanubeFallidos,
    });

  } catch (error) {
    return NextResponse.json({ error: "Error interno al ejecutar el rastreo" }, { status: 500 });
  }
}