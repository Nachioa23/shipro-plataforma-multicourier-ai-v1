import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import type { CredencialCourier, Deposito, DepositoCourierConfig } from "@prisma/client";
import prisma from "@/lib/prisma";

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

  // === DEUDA 29 Sub-fase 1.C.2 ===
  // ID del Courier de Last-Mile. Necesario para FK courierId del TramoEnvio que
  // el caller persiste post-despacho.
  courierIdMain: number;

  // Cómo arrancó el envío. Default "recoleccion_courier".
  // - "recoleccion_courier": el courier (mismo o consolidador) retira del depósito.
  // - "drop_off_cliente": el cliente lleva el paquete a una sucursal del Last-Mile.
  tipoOrigen?: "recoleccion_courier" | "drop_off_cliente";

  // Sucursales opcionales (pass-through; UI las pobla en Sub-fase 6).
  sucursalOrigenId?: number | null;
  sucursalDestinoId?: number | null;

  /**
   * DEUDA 29 Sub-fase 2.D.despachar: ID del depósito de origen para resolver
   * la sucursal de imposición preferida del cliente via DepositoSucursalPreferida.
   * Opcional para compatibilidad — si no viene (caller no migrado o caso
   * inversa), no se resuelve la preferencia y el adapter cae al fallback chain
   * (creds.id_sucursal_origen → params.origen → hardcoded).
   */
  depositoId?: number;
  // === DEUDA 29 Sub-fase 6.D.5 (2026-05-20) ===
  // Modelo NUEVO de modalidad de despacho. Si vienen pre-cargados, dispatch
  // los usa con prioridad sobre credencial.modoFirstMile/courierRecolectorId
  // (legacy). Si NO vienen pero sí depositoId, dispatch hace lookup interno.
  // Si no viene ninguno (caso inversa o caller no migrado), fallback legacy.
  deposito?: Deposito;
  config?: DepositoCourierConfig | null;
}

export interface TramoSnapshot {
  orden: number;
  courierId: number;
  tipo: "recoleccion" | "entrega" | "ciclo_completo";
  trackingExterno: string | null;
  sucursalOrigenId?: number | null;
  sucursalDestinoId?: number | null;
}

export interface DispatchResult {
  // Tracking visible al comprador (= último tramo despachado, o null si falló el final).
  tracking: string | null;
  etiquetaUrl: string | null;

  // Snapshot de los tramos efectivamente despachados.
  // - 0 elementos → falla total (caller marca BLOQUEADO_PARCIAL, sin tramos).
  // - 1 elemento → caso A o B exitoso, o caso C con tramo 1 OK + tramo 2 falla
  //   (caller marca BLOQUEADO_PARCIAL + persiste tramo 1).
  // - 2 elementos → caso C con ambos tramos OK.
  // El caller persiste los TramoEnvio dentro de su propia transacción.
  tramos: TramoSnapshot[];

  error?: string;
}

/**
 * Despacha un envío a través de la cadena de couriers (1 o 2 tramos según
 * tipoOrigen + la modalidad del par depósito x courier) y retorna los
 * snapshots de los tramos efectivamente despachados. NO toca BD: el caller
 * persiste los TramoEnvio dentro de su propia transacción para preservar
 * atomicidad.
 *
 * Tres casos según el doc de arquitectura sección 7.1:
 * - Caso A — tipoOrigen="drop_off_cliente": 1 tramo (entrega) en Last-Mile.
 * - Caso B — sin consolidación (default): 1 tramo (ciclo_completo). El
 *   courier configurado retira directo del depósito.
 * - Caso C — DepositoCourierConfig.recogeViaConsolidador=true con
 *   Deposito.courierRecolectorId asignado: 2 tramos (recolección por el
 *   courier recolector + entrega por Last-Mile). Mocis-Andreani agrega
 *   vinculación `set_tracking_code` al final (best-effort).
 *
 * Manejo de fallas: cualquier error devuelve tracking=null y un subset de
 * tramos. El caller debe marcar Envio.estadoActual="BLOQUEADO_PARCIAL" cuando
 * tracking=null y persistir igual lo que haya en tramos[].
 *
 * NO modifica BD (lectura permitida: lookup del courier recolector en Caso C).
 * NO valida saldo. NO manda mails. Tolera fallas devolviendo error parseable.
 *
 * Reusada por: lib/envios/crear.ts, lib/envios/procesar-bloqueados.ts,
 * lib/envios/procesar-bloqueados-deposito.ts.
 */
export async function despacharCourier(input: DispatchInput): Promise<DispatchResult> {
  const { credencial, courierNombreCanonico, courierIdMain } = input;
  const tipoOrigen = input.tipoOrigen ?? "recoleccion_courier";

  if (!credencial.activo) {
    return { tracking: null, etiquetaUrl: null, tramos: [], error: "Credencial inactiva" };
  }

  // === DEUDA 29 Sub-fase 6.D.5: resolución de depósito y config del par ===
  // Prioridad a objetos pre-cargados por el caller. Si solo viene depositoId,
  // dispatch hace lookup interno (backward compat). Si no viene nada (caso
  // inversa o caller legacy), ambos quedan null y se usa el fallback legacy
  // de credencial.modoFirstMile más abajo (decisión de tramos).
  let depositoResuelto: Deposito | null = input.deposito ?? null;
  let configResuelta: DepositoCourierConfig | null = input.config ?? null;

  if (!depositoResuelto && input.depositoId) {
    depositoResuelto = await prisma.deposito.findUnique({
      where: { id: input.depositoId },
    });
  }
  if (!configResuelta && depositoResuelto) {
    configResuelta = await prisma.depositoCourierConfig.findUnique({
      where: {
        depositoId_courierId: {
          depositoId: depositoResuelto.id,
          courierId: courierIdMain,
        },
      },
    });
  }

  // DEUDA 29 Sub-fase 2.E: lookup de Empresa para construir el remitente real
  // que se manda al courier (Andreani usa nombre + cuit en la etiqueta).
  // Edge teórico: la FK garantiza existencia, pero defendemos contra borrado
  // accidental devolviendo error parseable en lugar de explotar.
  const empresa = await prisma.empresa.findUnique({
    where: { id: credencial.empresaId },
    select: { nombre: true, cuit: true },
  });
  if (!empresa) {
    return {
      tracking: null,
      etiquetaUrl: null,
      tramos: [],
      error: `Empresa id=${credencial.empresaId} no encontrada`,
    };
  }

  // DEUDA 29 Sub-fase 2.D.despachar: resolver sucursal de imposición preferida
  // para este (depósito, courier) si está configurada en BD. La preferencia
  // tiene prioridad sobre creds.id_sucursal_origen. Skipear cuando:
  //   - no viene depositoId (caller legacy / logística inversa)
  //   - el courier no maneja sucursales (Mocis: tieneSucursales=false)
  //   - la sucursal preferida fue soft-deleteada (coherente con 2.A: no
  //     limpiar la tabla puente, el runtime tolera y cae al fallback)
  let sucursalOrigenIdExterno: string | undefined;
  if (input.depositoId) {
    const courier = await prisma.courier.findUnique({
      where: { id: input.courierIdMain },
      select: { tieneSucursales: true },
    });

    if (courier?.tieneSucursales) {
      const pref = await prisma.depositoSucursalPreferida.findUnique({
        where: {
          depositoId_courierId: {
            depositoId: input.depositoId,
            courierId: input.courierIdMain,
          },
        },
        include: {
          sucursal: { select: { idExterno: true, eliminada: true } },
        },
      });

      if (pref && !pref.sucursal.eliminada) {
        sucursalOrigenIdExterno = pref.sucursal.idExterno;
      } else if (pref && pref.sucursal.eliminada) {
        console.warn(
          `[dispatch] WARN: DepositoSucursalPreferida ` +
          `(deposito=${input.depositoId}, courier=${input.courierIdMain}) ` +
          `apunta a sucursal eliminada → ignorando preferencia, ` +
          `usando fallback creds.id_sucursal_origen`
        );
      }
    }
  }

  const courierMainNombreLimpio = normalizarParaComparacion(courierNombreCanonico);

  // ============================================================
  // SETUP COMÚN: motor del Last-Mile + paramsDespacho
  // ============================================================
  let motorMain: any;
  let paramsDespacho: any;
  try {
    const llavesMain = credencial.usaCredencialesPropias
      ? parsearCredencialesPropias(courierMainNombreLimpio, credencial.credencialesJson)
      : obtenerCredencialesShipro(courierMainNombreLimpio);
    motorMain = CourierFactory.crear(courierMainNombreLimpio, llavesMain);
    paramsDespacho = construirParamsDespacho(input, empresa, sucursalOrigenIdExterno);
  } catch (err: any) {
    console.warn(`[Shipro] Setup falló para courier ${courierNombreCanonico}:`, err?.message || err);
    return { tracking: null, etiquetaUrl: null, tramos: [], error: err?.message || "Error en setup del despacho" };
  }

  // ============================================================
  // CASO A — drop_off_cliente
  // El cliente lleva el paquete a una sucursal del Last-Mile.
  // 1 tramo: entrega.
  // ============================================================
  if (tipoOrigen === "drop_off_cliente") {
    try {
      const respuesta = await motorMain.despachar(paramsDespacho);
      const tracking = respuesta?.tracking || null;
      const etiquetaUrl = respuesta?.etiquetaUrl || null;

      if (!tracking) {
        return {
          tracking: null,
          etiquetaUrl: null,
          tramos: [],
          error: `Courier ${courierNombreCanonico} no devolvió tracking (drop_off_cliente)`
        };
      }

      const tramo: TramoSnapshot = {
        orden: 1,
        courierId: courierIdMain,
        tipo: "entrega",
        trackingExterno: tracking,
        sucursalOrigenId: input.sucursalOrigenId ?? null,
        sucursalDestinoId: input.sucursalDestinoId ?? null,
      };

      return { tracking, etiquetaUrl, tramos: [tramo] };
    } catch (err: any) {
      console.warn(`[Shipro] Despacho drop_off_cliente falló para ${courierNombreCanonico}:`, err?.message || err);
      return { tracking: null, etiquetaUrl: null, tramos: [], error: err?.message || "Error en despacho drop_off_cliente" };
    }
  }

  // ============================================================
  // CASO C — consolidador
  // Tramo 1: recolector (Mocis u otro). Tramo 2: Last-Mile.
  // Vinculación Mocis-Andreani al final (best-effort).
  // ============================================================
  // === DEUDA 29 Sub-fase 6.D.6: decisión de consolidador (modelo único) ===
  // La modalidad de First-Mile se resuelve a nivel par (depósito x courier):
  // hay consolidación si DepositoCourierConfig.recogeViaConsolidador === true
  // y el depósito tiene un courier recolector asignado. Sin depósito resuelto
  // (caso inversa o caller sin depositoId), no hay consolidación: caso B.
  // El fallback legacy (credencial.modoFirstMile) fue eliminado en 6.D.6.
  const esConsolidadorEfectivo: boolean =
    configResuelta?.recogeViaConsolidador === true &&
    depositoResuelto?.courierRecolectorId != null;
  const recolectorIdEfectivo: number | null =
    depositoResuelto?.courierRecolectorId ?? null;

  if (esConsolidadorEfectivo) {
    if (!recolectorIdEfectivo) {
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [],
        error: "recogeViaConsolidador=true pero no hay courier recolector resuelto"
      };
    }

    // Lookup del courier recolector. Lectura, preserva pureza dispatch.ts ("no escribe BD").
    const courierRecolector = await prisma.courier.findUnique({
      where: { id: recolectorIdEfectivo },
    });
    if (!courierRecolector) {
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [],
        error: `Courier recolector id=${recolectorIdEfectivo} no encontrado`
      };
    }

    const recolectorNombreLimpio = normalizarParaComparacion(courierRecolector.nombre);

    // ----- Tramo 1: recolector -----
    let trackingRecolector: string | null = null;
    let motorRecolector: any;

    try {
      const llavesRecolector = obtenerCredencialesShipro(recolectorNombreLimpio);
      motorRecolector = CourierFactory.crear(recolectorNombreLimpio, llavesRecolector);

      // TODO DEUDA 29 Sub-fase 3: pasar Envio.id como external_reference para idempotencia.
      const paramsRecolector = { ...paramsDespacho, referencia: `RECOLECCION-${Date.now()}` };
      const respuestaRecolector = await motorRecolector.despachar(paramsRecolector);
      trackingRecolector = respuestaRecolector?.tracking || null;
    } catch (errRec: any) {
      console.warn(`[Shipro] Tramo 1 (${recolectorNombreLimpio}) falló:`, errRec?.message || errRec);
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [],
        error: `Tramo 1 (${courierRecolector.nombre}) falló: ${errRec?.message || "error desconocido"}`
      };
    }

    if (!trackingRecolector) {
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [],
        error: `Tramo 1 (${courierRecolector.nombre}) no devolvió tracking`
      };
    }

    const tramo1: TramoSnapshot = {
      orden: 1,
      courierId: courierRecolector.id,
      tipo: "recoleccion",
      trackingExterno: trackingRecolector,
    };

    // ----- Tramo 2: Last-Mile -----
    let trackingMain: string | null = null;
    let etiquetaUrlMain: string | null = null;

    try {
      const respuestaMain = await motorMain.despachar(paramsDespacho);
      trackingMain = respuestaMain?.tracking || null;
      etiquetaUrlMain = respuestaMain?.etiquetaUrl || null;
    } catch (errMain: any) {
      // PARTIAL FAILURE: tramo 1 OK, tramo 2 falla. Persistir tramo 1.
      console.warn(`[Shipro] Tramo 2 (${courierMainNombreLimpio}) falló tras tramo 1 OK:`, errMain?.message || errMain);
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [tramo1],
        error: `Tramo 1 (${courierRecolector.nombre}) OK con tracking ${trackingRecolector}. Tramo 2 (${courierNombreCanonico}) falló: ${errMain?.message || "error desconocido"}`
      };
    }

    if (!trackingMain) {
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [tramo1],
        error: `Tramo 1 (${courierRecolector.nombre}) OK con tracking ${trackingRecolector}. Tramo 2 (${courierNombreCanonico}) no devolvió tracking.`
      };
    }

    // ----- Vinculación Mocis-Andreani (best-effort) -----
    // Si recolector=Mocis Y main=Andreani, vincular trackingRecolector con
    // trackingMain mediante la API de Mocis (set_tracking_code). Si falla,
    // se loggea y el flujo sigue adelante.
    //
    // TODO refactor calidad post-MVP: mover set_tracking_code a MocisAdapter
    // como parámetro opcional vincularConTrackingMain. Mantiene la lógica de
    // vinculación dentro del adapter en lugar de orquestada desde dispatch.ts.
    if (recolectorNombreLimpio === "mocis" && courierMainNombreLimpio === "andreani") {
      try {
        const tokenAdmin = await (motorRecolector as any).getToken();
        const bodyVinculacion = new URLSearchParams();
        bodyVinculacion.append("code", trackingRecolector);
        bodyVinculacion.append("andreani_tracking_codes", `[${trackingMain}]`);
        await fetch(`https://mocis.akeron.net/api/v1/shipping/andreani/set_tracking_code`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${tokenAdmin}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: bodyVinculacion.toString(),
        });
      } catch (errVinc: any) {
        console.warn(`[Shipro] Vinculación Mocis-Andreani falló (best-effort):`, errVinc?.message || errVinc);
      }
    }

    const tramo2: TramoSnapshot = {
      orden: 2,
      courierId: courierIdMain,
      tipo: "entrega",
      trackingExterno: trackingMain,
      sucursalDestinoId: input.sucursalDestinoId ?? null,
    };

    return {
      tracking: trackingMain,
      etiquetaUrl: etiquetaUrlMain,
      tramos: [tramo1, tramo2],
    };
  }

  // ============================================================
  // CASO B — mismo_courier (default)
  // 1 tramo: ciclo_completo. El courier hace todo (recolección + entrega).
  // ============================================================
  try {
    const respuesta = await motorMain.despachar(paramsDespacho);
    const tracking = respuesta?.tracking || null;
    const etiquetaUrl = respuesta?.etiquetaUrl || null;

    if (!tracking) {
      return {
        tracking: null,
        etiquetaUrl: null,
        tramos: [],
        error: `Courier ${courierNombreCanonico} no devolvió tracking`
      };
    }

    const tramo: TramoSnapshot = {
      orden: 1,
      courierId: courierIdMain,
      tipo: "ciclo_completo",
      trackingExterno: tracking,
      sucursalDestinoId: input.sucursalDestinoId ?? null,
    };

    return { tracking, etiquetaUrl, tramos: [tramo] };
  } catch (err: any) {
    console.warn(`[Shipro] Despacho falló para courier ${courierNombreCanonico}:`, err?.message || err);
    return { tracking: null, etiquetaUrl: null, tramos: [], error: err?.message || "Error en despacho" };
  }
}

// ============================================================
// HELPER: construcción de paramsDespacho
// Factorizado del flujo principal para no duplicarlo entre los 3 casos.
// ============================================================
function construirParamsDespacho(
  input: DispatchInput,
  empresa: { nombre: string; cuit: string },
  sucursalOrigenIdExterno?: string
): any {
  let tipoEntregaFormateado: "sucursal" | "domicilio" | "inversa" | "cambio" = "domicilio";
  const mod = input.modalidad?.toLowerCase() || "";
  if (mod.includes('sucursal')) tipoEntregaFormateado = "sucursal";
  if (mod.includes('inversa') || mod.includes('devolucion')) tipoEntregaFormateado = "inversa";
  if (mod.includes('cambio')) tipoEntregaFormateado = "cambio";

  return {
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
      pesoKg: input.pesoReal || 1,
      largoCm: 10,
      anchoCm: 10,
      altoCm: 10,
      valorDeclarado: input.valorDeclarado || 0,
      requiereSeguro: input.credencial.requiereSeguro,
    }],
    // TODO DEUDA 29 Sub-fase 3: pasar Envio.id como external_reference para idempotencia.
    referencia: input.numeroOrden ? `ORDEN-${input.numeroOrden}` : `ORDEN-${Date.now()}`,
    tipoEntrega: tipoEntregaFormateado,
    origen: input.origen,  // DEUDA 4: datos del depósito real (puede ser undefined → adapter usa fallback)
    // DEUDA 29 Sub-fase 2.D.despachar: idExterno de la sucursal preferida del
    // cliente para este depósito × courier (resuelto arriba en despacharCourier).
    // Si undefined, el adapter cae al fallback chain (creds → origen → hardcoded).
    sucursalOrigenId: sucursalOrigenIdExterno,
    // DEUDA 29 Sub-fase 2.E: remitente real desde Empresa (nombre + cuit) y
    // Depósito (telefono + email vía input.origen). Andreani usa estos datos
    // en la etiqueta física. Si falta telefono/email del depósito, el adapter
    // usa fallbacks hardcoded con log warning [andreani] WARN.
    remitente: {
      nombre: empresa.nombre,
      cuit: empresa.cuit,
      telefono: input.origen?.telefono,
      email: input.origen?.email,
    },
  };
}

// ============================================================
// TODOs DEUDA 29 Sub-fase 3 (pendientes para iteración futura)
// ============================================================
// TODO DEUDA 29 Sub-fase 3: error handling diferenciado.
// Hoy: cualquier error → BLOQUEADO_PARCIAL.
// Sub-fase 3: distinguir transitorio (retry con backoff) / validación /
// autorización (BLOQUEADO_CREDENCIALES) según doc 7.2.
//
// TODO DEUDA 29 Sub-fase 3: reintento automático para tramos huérfanos.
// Hoy: tramo persistido en BLOQUEADO_PARCIAL queda esperando intervención manual.
// Sub-fase 3: procesar-bloqueados-parcial similar al patrón saldo/depósito (DEUDA 16).
