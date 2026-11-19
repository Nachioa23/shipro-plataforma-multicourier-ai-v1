// =============================================================================
// aplicarEstadoCourier — el flujo "consumir un estado crudo del courier y
// aplicarlo al envío" extraído del cron de rastreo para poder reusarlo desde
// el receptor de webhook de Pickit (y, a futuro, de cualquier otro push del
// courier). CERO cambio de comportamiento respecto al cron.
//
// Lo que hace, en orden exacto del cron original:
//   1) Guard: estadoCrudo vacío o "DESCONOCIDO" → no-op.
//   2) Resolver estadoShipro via Nomenclador (crea fila estadoShipro:null si
//      falta, para que el operador la mapee luego — mismo drift-log del cron).
//   3) Pre-computar estadoCambio + esRepetible.
//   4) prisma.envio.update: SIEMPRE fechaUltimoRastreo; estadoActual +
//      fechaColecta + fechaEntrega sólo si estadoCambio.
//   5) EventoTracking.create si estadoCambio || esRepetible, con `fuente` que
//      viene del param (el cron pasa COURIER; otros callers pasan la suya).
//   6) Best-effort push Tiendanube si el envío está linkeado (mismo try/catch,
//      mismo marcado sincronizadoTiendanubeEn).
//   7) Si estadoCambio: mails Colecta (trigger IMPRESO→PAQUETE_RECOLECTADO /
//      EN_TRANSITO_A_DESTINO) y Entregado-NPS (trigger ENTREGADO).
//   8) Si NO estadoCambio: alerta de ticket >36hs sin movimiento.
//
// NO hace: skip "SHP-", lookup de credenciales, CourierFactory.crear, ni
// rastrear(). Eso vive arriba (en el cron o en el receptor de webhook — cada
// caller resuelve cómo obtiene el estadoCrudo antes de llamarnos).
// =============================================================================

import prisma from "@/lib/prisma";
import { enviarMailColecta, enviarMailEntregadoNPS } from "@/lib/mailer";
import { ESTADOS_COURIER_REPETIBLES, displayCourier } from "@/lib/utils/estados";
import { pushTrackingEvent } from "@/lib/tiendanube/tracking-api";
import { estadoTiendanube } from "@/lib/tiendanube/tracking-map";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import type { FuenteEvento } from "@/lib/constants/fuente-evento";

// Shape mínimo que el flujo lee del Envio. El cron pasa su `envio` completo
// (structural subtyping: el objeto Prisma tiene estos campos y muchos más).
// Mantenemos esta forma estrecha para que los callers nuevos (ej. receptor
// Pickit) sepan exactamente qué `include` necesitan.
export interface EnvioParaAplicarEstado {
  id: number;
  estadoActual: string;
  trackingNumber: string;
  courierId: number;
  fechaColecta: Date | null;
  fechaEntrega: Date | null;
  tiendanubeOrderId: string | null;
  tiendanubeFulfillmentOrderId: string | null;
  tiendanubeStoreId: number | null;
  destino: { email: string | null; nombre: string | null } | null;
  courier: { nombre: string };
  tickets: { estado: string }[];
  eventos: { fecha: Date }[];
}

export async function aplicarEstadoCourier(params: {
  envio: EnvioParaAplicarEstado;
  estadoCrudo: string;
  fuente: FuenteEvento;
  baseUrl?: string;
}): Promise<{ actualizado: boolean; eventoCreado: boolean; ticketCreado: boolean }> {
  const { envio, estadoCrudo, fuente } = params;
  const baseUrl = params.baseUrl ?? getAppUrlOrThrow();

  if (!estadoCrudo || estadoCrudo === "DESCONOCIDO") {
    return { actualizado: false, eventoCreado: false, ticketCreado: false };
  }

  let estadoShiproLimpio = estadoCrudo;
  let mapeo = await prisma.nomenclador.findUnique({
    where: { courierId_estadoCrudo: { courierId: envio.courierId, estadoCrudo } },
  });

  if (!mapeo) {
    mapeo = await prisma.nomenclador.create({
      data: { courierId: envio.courierId, estadoCrudo, estadoShipro: null },
    });
  }

  if (mapeo && mapeo.estadoShipro) {
    estadoShiproLimpio = mapeo.estadoShipro.replace("S_", "");
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
  const datosAActualizar: any = { fechaUltimoRastreo: new Date() };

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

  let eventoCreado = false;
  let ticketCreado = false;

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
        estadoCrudoOriginal: estadoCrudo,
        observacion: `El courier reportó: ${estadoCrudo}`,
        envioId: envio.id,
        fuente, // dato pulled del adapter del courier (o de otro origen, según caller)
      },
    });
    eventoCreado = true;

    // ---- PUSH a Tiendanube (best-effort, sólo envíos Tiendanube) ----
    // DEUDA 104 Movimiento 2/3: si el envío está linkeado a Tiendanube, empujar el evento al
    // timeline del comprador. Self-contained: cualquier fallo se loguea y el evento queda con
    // sincronizadoTiendanubeEn=null para que el barrido de reintento (Movimiento 3) lo levante.
    // Nunca rompe el flujo del caller ni la lógica existente de tracking/mails.
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
    const nombreCourierBaseDatos = envio.courier.nombre;

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
            envioId: envio.id,
          },
        });
        ticketCreado = true;
      }
    }
  }

  return { actualizado: estadoCambio, eventoCreado, ticketCreado };
}
