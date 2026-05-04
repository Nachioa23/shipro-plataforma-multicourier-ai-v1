import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import type { CredencialCourier } from "@prisma/client";

export interface DispatchInput {
  credencial: CredencialCourier;
  courierNombreCanonico: string;
  destinatarioNombre: string;
  calle: string;
  altura: string;
  piso?: string;
  dpto?: string;
  localidad: string;
  provincia?: string;
  cp: string;
  dni: string;
  email: string;
  telefono: string;
  pesoReal: number;
  valorDeclarado: number;
  modalidad?: string;
  numeroOrden?: string | null;
  // DEUDA 4: datos del depósito de origen para imprimir en la etiqueta del courier.
  // Si no viene, los adapters caen al fallback hardcoded.
  origen?: {
    calle: string;
    altura: string;
    cp: string;
    localidad: string;
    provincia: string;
    pais?: string;
    telefono?: string;
    email?: string;
  };
}

export interface DispatchResult {
  tracking: string | null;
  etiquetaUrl: string | null;
  trackingFirstMile: string | null;
  error?: string;
}

/**
 * Despacha un envío al courier (main + microhub si aplica) y retorna
 * el tracking real + URL de etiqueta. Centraliza la lógica que antes
 * vivía solo en crear.ts. Reusada por procesar-bloqueados.ts.
 *
 * NO modifica BD. NO valida saldo. NO manda mails. El caller decide
 * qué hacer con el resultado.
 *
 * Tolera fallas del courier devolviendo `tracking: null` + `error`.
 * No lanza excepciones (siempre retorna un resultado parseable).
 */
export async function despacharCourier(input: DispatchInput): Promise<DispatchResult> {
  const { credencial, courierNombreCanonico } = input;

  if (!credencial.activo) {
    return { tracking: null, etiquetaUrl: null, trackingFirstMile: null, error: "Credencial inactiva" };
  }

  const courierNombreLimpio = normalizarParaComparacion(courierNombreCanonico);

  try {
    // Si el cliente usa credenciales propias y son inválidas, parsearCredencialesPropias
    // lanza un error que cae al catch de abajo. NO hay fallback automático a Shipro
    // (política de protección financiera).
    const llavesMain = credencial.usaCredencialesPropias
      ? parsearCredencialesPropias(courierNombreLimpio, credencial.credencialesJson)
      : obtenerCredencialesShipro(courierNombreLimpio);

    const motorMain = CourierFactory.crear(courierNombreLimpio, llavesMain);

    let tipoEntregaFormateado: "sucursal" | "domicilio" | "inversa" | "cambio" = "domicilio";
    const mod = input.modalidad?.toLowerCase() || "";
    if (mod.includes('sucursal')) tipoEntregaFormateado = "sucursal";
    if (mod.includes('inversa') || mod.includes('devolucion')) tipoEntregaFormateado = "inversa";
    if (mod.includes('cambio')) tipoEntregaFormateado = "cambio";

    const paramsDespacho = {
      destinatarioNombre: input.destinatarioNombre,
      calle: input.calle,
      altura: input.altura,
      piso: input.piso,
      dpto: input.dpto,
      localidad: input.localidad,
      provincia: input.provincia,
      cp: input.cp,
      dni: input.dni,
      email: input.email,
      telefono: input.telefono,
      peso: input.pesoReal || 1,
      paquetes: [{
        pesoKg: input.pesoReal || 1, largoCm: 10, anchoCm: 10, altoCm: 10,
        valorDeclarado: input.valorDeclarado || 0, requiereSeguro: credencial.requiereSeguro
      }],
      referencia: input.numeroOrden ? `ORDEN-${input.numeroOrden}` : `ORDEN-${Date.now()}`,
      tipoEntrega: tipoEntregaFormateado,
      origen: input.origen,  // DEUDA 4: datos del depósito real (puede ser undefined → adapter usa fallback)
    };

    const respuestaMain = await motorMain.despachar(paramsDespacho);
    const tracking = respuestaMain?.tracking || null;
    const etiquetaUrl = respuestaMain?.etiquetaUrl || null;

    if (!tracking) {
      return { tracking: null, etiquetaUrl: null, trackingFirstMile: null, error: "Courier no devolvió tracking" };
    }

    // First-mile (recolector microhub) — 3 casos: mismo, dropoff, microhub.
    let trackingFirstMile: string | null = null;
    const recolector = credencial.courierRecolector?.trim() || "";
    const recolectorLower = recolector.toLowerCase();
    const mainNombreLower = credencial.nombreCourier?.toLowerCase() || "";

    const esMismoCourier =
      !recolector ||
      recolectorLower === "mismo_courier" ||
      recolectorLower === "pickup" ||
      recolectorLower === mainNombreLower;

    const esDropoff = recolectorLower === "dropoff";

    if (!esMismoCourier && !esDropoff) {
      try {
        const courierMicrohub = recolectorLower === "shipro_cross" ? "mocis" : recolector;
        const llavesRecolector = obtenerCredencialesShipro(courierMicrohub);
        const motorRecolector = CourierFactory.crear(courierMicrohub, llavesRecolector);

        const paramsRecolector = { ...paramsDespacho, referencia: `FIRST-MILE: ${tracking}` };
        const respuestaRecolector = await motorRecolector.despachar(paramsRecolector);

        if (respuestaRecolector?.tracking) {
          trackingFirstMile = respuestaRecolector.tracking;
        }
      } catch (errFirstMile) {
        // First-mile no rompe el envío principal. Solo logueamos.
        console.warn(`[Shipro] First-mile falló para tracking ${tracking}:`, errFirstMile);
      }
    }

    return { tracking, etiquetaUrl, trackingFirstMile };

  } catch (err: any) {
    console.warn(`[Shipro] Despacho falló para courier ${courierNombreCanonico}:`, err?.message || err);
    return { tracking: null, etiquetaUrl: null, trackingFirstMile: null, error: err?.message || "Error en despacho" };
  }
}
