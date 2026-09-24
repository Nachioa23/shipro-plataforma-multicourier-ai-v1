// ============================================================================
// MEF Fase 2.3.c (2026-09-23) — Worker que rutea NotificacionFlex "valido" o
// "accion_requerida" a Envío real via crearEnvio. [[DEUDA 180]]
//
// RESTRUCTURE Chat D 2026-09-23 (money-critical review):
//   Una venta Flex NO RUTEABLE NO se convierte en Envío. Queda en el BUZÓN
//   NotificacionFlex con estado="accion_requerida" + causaFlex=<causa
//   específica>. El worker re-escanea "accion_requerida" en cada corrida: si
//   el vendedor destraba la causa (agrega zona, asigna courier, etc.), la
//   próxima corrida rutea + crea el Envío + pasa a "procesada".
//
//   Envíos SÓLO se crean vía crearEnvio con un courier REAL en `Courier`. No
//   hay envíos placeholder ni con causa Flex — grep-verifiable: cero uso del
//   API de creación directa de envío en este archivo (el único create de
//   Envío pasa por crearEnvio, que es el motor único).
//
// 🔒 SIN TRATAMIENTO ESPECIAL DE PLATA. Flex NO tiene SMO exento, NO Rama B
// guard, NO flag canal-aware. El motor (crearEnvio → cotizador) cobra según
// rama de CredencialCourier(empresaId, courierAsignado) — como cualquier envío.
//
// NEVER LOSE THE SALE:
//   - ok + datos completos → crearEnvio (real courier, motor cobra por rama).
//   - resolver !ok (cp_no_matchea/zona_sin_courier/sin_zonas_flex/anomalo)
//     → notif estado="accion_requerida" + causaFlex=<mapeo>.
//   - cpDestino null → notif "accion_requerida" + causaFlex="flex_cp_no_extraido".
//   - datos payload incompletos (sin destinatario o peso) → notif
//     "accion_requerida" + causaFlex="flex_datos_incompletos".
//   - sin_cuenta_ml / input_invalido → skip + log (no debería llegar).
//
// IDEMPOTENCIA (2 CAPAS, sólo happy path):
//   1. Guard early-out: findFirst por Envio.mercadolibreShipmentId (@@index)
//      ANTES de llamar crearEnvio — evita entrar al débito si ya existe.
//   2. crearEnvio recibe idempotencyKey="mef-${shipmentId}" — la BD tiene
//      @@unique([empresaId, idempotencyKey]) como red final anti-race.
// ============================================================================

import prisma from "@/lib/prisma";
import { crearEnvio, type CrearEnvioInput } from "@/lib/envios/crear";
import { resolverCourierPorCpFlex } from "@/lib/mercadolibre/resolver-courier-zona";
import {
  ESTADOS_BLOQUEO_FLEX,
  esCausaReescaneable,
  type CausaNotificacionFlexKey,
} from "@/lib/utils/estados";

export type ResultadoProcesarNotificacionFlex =
  | { ok: true; envioId: number; motivo: "creado" | "ya_existia" }
  | { ok: true; motivo: "accion_requerida"; causa: CausaNotificacionFlexKey }
  | { ok: false; motivo: "skipped"; causa: string }
  | { ok: false; motivo: "error"; causa: string };

// Estados de NotificacionFlex que el worker Flex procesa. Incluye "valido"
// (nuevas notifs) + "accion_requerida" (notifs previamente bloqueadas — se
// re-escanean cada corrida por si el vendedor destrabó la causa).
export const ESTADOS_NOTIF_A_PROCESAR: readonly string[] = [
  "valido",
  "accion_requerida",
];

// ----------------------------------------------------------------------------
// Extracción defensiva del payload ML (shape variable).
// ----------------------------------------------------------------------------

interface ReceiverAddressLike {
  receiver_name?: unknown;
  address_line?: unknown;
  street_name?: unknown;
  street_number?: unknown;
  comment?: unknown;
  zip_code?: unknown;
  city?: { name?: unknown } | unknown;
  state?: { name?: unknown } | unknown;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function nombreFrom(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (v && typeof v === "object" && "name" in v) {
    const name = (v as any).name;
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
  }
  return null;
}

// ============================================================================
// Marca la NotificacionFlex con el estado que corresponda según la causa:
//   - causa RE-ESCANEABLE  → estado="accion_requerida"           (worker la lifta)
//   - causa ESTANCADA      → estado="accion_requerida_estancada" (worker NO la lifta)
//
// Anti-starvation (fix 2026-09-24): las estancadas se sacan del filtro del
// worker (ESTADOS_NOTIF_A_PROCESAR) → no ocupan slots del batch cada corrida.
// El set canónico vive en lib/utils/estados.ts (esCausaReescaneable).
// ============================================================================
async function marcarAccionRequerida(
  notifId: number,
  causa: CausaNotificacionFlexKey,
  contexto: Record<string, unknown>,
): Promise<void> {
  const estadoTarget = esCausaReescaneable(causa)
    ? "accion_requerida"
    : "accion_requerida_estancada";
  await prisma.notificacionFlex.update({
    where: { id: notifId },
    data: {
      estado: estadoTarget,
      causaFlex: ESTADOS_BLOQUEO_FLEX[causa].key,
    },
  });
  console.warn(
    `[crear-envio-flex] notif ${notifId} → ${estadoTarget} (${ESTADOS_BLOQUEO_FLEX[causa].key})`,
    contexto,
  );
}

// ============================================================================
// Marca la NotificacionFlex como "procesada" — feliz path + guard idempotente.
// Además limpia causaFlex (una notif que estaba en accion_requerida y ahora
// se destrabó no debe conservar su causa vieja).
// ============================================================================
async function marcarProcesada(notifId: number): Promise<void> {
  try {
    await prisma.notificacionFlex.update({
      where: { id: notifId },
      data: {
        estado: "procesada",
        causaFlex: null,
        procesadaEn: new Date(),
      },
    });
  } catch (e) {
    console.warn(
      `[crear-envio-flex] no pude marcar notif=${notifId} como procesada:`,
      e instanceof Error ? e.message : String(e).slice(0, 200),
    );
  }
}

// ============================================================================
// Path feliz: llama crearEnvio con courier REAL. El motor decide rama por
// CredencialCourier(empresaId, nombreCourier). CERO tratamiento especial
// de plata acá.
// ============================================================================
async function llamarCrearEnvioFlex(params: {
  empresaId: number;
  shipmentId: string;
  mlOrderId: string | null;
  cpDestino: string;
  nombreCourier: string;
  payload: any;
}): Promise<
  | { ok: true; envioId: number }
  | { ok: false; causaDatos: CausaNotificacionFlexKey; contexto: Record<string, unknown> }
> {
  const { empresaId, shipmentId, mlOrderId, cpDestino, nombreCourier, payload } = params;

  const receiver: ReceiverAddressLike | undefined =
    payload?.receiver_address && typeof payload.receiver_address === "object"
      ? (payload.receiver_address as ReceiverAddressLike)
      : undefined;
  const destinatarioNombre =
    stringOrNull(receiver?.receiver_name) ??
    stringOrNull(payload?.receiver?.name);
  const calle =
    stringOrNull(receiver?.street_name) ?? stringOrNull(receiver?.address_line);
  const altura = stringOrNull(receiver?.street_number);
  const dpto = stringOrNull(receiver?.comment);
  const localidad = nombreFrom(receiver?.city);
  const provincia = nombreFrom(receiver?.state);

  // Peso: preferir shipping_option.declared_weight (gramos) → kg. Fallback:
  // sum de shipping_items[].weight (gramos) → kg.
  let pesoKg: number | null = null;
  const declaredG = Number(payload?.shipping_option?.declared_weight);
  if (Number.isFinite(declaredG) && declaredG > 0) {
    pesoKg = declaredG / 1000;
  } else if (Array.isArray(payload?.shipping_items)) {
    const suma = payload.shipping_items.reduce((acc: number, it: any) => {
      const w = Number(it?.dimensions?.weight ?? it?.weight);
      return acc + (Number.isFinite(w) && w > 0 ? w : 0);
    }, 0);
    if (suma > 0) pesoKg = suma / 1000;
  }

  // Sin destinatario o sin peso → no puede rutearse. Notif accion_requerida.
  if (!destinatarioNombre || pesoKg === null || pesoKg <= 0) {
    return {
      ok: false,
      causaDatos: "flex_datos_incompletos",
      contexto: {
        tieneDestinatarioNombre: !!destinatarioNombre,
        tienePeso: pesoKg !== null && pesoKg > 0,
      },
    };
  }

  const input: CrearEnvioInput = {
    empresaId,
    destinatarioNombre,
    cpDestino,
    pesoReal: pesoKg,
    nombreCourier,
    calle: calle ?? undefined,
    altura: altura ?? undefined,
    dpto: dpto ?? undefined,
    localidad: localidad ?? undefined,
    provinciaDestino: provincia ?? undefined,
    numeroOrden: mlOrderId ?? undefined,
    idempotencyKey: `mef-${shipmentId}`,
    mercadolibreShipmentId: shipmentId,
    mercadolibreOrderId: mlOrderId,
    // E-commerce contract: si falta depósito/credencial/operatividad/saldo,
    // el motor bloquea con su estado BLOQUEADO_* legacy y SHP-* tracking
    // (procesarEnviosBloqueados* lo destraba). Ese es un Envío REAL con
    // courier REAL, no un placeholder.
    permitirBloqueoPorDeposito: true,
  };

  const resultado: any = await crearEnvio(input);
  const envioId = Number(resultado?.id);
  if (!Number.isInteger(envioId)) {
    throw new Error(
      `crearEnvio no devolvió envio.id — shipmentId=${shipmentId}`,
    );
  }
  return { ok: true, envioId };
}

// ============================================================================
// Procesa UNA NotificacionFlex en estado "valido" o "accion_requerida".
// Idempotente + best-effort.
// ============================================================================
export async function procesarNotificacionFlex(
  notificacionId: number,
): Promise<ResultadoProcesarNotificacionFlex> {
  const notif = await prisma.notificacionFlex.findUnique({
    where: { id: notificacionId },
    select: {
      id: true,
      notificacionId: true,
      shipmentId: true,
      empresaId: true,
      estado: true,
    },
  });
  if (!notif) {
    return { ok: false, motivo: "skipped", causa: "notificacion no encontrada" };
  }
  if (!ESTADOS_NOTIF_A_PROCESAR.includes(notif.estado)) {
    return {
      ok: false,
      motivo: "skipped",
      causa: `estado ${notif.estado} no procesable`,
    };
  }
  if (!notif.shipmentId || notif.empresaId === null) {
    return {
      ok: false,
      motivo: "skipped",
      causa: "shipmentId o empresaId ausente",
    };
  }
  const shipmentId = notif.shipmentId;
  const empresaId = notif.empresaId;

  // CAPA 1 idempotencia: guard early-out por Envio.mercadolibreShipmentId
  // (evita entrar al motor si ya existe). Cubre el caso donde la corrida
  // anterior creó el Envío pero falló al marcar procesada — el próximo
  // scan lo detecta y transiciona a procesada limpio.
  const yaCreado = await prisma.envio.findFirst({
    where: { empresaId, mercadolibreShipmentId: shipmentId },
    select: { id: true },
  });
  if (yaCreado) {
    await marcarProcesada(notif.id);
    return { ok: true, envioId: yaCreado.id, motivo: "ya_existia" };
  }

  // Cargar el ShipmentFlex (persistido por el receiver retrofit).
  const shipment = await prisma.shipmentFlex.findUnique({
    where: { shipmentId },
    select: {
      cpDestino: true,
      payloadRaw: true,
      estadoShipment: true,
    },
  });

  const mlOrderId =
    shipment && shipment.payloadRaw
      ? stringOrNull((shipment.payloadRaw as any)?.order_id)
      : null;

  // cpDestino null → accion_requerida flex_cp_no_extraido.
  if (!shipment || !shipment.cpDestino) {
    await marcarAccionRequerida(notif.id, "flex_cp_no_extraido", {
      shipmentPersistido: !!shipment,
    });
    return { ok: true, motivo: "accion_requerida", causa: "flex_cp_no_extraido" };
  }

  // Resolver 2.3.a — variantes.
  const resolucion = await resolverCourierPorCpFlex(empresaId, shipment.cpDestino);
  if (!resolucion.ok) {
    switch (resolucion.motivo) {
      case "cp_no_matchea":
        await marcarAccionRequerida(notif.id, "flex_fuera_cobertura", {
          motivo: resolucion.motivo,
        });
        return { ok: true, motivo: "accion_requerida", causa: "flex_fuera_cobertura" };
      case "zona_sin_courier":
        await marcarAccionRequerida(notif.id, "flex_zona_sin_courier", {
          motivo: resolucion.motivo,
          zoneIdMl: resolucion.zoneIdMl,
          zonaNombre: resolucion.zonaNombre,
        });
        return { ok: true, motivo: "accion_requerida", causa: "flex_zona_sin_courier" };
      case "sin_zonas_flex":
        await marcarAccionRequerida(notif.id, "flex_sin_config", {
          motivo: resolucion.motivo,
        });
        return { ok: true, motivo: "accion_requerida", causa: "flex_sin_config" };
      case "anomalo":
        await marcarAccionRequerida(notif.id, "flex_anomalo", {
          motivo: resolucion.motivo,
          zoneIds: resolucion.zoneIds,
        });
        return { ok: true, motivo: "accion_requerida", causa: "flex_anomalo" };
      case "sin_cuenta_ml":
      case "input_invalido":
        // No debería llegar acá — receiver Fase 1 filtra estas antes. Skip + log,
        // NO transición: dejamos la notif en su estado actual para que se investigue.
        console.warn(
          `[crear-envio-flex] Motivo inesperado en '${notif.estado}' notif=${notif.id}: ${resolucion.motivo}`,
        );
        return {
          ok: false,
          motivo: "skipped",
          causa: `motivo inesperado: ${resolucion.motivo}`,
        };
    }
  }

  // Path feliz: llamar crearEnvio con courier REAL. El motor cobra según rama.
  try {
    const result = await llamarCrearEnvioFlex({
      empresaId,
      shipmentId,
      mlOrderId,
      cpDestino: shipment.cpDestino,
      nombreCourier: resolucion.courierNombre,
      payload: shipment.payloadRaw,
    });
    if (!result.ok) {
      // Datos incompletos del payload → notif accion_requerida (NO envío).
      await marcarAccionRequerida(notif.id, result.causaDatos, result.contexto);
      return { ok: true, motivo: "accion_requerida", causa: result.causaDatos };
    }
    await marcarProcesada(notif.id);
    return { ok: true, envioId: result.envioId, motivo: "creado" };
  } catch (e) {
    console.error(
      `[crear-envio-flex] crearEnvio falló para shipmentId=${shipmentId}:`,
      e instanceof Error ? e.message : String(e).slice(0, 300),
    );
    // No marcamos accion_requerida ni procesada — worker reintentará en la
    // próxima corrida. Errores transient (BD down, cotizador timeout, etc.)
    // se autorresuelven; errores estables (courier missing, credencial ausente)
    // los captura el motor con sus BLOQUEADO_* legacy y crea el Envío igual
    // (no llega a este catch en ese caso).
    return {
      ok: false,
      motivo: "error",
      causa: e instanceof Error ? e.message : "error crearEnvio",
    };
  }
}

// ============================================================================
// Batch — mirror byte-a-byte del sync-zonas: findMany + Promise.allSettled.
// Una fila fallida NO aborta el batch. Escanea SOLO estados re-procesables:
// "valido" (nuevas) y "accion_requerida" (re-scan por si el vendedor destrabó
// una causa RE-ESCANEABLE — zona_sin_courier/sin_config/cp_no_extraido/
// datos_incompletos). Las estancadas viven en "accion_requerida_estancada" y
// NO entran al batch (anti-starvation, fix 2026-09-24).
//
// TERMINACIÓN DEL LOOP:
//   - Notif ruteable → estado="procesada", causaFlex=null → NO se re-escanea.
//   - Notif con causa RE-ESCANEABLE → estado="accion_requerida" → se re-escanea
//     próxima corrida; si la causa persiste, transición idempotente (mismo
//     estado + misma causa). Cuando el vendedor destraba o Chat A arregla el
//     extractor de payload, la corrida siguiente rutea + pasa a "procesada".
//   - Notif con causa ESTANCADA → estado="accion_requerida_estancada" → NO se
//     re-escanea. Requiere intervención manual (botón admin / investigación).
//   - Notif con error transient → sin cambio de estado → reintento próximo run.
// ============================================================================

export async function procesarNotificacionesFlexPendientes(
  limit = 100,
): Promise<{
  procesadas: number;
  creadas: number;
  accionRequerida: number;
  yaExistian: number;
  errores: number;
  skipped: number;
}> {
  const pendientes = await prisma.notificacionFlex.findMany({
    where: { estado: { in: [...ESTADOS_NOTIF_A_PROCESAR] } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  const resultados = await Promise.allSettled(
    pendientes.map((n) => procesarNotificacionFlex(n.id)),
  );

  let creadas = 0,
    accionRequerida = 0,
    yaExistian = 0,
    errores = 0,
    skipped = 0;
  for (const r of resultados) {
    if (r.status === "rejected") {
      errores++;
      continue;
    }
    const v = r.value;
    if (v.ok) {
      if (v.motivo === "creado") creadas++;
      else if (v.motivo === "ya_existia") yaExistian++;
      else if (v.motivo === "accion_requerida") accionRequerida++;
    } else {
      if (v.motivo === "skipped") skipped++;
      else errores++;
    }
  }

  return {
    procesadas: pendientes.length,
    creadas,
    accionRequerida,
    yaExistian,
    errores,
    skipped,
  };
}
