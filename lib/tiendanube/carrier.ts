// =============================================================================
// DEUDA 144 — Módulo del Shipping Carrier de Tiendanube.
// =============================================================================
// Crea el carrier en la tienda del cliente y registra sus opciones (una por
// servicio publicado, code = generarCodeServicio — MISMO slug estable que emite
// el rates callback). Idempotente: un solo carrier por tienda (reutiliza el
// shippingCarrierId ya guardado) y no duplica options (diff por code contra los
// ya registrados). Contrato oficial verificado (DEUDA 130):
//   POST {base}/{version}/{store_id}/shipping_carriers                → { id, ... }
//   PUT  {base}/{version}/{store_id}/shipping_carriers/{id}           → { id, ... }   (Momento 3 pieza 2)
//   GET  {base}/{version}/{store_id}/shipping_carriers/{id}/options   → [ { code, ... }, ... ]
//   POST {base}/{version}/{store_id}/shipping_carriers/{id}/options   → { id, ... }
//
// Las options se registran SIN additional_cost/days/free_shipping — esos son
// atributos que el merchant configura desde su panel (recargo, tiempos de
// entrega, umbral de envío gratis). Al carrier lo llamamos "Shipro" (visible
// en el checkout como empresa de envíos; el courier real ya viene en el `name`
// de cada option). Auth: Bearer del accessToken descifrado, pasado en cada call
// (fetchTiendanube inyecta User-Agent + Content-Type pero NO Authorization).
//
// SCOPE DE RECONCILIACIÓN (DEUDA 144 Momento 3 pieza 2): al día de hoy sólo el
// callback_labels_url se garantiza en carriers YA instalados (via PUT quirúrgico
// dentro del orquestador). callback_url, types y name NO se reconcilian en
// re-runs — queda para DEUDA 145 (patrón de reconciliación completa).
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import { apiUrl, authHeaders } from "@/lib/tiendanube/api";
import {
  enumerarServiciosPublicados,
} from "@/lib/tiendanube/servicios-publicados";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

const CARRIER_NAME = "Shipro";

/**
 * Crea el shipping carrier "Shipro" en la tienda. Devuelve el `id` numérico
 * asignado por Tiendanube (lo persistimos como shippingCarrierId string).
 *
 * @param callbackUrl        - URL del rates callback (POST con destino/carrito).
 * @param callbackLabelsUrl  - URL del labels callback (POST cuando el merchant emite etiqueta).
 * @param types              - CSV de types soportados por el carrier. "ship,pickup" | "ship" | "pickup".
 * @throws Error si Tiendanube responde no-2xx.
 */
export async function crearCarrier(
  storeId: number,
  accessToken: string,
  callbackUrl: string,
  callbackLabelsUrl: string,
  types: string,
): Promise<number> {
  const res = await fetchTiendanube(apiUrl(storeId, "shipping_carriers"), {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      name: CARRIER_NAME,
      callback_url: callbackUrl,
      callback_labels_url: callbackLabelsUrl,
      types,
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`crearCarrier HTTP ${res.status}: ${detalle}`.slice(0, 300));
  }
  const data: any = await res.json();
  return Number(data.id);
}

/**
 * PUT quirúrgico sobre un carrier ya existente: sólo actualiza callback_labels_url.
 *
 * DEUDA 144 Momento 3 pieza 2: garantiza el labels callback en carriers que fueron
 * creados ANTES de que existiera este campo (o en cualquier re-install). Se envía un
 * body mínimo con únicamente `callback_labels_url` — los demás campos del carrier
 * (callback_url, types, name) NO se tocan aquí. La reconciliación general de esos
 * otros campos queda para DEUDA 145 (patrón completo).
 *
 * @throws Error si Tiendanube responde no-2xx.
 */
export async function actualizarCallbackLabels(
  storeId: number,
  accessToken: string,
  carrierId: string,
  callbackLabelsUrl: string,
): Promise<void> {
  const res = await fetchTiendanube(
    apiUrl(storeId, `shipping_carriers/${carrierId}`),
    {
      method: "PUT",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ callback_labels_url: callbackLabelsUrl }),
    },
  );
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`actualizarCallbackLabels HTTP ${res.status}: ${detalle}`.slice(0, 300));
  }
}

/**
 * Lista las options ya registradas en el carrier. Se usa para diffear contra los
 * servicios publicados y evitar POSTear duplicados (Tiendanube devolvería error).
 */
export async function listarOptions(
  storeId: number,
  accessToken: string,
  carrierId: string,
): Promise<{ code: string }[]> {
  const res = await fetchTiendanube(
    apiUrl(storeId, `shipping_carriers/${carrierId}/options`),
    { method: "GET", headers: authHeaders(accessToken) },
  );
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`listarOptions HTTP ${res.status}: ${detalle}`.slice(0, 300));
  }
  const data: any = await res.json();
  return Array.isArray(data) ? data.map((o) => ({ code: String(o.code) })) : [];
}

/**
 * Registra UNA option del carrier. `code` DEBE ser exactamente el mismo slug
 * que emite el rates callback (generarCodeServicio); si difieren, Tiendanube
 * descarta silenciosamente las rates cuyo code no esté pre-registrado.
 *
 * NO se manda additional_cost/days/free_shipping — el merchant los configura.
 */
export async function registrarOption(
  storeId: number,
  accessToken: string,
  carrierId: string,
  code: string,
  name: string,
): Promise<void> {
  const res = await fetchTiendanube(
    apiUrl(storeId, `shipping_carriers/${carrierId}/options`),
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ code, name }),
    },
  );
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`registrarOption HTTP ${res.status}: ${detalle}`.slice(0, 300));
  }
}

export interface RegistroCarrierResult {
  /** id del carrier en Tiendanube (siempre presente al terminar; string para persistir). */
  carrierId: string;
  /** true si en esta corrida se creó el carrier (no existía shippingCarrierId previo). */
  carrierCreado: boolean;
  /** codes de las options recién registradas (vacío si todas ya existían). */
  optionsNuevas: string[];
}

/**
 * Orquesta el alta/reconciliación del carrier + options para una tienda.
 * Idempotente:
 *   - Si la tienda YA tiene shippingCarrierId → NO crea carrier de nuevo, solo
 *     diffea options contra los servicios publicados.
 *   - Si el carrier ya tiene una option con el mismo code → la saltea (no
 *     duplica).
 *
 * El caller es responsable de:
 *   (a) persistir carrierId en TiendaTiendanube.shippingCarrierId cuando
 *       carrierCreado=true.
 *   (b) manejar excepciones (network / no-2xx bubblean como Error).
 *
 * Se apoya en enumerarServiciosPublicados (3 gates: técnico + shipro + cliente)
 * como fuente única de qué codes deben quedar registrados.
 */
export async function registrarCarrierParaTienda(tienda: {
  storeId: number;
  empresaId: number;
  accessTokenCifrado: string;
  shippingCarrierId: string | null;
}): Promise<RegistroCarrierResult> {
  const accessToken = decryptSecret(tienda.accessTokenCifrado);
  const servicios = await enumerarServiciosPublicados(tienda.empresaId);

  // "ship" y/o "pickup" según los servicios publicados; dedup + CSV. Fallback a
  // "ship" si la lista está vacía para no mandar `types: ""` (Tiendanube exige
  // al menos uno). Con servicios=[] el carrier queda creado pero sin options
  // — no aparece en checkout hasta que la empresa habilite algún servicio.
  const types = [...new Set(servicios.map((s) => s.type))].join(",") || "ship";
  const appUrl = getAppUrlOrThrow();
  const callbackUrl = `${appUrl}/api/tiendanube/rates`;
  const callbackLabelsUrl = `${appUrl}/api/tiendanube/labels`;

  let carrierId = tienda.shippingCarrierId;
  let carrierCreado = false;
  if (!carrierId) {
    // Fresh install: los dos callbacks van en el POST inicial.
    const id = await crearCarrier(tienda.storeId, accessToken, callbackUrl, callbackLabelsUrl, types);
    carrierId = String(id);
    carrierCreado = true;
  } else {
    // Reinstall / re-run: PUT quirúrgico para garantizar callback_labels_url en carriers
    // que fueron creados antes de que este campo se mandara en el POST (DEUDA 144 Momento 3
    // pieza 2). Sólo este campo — el resto es DEUDA 145.
    try {
      await actualizarCallbackLabels(tienda.storeId, accessToken, carrierId, callbackLabelsUrl);
    } catch (e) {
      // Caso reinstalación tras desinstalar (DEUDA 104): Tiendanube borra el carrier al desinstalar la app,
      // pero nuestra fila TiendaTiendanube conservó el shippingCarrierId viejo (el upsert del callback no lo
      // nullea). El PUT sobre un carrier inexistente da 404 → creamos uno nuevo y marcamos carrierCreado=true
      // para que el caller persista el id nuevo (si no, la próxima reinstalación caería en el mismo 404).
      // Cualquier OTRO error (5xx, red, 4xx no-404) se re-lanza y lo maneja el best-effort del caller.
      // Detección por string en el message: los primitives throwean Error(`... HTTP ${status}: ...`) sin campo
      // estructurado. Es frágil pero es la única forma de mirar el status sin cambiar el contrato del primitive.
      const es404 = e instanceof Error && /HTTP 404\b/.test(e.message);
      if (!es404) throw e;
      console.warn(
        `[carrier] PUT dio 404 (carrier ${carrierId} ya no existe en Tiendanube, probable reinstalación); recreando…`,
      );
      const id = await crearCarrier(tienda.storeId, accessToken, callbackUrl, callbackLabelsUrl, types);
      carrierId = String(id);
      carrierCreado = true;
    }
  }

  const existentes = await listarOptions(tienda.storeId, accessToken, carrierId);
  const codesExistentes = new Set(existentes.map((o) => o.code));

  const optionsNuevas: string[] = [];
  for (const s of servicios) {
    if (codesExistentes.has(s.code)) continue;
    await registrarOption(tienda.storeId, accessToken, carrierId, s.code, s.name);
    optionsNuevas.push(s.code);
  }

  return { carrierId, carrierCreado, optionsNuevas };
}
