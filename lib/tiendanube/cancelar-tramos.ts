// =============================================================================
// DEUDA 104 (/cancel) — Helper compartido para cancelar los tramos de un envío
// en el/los courier(s) correspondiente(s).
// =============================================================================
// Extraído para que el endpoint /cancel de Tiendanube reuse EXACTAMENTE la
// misma lógica que ya funciona en el flow interno (app/api/envios/cancelar).
// NO se refactoriza el flow interno en este commit — sólo se comparte el core.
//
// Reglas (mirror del internal route L52-89):
//   1. Filtrar tramos con trackingExterno (los SHP-* / pre-despacho no aplican).
//   2. Por tramo, decidir credenciales:
//        - Si tramo.courierId === envio.courierId (Last-Mile visible al comprador)
//          → obtener credencial del cliente para ese courier; si usaCredencialesPropias
//            → parsearCredencialesPropias(); si no → obtenerCredencialesShipro().
//        - Si es tramo previo (consolidador, ej. Mocis para Andreani) → SIEMPRE
//          Shipro master creds.
//   3. CourierFactory.crear(nombre, llaves).cancelarEnvio(trackingExterno).
//      Los adapters divergen en convención de falla (Andreani throws, Mocis
//      returns false) — el try/catch AROUND the boolean check maneja ambos.
//   4. Contadores tramosCancelados / tramosFallidos. mensajeCourier retiene el
//      último error humano visto (para pasar al reason.message del veredicto).
//
// SEMÁNTICA DEL RESULT:
//   - `ok: true` sólo si TODOS los tramos con trackingExterno cancelaron. Si
//     tramosConTracking.length === 0 → `ok: true` (nada que cancelar = éxito
//     idempotente; matches el fast-path para etiquetas provisorias / pre-despacho).
//   - `ok: false` si algún tramo falló. `mensajeCourier` trae el último mensaje
//     de error humano recolectado, para armar el reason del /cancel response
//     y el ticket + auditoría.
//
// Este helper NO toca el estado del envío ni escribe EventoTracking — sólo
// llama al courier. La política de "marcar Shipro CANCELADO igual" vive en el
// caller (mismo espíritu del internal route: Shipro es fuente de verdad).
// =============================================================================

import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { obtenerCredencialCourier, normalizarParaComparacion } from "@/lib/couriers/normalizar";

export interface ResultadoCancelacionCourier {
  /** true = todos los tramos con tracking cancelaron; false = alguno falló. */
  ok: boolean;
  tramosCancelados: number;
  tramosFallidos: number;
  /** Último mensaje humano del courier (data.message / Error.message). null si OK. */
  mensajeCourier: string | null;
}

/**
 * Firma del envío que el helper necesita. Se declara acá (no se importa de Prisma)
 * para desacoplarnos del tipo generado — el caller pasa la data que ya cargó via
 * su propio include. Todo lo demás del envío es irrelevante para cancelar.
 */
export interface EnvioParaCancelar {
  id: number;
  empresaId: number;
  courierId: number;
  tramos: Array<{
    orden: number;
    trackingExterno: string | null;
    courierId: number;
    courier: { nombre: string };
  }>;
}

export async function cancelarTramosEnCourier(
  envio: EnvioParaCancelar,
): Promise<ResultadoCancelacionCourier> {
  const tramosConTracking = envio.tramos.filter((t) => t.trackingExterno);

  // Fast-path: nada que cancelar en el courier (SHP-* provisoria, pre-despacho,
  // envío bloqueado). Es un éxito idempotente — el caller marca Shipro CANCELADO
  // y listo, no hay courier al que llamar.
  if (tramosConTracking.length === 0) {
    return { ok: true, tramosCancelados: 0, tramosFallidos: 0, mensajeCourier: null };
  }

  let tramosCancelados = 0;
  let tramosFallidos = 0;
  let mensajeCourier: string | null = null;

  for (const tramo of tramosConTracking) {
    const nombreCourierTramo = normalizarParaComparacion(tramo.courier.nombre);

    // Resolución de credenciales (mirror del internal route):
    //   - Last-Mile visible al comprador (tramo.courierId === envio.courierId) → creds del cliente.
    //   - Consolidador previo (Mocis → Andreani, etc.) → siempre Shipro.
    let llaves: unknown;
    if (tramo.courierId === envio.courierId) {
      const credencial = await obtenerCredencialCourier(envio.empresaId, tramo.courier.nombre);
      llaves = credencial?.usaCredencialesPropias
        ? parsearCredencialesPropias(nombreCourierTramo, credencial.credencialesJson)
        : obtenerCredencialesShipro(nombreCourierTramo);
    } else {
      llaves = obtenerCredencialesShipro(nombreCourierTramo);
    }

    try {
      const motor = CourierFactory.crear(nombreCourierTramo, llaves);
      const cancelado = await motor.cancelarEnvio(tramo.trackingExterno!);
      if (cancelado) {
        tramosCancelados++;
        console.log(
          `[cancelarTramosEnCourier] Tramo ${tramo.orden} (${tramo.courier.nombre}) tracking ${tramo.trackingExterno} cancelado.`,
        );
      } else {
        tramosFallidos++;
        // Sin mensaje: los adapters que devuelven false ya loguearon el detalle
        // internamente (ver MocisAdapter). Marcamos rechazo genérico.
        mensajeCourier = `${tramo.courier.nombre} rechazó la cancelación de ${tramo.trackingExterno}`;
        console.warn(
          `[cancelarTramosEnCourier] Tramo ${tramo.orden} (${tramo.courier.nombre}) rechazó cancelación de ${tramo.trackingExterno}.`,
        );
      }
    } catch (error: any) {
      tramosFallidos++;
      const msg = error?.message ?? String(error);
      mensajeCourier = `${tramo.courier.nombre}: ${msg}`;
      console.warn(
        `[cancelarTramosEnCourier] Tramo ${tramo.orden} (${tramo.courier.nombre}) error cancelando ${tramo.trackingExterno}:`,
        msg,
      );
    }
  }

  return {
    ok: tramosFallidos === 0,
    tramosCancelados,
    tramosFallidos,
    mensajeCourier,
  };
}
