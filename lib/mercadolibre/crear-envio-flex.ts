// ============================================================================
// MEF Fase 2.3.c (2026-09-23) — Creador de envíos Flex desde una NotificacionFlex
// en estado "valido". [[DEUDA 180]]
//
// Consume NotificacionFlex.estado="valido" (que trae shipmentId + empresaId
// resueltos por el receiver Fase 1) + su ShipmentFlex asociado (que trae el
// payload del GET /shipments/{id} persistido en el retrofit). Rutea con el
// helper puro resolverCourierPorCpFlex (Fase 2.3.a) y llama crearEnvio con
// el molde Tiendanube: after()-style — worker separado, best-effort per fila.
//
// 🔒 SIN TRATAMIENTO ESPECIAL DE PLATA. Nacho+Chat D 2026-09-23: Flex NO tiene
// SMO exento, NO Rama B guard, NO flag canal-aware. Pasa por el motor de precio
// EXACTAMENTE como cualquier envío — la rama la decide CredencialCourier del
// par (empresa, courier asignado en Fase 2.2). Ver DEUDAS.md nota "SMO exento
// en Flex — premisa REVISADA".
//
// NEVER LOSE THE SALE: cada variante del resolver deja rastro en la BD:
//   - ok                     → crearEnvio (motor cobra según rama del courier).
//   - cp_no_matchea          → Envío BLOQUEADO flex_fuera_cobertura.
//   - zona_sin_courier       → Envío BLOQUEADO flex_zona_sin_courier.
//   - sin_zonas_flex         → Envío BLOQUEADO flex_sin_config.
//   - anomalo                → Envío BLOQUEADO flex_anomalo (FAIL-FAST, no ruteamos).
//   - cpDestino null         → Envío BLOQUEADO flex_cp_no_extraido.
//   - datos payload faltantes → Envío BLOQUEADO flex_datos_incompletos.
//   - sin_cuenta_ml / input_invalido → skip + log (no debería llegar acá; el
//     receiver Fase 1 ya persiste "huerfana" si no hay cuenta).
//
// IDEMPOTENCIA (2 CAPAS):
//   1. Guard early-out: findFirst por Envio.mercadolibreShipmentId (@@index)
//      ANTES de llamar crearEnvio — evita entrar al débito si ya existe.
//   2. crearEnvio recibe idempotencyKey="mef-${shipmentId}" — la BD tiene
//      @@unique([empresaId, idempotencyKey]) como red final anti-race.
// ============================================================================

import prisma from "@/lib/prisma";
import { crearEnvio, type CrearEnvioInput } from "@/lib/envios/crear";
import { resolverCourierPorCpFlex } from "@/lib/mercadolibre/resolver-courier-zona";
import { ESTADOS_BLOQUEO_FLEX } from "@/lib/utils/estados";

// ----------------------------------------------------------------------------
// Nombre del courier canónico para MEF. Requiere que el Courier row exista en
// BD (dado de alta por admin_shipro) + CredencialCourier(empresaId, este nombre)
// activo (config del vendedor en /configuracion/transportes). Sin cualquiera
// de los dos, crearEnvio hará su gate normal (CourierAusente / BLOQUEADO_CREDENCIAL).
// El resolver Fase 2.3.a devuelve el nombre canónico via AsignacionCourierZonaFlex.
// ----------------------------------------------------------------------------

export type ResultadoCrearEnvioFlex =
  | { ok: true; envioId: number; motivo: "creado" | "ya_existia" }
  | { ok: true; envioId: number; motivo: "bloqueado"; causa: string }
  | { ok: false; motivo: "skipped"; causa: string }
  | { ok: false; motivo: "error"; causa: string };

// Nombres del "shape ML" que el receiver persistió en ShipmentFlex.payloadRaw.
// Extracción defensiva — el shape puede variar según ML; si falta un campo
// crítico, bloqueamos con flex_datos_incompletos en lugar de crashear.
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
// Crea un Envío BLOQUEADO con causa Flex-específica. Reserva el `mef-${shipmentId}`
// como idempotencyKey igual que el path feliz, para que un retry del worker
// vea el envío ya existente (guard capa 1) y no lo re-cree como duplicado.
// ============================================================================
async function crearEnvioBloqueadoFlex(params: {
  empresaId: number;
  shipmentId: string;
  mlOrderId: string | null;
  causa: keyof typeof ESTADOS_BLOQUEO_FLEX;
  contexto: Record<string, unknown>;
}): Promise<number> {
  const { empresaId, shipmentId, mlOrderId, causa, contexto } = params;
  // El shape del Envío BLOQUEADO Flex es intencionalmente mínimo: la venta
  // ya ocurrió del lado del comprador ML; el vendedor necesita visibilidad
  // en el dashboard Shipro con la causa clara. Los datos de destinatario/
  // dirección/dims quedan defaulteados a strings vacíos/1 porque el motor de
  // creación es rama-agnóstico y NO gasta dinero en un envío BLOQUEADO_*
  // (crear.ts salta el débito cuando estadoInicialEnvio es BLOQUEADO_).
  //
  // Sin embargo, crearEnvio requiere ciertos campos (empresaId, nombreCourier,
  // cpDestino, pesoReal, destinatarioNombre) — si NO pasan gates internos,
  // throw. Para bloqueos Flex "sin CP" o "sin destinatario", esos gates fallan.
  // Por eso NO llamamos a crearEnvio en estos casos: creamos el Envío
  // directamente por Prisma con todo defaulteado + estadoActual=causa.
  //
  // Trade-off: menor reuso, pero evita re-entrar al motor de creación para
  // shipments incompletos. La visibilidad es igual (aparece en la bandeja
  // BLOQUEADO con causa clara) y NADA se cobra (sin FinanzasEnvio.tarifa).
  const causaKey = ESTADOS_BLOQUEO_FLEX[causa].key;
  // Idempotency guard: si otro run ya creó el envío para este shipment,
  // devolvemos el existente. Findfirst por (empresaId, idempotencyKey) uses
  // el índice compuesto @@unique.
  const idempotencyKey = `mef-${shipmentId}`;
  const existente = await prisma.envio.findFirst({
    where: { empresaId, idempotencyKey },
    select: { id: true },
  });
  if (existente) return existente.id;

  // Necesitamos alguna Direccion.id como destino (schema Envio.destinoId es
  // required-through-relation en el path del create; verificamos en el schema).
  // Envio.destinoId es Int? nullable → PUEDE quedar null en un bloqueo. Buena.
  const trackingNumber = `SHP-BLOQ-${Math.floor(Math.random() * 900000 + 100000)}`;
  const envio = await prisma.envio.create({
    data: {
      trackingNumber,
      empresa: { connect: { id: empresaId } },
      // Courier placeholder: el motor requiere courierId NOT NULL. Elegimos
      // el primer courier activo de BD como placeholder — el envío BLOQUEADO
      // no ejecuta despacho ni débito, es un carril de visibilidad. Si NO
      // existe ningún courier activo, throwea (edge caso config Shipro).
      courier: {
        connect: {
          id: (
            await prisma.courier.findFirstOrThrow({
              where: { activo: true },
              select: { id: true },
              orderBy: { id: "asc" },
            })
          ).id,
        },
      },
      pesoReal: 1,
      estadoActual: causaKey,
      idempotencyKey,
      mercadolibreShipmentId: shipmentId,
      mercadolibreOrderId: mlOrderId,
    },
    select: { id: true },
  });
  console.warn(
    `[crear-envio-flex] Envío BLOQUEADO ${causaKey} envioId=${envio.id} shipmentId=${shipmentId} empresaId=${empresaId}`,
    contexto,
  );
  return envio.id;
}

// ============================================================================
// Path feliz: llama crearEnvio con el molde Tiendanube (idempotencyKey +
// vínculo ML + permitirBloqueoPorDeposito=true). El motor decide rama por
// CredencialCourier(empresaId, nombreCourier).
// ============================================================================
async function crearEnvioFlexHappyPath(params: {
  empresaId: number;
  shipmentId: string;
  mlOrderId: string | null;
  cpDestino: string;
  nombreCourier: string;
  payload: any;
}): Promise<{ envioId: number; motivo: "creado" | "bloqueado"; causa?: string }> {
  const { empresaId, shipmentId, mlOrderId, cpDestino, nombreCourier, payload } = params;

  // Extracción defensiva de fields del payload.
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

  // Peso: preferir shipping_option.declared_weight (gramos) → kg.
  // Fallback: sum de shipping_items[].weight (gramos) → kg.
  // Sin datos: block flex_datos_incompletos.
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

  // Guardrail: sin destinatario o sin peso el envío no puede crearse. Aviso
  // temprano vs esperar que crear.ts throw.
  if (!destinatarioNombre || pesoKg === null || pesoKg <= 0) {
    const envioId = await crearEnvioBloqueadoFlex({
      empresaId,
      shipmentId,
      mlOrderId,
      causa: "flex_datos_incompletos",
      contexto: {
        tieneDestinatarioNombre: !!destinatarioNombre,
        tienePeso: pesoKg !== null && pesoKg > 0,
      },
    });
    return { envioId, motivo: "bloqueado", causa: "flex_datos_incompletos" };
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
    // Vínculo directo Envio ↔ shipment ML (mirror Tiendanube).
    mercadolibreShipmentId: shipmentId,
    mercadolibreOrderId: mlOrderId,
    // E-commerce contract: si falta depósito/credencial/operatividad/saldo,
    // el envío nace BLOQUEADO_* con SHP-* (no rompe la venta ML) y se destraba
    // solo cuando la causa se resuelve (procesarEnviosBloqueados*).
    permitirBloqueoPorDeposito: true,
  };

  const resultado: any = await crearEnvio(input);
  const envioId = Number(resultado?.id);
  if (!Number.isInteger(envioId)) {
    throw new Error(
      `crearEnvio no devolvió envio.id — shipmentId=${shipmentId}`,
    );
  }
  return { envioId, motivo: "creado" };
}

// ============================================================================
// Procesa UNA NotificacionFlex en estado "valido". Idempotente + best-effort.
// ============================================================================
export async function procesarNotificacionFlex(
  notificacionId: number,
): Promise<ResultadoCrearEnvioFlex> {
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
  if (notif.estado !== "valido") {
    return {
      ok: false,
      motivo: "skipped",
      causa: `estado ${notif.estado} != valido`,
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
  // (evita entrar al motor de creación si ya existe).
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

  // cpDestino null → flex_cp_no_extraido. Nunca ruteamos sin CP.
  if (!shipment || !shipment.cpDestino) {
    const envioId = await crearEnvioBloqueadoFlex({
      empresaId,
      shipmentId,
      mlOrderId,
      causa: "flex_cp_no_extraido",
      contexto: { shipmentPersistido: !!shipment },
    });
    await marcarProcesada(notif.id);
    return { ok: true, envioId, motivo: "bloqueado", causa: "flex_cp_no_extraido" };
  }

  // Resolver 2.3.a — variantes de bloqueo dedicadas.
  const resolucion = await resolverCourierPorCpFlex(empresaId, shipment.cpDestino);
  if (!resolucion.ok) {
    let causa: keyof typeof ESTADOS_BLOQUEO_FLEX | null = null;
    let contexto: Record<string, unknown> = { motivo: resolucion.motivo };
    switch (resolucion.motivo) {
      case "cp_no_matchea":
        causa = "flex_fuera_cobertura";
        break;
      case "zona_sin_courier":
        causa = "flex_zona_sin_courier";
        contexto = {
          ...contexto,
          zoneIdMl: resolucion.zoneIdMl,
          zonaNombre: resolucion.zonaNombre,
        };
        break;
      case "sin_zonas_flex":
        causa = "flex_sin_config";
        break;
      case "anomalo":
        causa = "flex_anomalo";
        contexto = { ...contexto, zoneIds: resolucion.zoneIds };
        break;
      case "sin_cuenta_ml":
      case "input_invalido":
        // No debería llegar acá — receiver Fase 1 filtra estas antes. Skip + log.
        console.warn(
          `[crear-envio-flex] Motivo inesperado en 'valido' notif=${notif.id}: ${resolucion.motivo}`,
        );
        await marcarProcesada(notif.id);
        return {
          ok: false,
          motivo: "skipped",
          causa: `motivo inesperado: ${resolucion.motivo}`,
        };
    }
    if (causa === null) {
      // Type-guard defensivo — no debería ejecutarse.
      return { ok: false, motivo: "error", causa: `motivo no manejado: ${resolucion.motivo}` };
    }
    const envioId = await crearEnvioBloqueadoFlex({
      empresaId,
      shipmentId,
      mlOrderId,
      causa,
      contexto,
    });
    await marcarProcesada(notif.id);
    return { ok: true, envioId, motivo: "bloqueado", causa: ESTADOS_BLOQUEO_FLEX[causa].key };
  }

  // Path feliz: llamar crearEnvio. El motor cobra según rama de
  // CredencialCourier(empresaId, resolucion.courierNombre). CERO
  // tratamiento especial de plata acá.
  try {
    const result = await crearEnvioFlexHappyPath({
      empresaId,
      shipmentId,
      mlOrderId,
      cpDestino: shipment.cpDestino,
      nombreCourier: resolucion.courierNombre,
      payload: shipment.payloadRaw,
    });
    await marcarProcesada(notif.id);
    if (result.motivo === "creado") {
      return { ok: true, envioId: result.envioId, motivo: "creado" };
    }
    return {
      ok: true,
      envioId: result.envioId,
      motivo: "bloqueado",
      causa: result.causa ?? "unknown",
    };
  } catch (e) {
    console.error(
      `[crear-envio-flex] crearEnvio falló para shipmentId=${shipmentId}:`,
      e instanceof Error ? e.message : String(e).slice(0, 300),
    );
    // No marcamos procesada — el worker reintentará en la próxima corrida.
    return {
      ok: false,
      motivo: "error",
      causa: e instanceof Error ? e.message : "error crearEnvio",
    };
  }
}

// ============================================================================
// Marca la NotificacionFlex como procesada. Reusa el estado "procesada" que
// ya define NotificacionFlex.estado ("recibida" | "procesada" | "descartada" |
// "error" | "huerfana" | los 5 EstadoNotificacionFlex del catálogo).
// Best-effort: si falla, el worker reintentará y el guard idempotente evita
// el double-create.
// ============================================================================
async function marcarProcesada(id: number): Promise<void> {
  try {
    await prisma.notificacionFlex.update({
      where: { id },
      data: { estado: "procesada", procesadaEn: new Date() },
    });
  } catch (e) {
    console.warn(
      `[crear-envio-flex] no pude marcar notif=${id} como procesada:`,
      e instanceof Error ? e.message : String(e).slice(0, 200),
    );
  }
}

// ============================================================================
// Batch — mirror byte-a-byte del sync-zonas: findMany + Promise.allSettled.
// Una fila fallida NO aborta el batch.
// ============================================================================

export async function procesarNotificacionesFlexPendientes(
  limit = 100,
): Promise<{
  procesadas: number;
  creadas: number;
  bloqueadas: number;
  yaExistian: number;
  errores: number;
  skipped: number;
}> {
  const pendientes = await prisma.notificacionFlex.findMany({
    where: { estado: "valido" },
    select: { id: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  const resultados = await Promise.allSettled(
    pendientes.map((n) => procesarNotificacionFlex(n.id)),
  );

  let creadas = 0,
    bloqueadas = 0,
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
      else if (v.motivo === "bloqueado") bloqueadas++;
    } else {
      if (v.motivo === "skipped") skipped++;
      else errores++;
    }
  }

  return {
    procesadas: pendientes.length,
    creadas,
    bloqueadas,
    yaExistian,
    errores,
    skipped,
  };
}
