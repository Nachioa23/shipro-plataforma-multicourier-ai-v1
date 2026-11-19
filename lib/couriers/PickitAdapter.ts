import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo,
  OpcionCotizacion,
  ResultadoBulto,
} from './CourierInterface';
import type { CredencialesPickit } from './credenciales/pickit';
import { resolverProvinciaDesdeCP } from '@/lib/geo/resolver-cp';
import { traducirEstadoPickit } from './pickit-estados';

// Re-export para que CourierFactory pueda importar el tipo desde un solo lugar
// (mismo patrón que Oca/CorreoArgentino/HopEnvios re-exportando sus creds).
export type { CredencialesPickit } from './credenciales/pickit';

// =============================================================================
// PickitAdapter — integración REST contra Pickit (api.uat.pickit.com.ar).
// =============================================================================
// Patrón espejo de HopEnviosAdapter (stateless REST, timeouts, graceful fail).
//
// Capacidades técnicas (ver serviciosSoportados.ts):
//   - entrega_domicilio_estandar → DOM/dispatch
//   - entrega_sucursal / entrega_punto_retiro → PP/dispatch (Pickit Points)
//
// NOTA de VALIDACIÓN: todos los endpoints quedaron sin validar empíricamente
// porque la UAT devolvía 504 Gateway Time-out al momento de este commit.
// Cuando UAT levante, confirmar en QA:
//   1. tarifaApiIncluyeIva (hoy false; depende del shape real de price/totalPrice).
//   2. sla.id válido (hoy 1; configurable por env PICKIT_SLA_ID y creds propias).
//   3. Combinatoria (serviceType, workflowTag, operationType) por servicio.
//   4. pointId representativo cotizando sucursal sin selección del comprador.
//   5. Endpoint de labels sobre transactionId antiguo (idempotencia).
// =============================================================================

// DEUDA 141 (patrón Hop): timeout de outbound fetch + reclasificación de
// AbortError como CourierTimeout. 8s en hot-path, 30s en descarga de etiquetas.
const COURIER_TIMEOUT_MS = 8000;
const ETIQUETA_TIMEOUT_MS = 30000;

async function fetchConTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs: number = COURIER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("CourierTimeout: Pickit no respondió en " + timeoutMs + "ms");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// URLs por ambiente (confirmadas en doc oficial §Ambientes, vía GN):
//   UAT  → https://api.uat.pickit.com.ar
//   PROD → https://api.pickit.net
// Prioridad: creds.baseUrl (PICKIT_BASE_URL o json.baseUrl) > sandbox flag.
const PICKIT_UAT_URL = "https://api.uat.pickit.com.ar";
const PICKIT_PROD_URL = "https://api.pickit.net";

// Mapeo tipoEntrega Shipro → (serviceType, workflowTag, operationType) Pickit.
// CONFIRMADO vía doc oficial (GN): operationType 1 = a punto (PP), 2 = a domicilio.
// El ejemplo oficial de "Envío a Domicilio" usa serviceType='PP' + operationType=2
// — Pickit deriva el destino del operationType, no del serviceType.
//
// CONFIRMAR EN QA: la doc es inconsistente (el enum serviceType lista DOM, pero
// el ejemplo de domicilio usa PP). Si PP+2 falla con "La combinación de
// serviceType, operationType y workflowTag es invalida", probar DOM+2.
// Same-Day (SM) queda para V2.
type PickitServiceDescriptor = { serviceType: 'DOM' | 'PP'; workflowTag: 'dispatch'; operationType: 1 | 2 };

function descriptorPorTipoEntrega(tipoEntrega?: string): PickitServiceDescriptor | null {
  switch (tipoEntrega) {
    case 'domicilio':
      return { serviceType: 'PP', workflowTag: 'dispatch', operationType: 2 };
    case 'sucursal':
      return { serviceType: 'PP', workflowTag: 'dispatch', operationType: 1 };
    // inversa/cambio/devolucion → V2 (sin soporte en MVP).
    default:
      return null;
  }
}

export class PickitAdapter implements ICourierIntegrator {
  private baseUrl: string;
  private creds: CredencialesPickit;

  // DEUDA 123: Pickit devuelve price + totalPrice + tax en /budget. Hoy se
  // trata price como NETO (totalPrice contiene el IVA). TODO EN MAYÚSCULAS:
  // CONFIRMAR CON COTIZACIÓN REAL EN QA CUANDO LA UAT LEVANTE — un flag mal
  // leído acá genera undercharge sistemático (~17%) o overcharge.
  readonly tarifaApiIncluyeIva = false;

  constructor(credenciales: CredencialesPickit) {
    this.creds = credenciales;
    // Prioridad: creds.baseUrl (env PICKIT_BASE_URL o json.baseUrl) > sandbox
    // flag > prod. sandbox=true apunta a UAT; sin sandbox, prod (api.pickit.net
    // — URL confirmada en doc oficial §Ambientes).
    this.baseUrl =
      credenciales.baseUrl?.trim() ||
      (credenciales.sandbox ? PICKIT_UAT_URL : PICKIT_PROD_URL);
  }

  // Headers de auth. Pickit usa dos casings del mismo campo según endpoint
  // ('apikey' en unos, 'apiKey' en otros) — mandamos los dos para evitar el
  // 401 case-sensitive. Decisión Chat B contra la doc.
  private authHeaders(): Record<string, string> {
    return {
      token: this.creds.token,
      apikey: this.creds.apiKey,
      apiKey: this.creds.apiKey,
    };
  }

  private authHeadersJson(): Record<string, string> {
    return { ...this.authHeaders(), "Content-Type": "application/json" };
  }

  // Shape compartido entre /budget (cotizar) y /transaction (despachar).
  // El propio Pickit lo llama `budgetPetition` dentro de /transaction.
  private construirBudgetPetition(opts: {
    descriptor: PickitServiceDescriptor;
    cpDestino: string;
    cpOrigen?: string;
    paquetes: CotizacionParams['paquetes'];
    pointId?: string | null;
    customer?: {
      name: string;
      lastName?: string;
      pid: string;
      email: string;
      phone: string;
      address?: {
        address: string;
        streetNumber: string;
        province?: string;
        postalCode: string;
        city?: string;
        country: string;
      };
    };
  }): Record<string, unknown> {
    const { descriptor, paquetes, pointId, customer } = opts;

    const products = paquetes.map((p, i) => ({
      name: `Shipro-${i + 1}`,
      weight: { amount: Math.max(1, Math.round((Number(p.pesoKg) || 0) * 1000)), unit: 'g' },
      length: { amount: Math.max(1, Math.round(Number(p.largoCm) || 0)), unit: 'cm' },
      height: { amount: Math.max(1, Math.round(Number(p.altoCm) || 0)), unit: 'cm' },
      width:  { amount: Math.max(1, Math.round(Number(p.anchoCm) || 0)), unit: 'cm' },
      // Pickit rechaza products con price ≤ 0 (validación del /budget). Piso
      // mínimo 1 para envíos con valorDeclarado 0 o ausente.
      price:  Math.max(1, Math.round(Number(p.valorDeclarado) || 0)),
      amount: 1,
    }));

    const body: Record<string, unknown> = {
      serviceType: descriptor.serviceType,
      workflowTag: descriptor.workflowTag,
      operationType: descriptor.operationType,
      retailer: { tokenId: this.creds.token },
      products,
      sla: { id: this.creds.slaId },
    };

    if (customer) body.customer = customer;
    if (pointId) body.pointId = pointId;

    return body;
  }

  // ==========================================
  // 1. COTIZAR (POST /index.php/apiV2.1/budget)
  // DOM: /budget con address del destinatario.
  // PP: resuelve pointId representativo via /map/point del CP y /budget con él
  //     (MVP: el precio Pickit suele ser flat por zona, se recalcula con el
  //     pointId real que elige el comprador en el despacho).
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<OpcionCotizacion[]> {
    const descriptor = descriptorPorTipoEntrega(params.tipoEntrega);
    if (!descriptor) return []; // inversa/cambio/devolucion → V2

    try {
      let pointId: string | null = null;

      // Sucursal: resolver un punto representativo del CP destino (MVP).
      if (descriptor.serviceType === 'PP') {
        const puntos = await this.listarPuntosPorCp(params.cpDestino);
        const primero = puntos.find((p) => this.puntoOfrecePP(p) && !this.puntoCerrado(p));
        if (!primero) {
          console.info(
            `[Pickit] cotizar PP: sin puntos operativos en CP ${params.cpDestino} — se oculta del checkout`,
          );
          return [];
        }
        pointId = String(primero.id);
      }

      // DOM: /budget exige customer.address con province. Derivamos la
      // provincia canonical desde el CP con el helper autoritativo
      // (lib/geo/resolver-cp.ts; mismo que usa el cotizador). Si el CP no
      // resuelve (CP desconocido en BD), dejamos sin province y Pickit
      // decidirá — degrada a [] si la rechaza.
      let provinciaDestino: string | undefined;
      if (descriptor.serviceType === 'DOM') {
        const resolucion = await resolverProvinciaDesdeCP(String(params.cpDestino));
        provinciaDestino = resolucion?.provincia;
      }

      const customer = descriptor.serviceType === 'DOM'
        ? {
            name: 'Shipro',
            pid: '0',
            email: 'noreply@shipro.app',
            phone: '0',
            address: {
              address: '-',
              streetNumber: '0',
              ...(provinciaDestino ? { province: provinciaDestino } : {}),
              postalCode: String(params.cpDestino),
              country: 'Argentina',
            },
          }
        : undefined;

      const body = this.construirBudgetPetition({
        descriptor,
        cpDestino: params.cpDestino,
        cpOrigen: params.cpOrigen,
        paquetes: params.paquetes,
        pointId,
        customer,
      });

      const url = `${this.baseUrl}/index.php/apiV2.1/budget`;
      const res = await fetchConTimeout(url, {
        method: 'POST',
        headers: this.authHeadersJson(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.info(
          `[Pickit] /budget HTTP ${res.status} para ${params.cpOrigen}→${params.cpDestino} (${descriptor.serviceType}) — se oculta del checkout`,
        );
        return [];
      }

      const data: any = await res.json().catch(() => null);
      // DEUDA 123: price es el NETO (totalPrice = price + IVA; tax = %).
      // TODO EN MAYÚSCULAS: VALIDAR CON COTIZACIÓN REAL EN QA.
      const priceRaw = data?.price;
      const precioNeto = typeof priceRaw === 'number'
        ? priceRaw
        : parseFloat(String(priceRaw ?? '').replace(',', '.'));
      if (!Number.isFinite(precioNeto) || precioNeto <= 0) {
        console.info(
          `[Pickit] /budget sin price para ${params.cpOrigen}→${params.cpDestino} (${descriptor.serviceType}) — se oculta del checkout`,
        );
        return [];
      }

      return [{ servicio: 'Estándar', precioNeto }];
    } catch (e) {
      console.warn(
        `[Pickit] cotizar falló (${params.tipoEntrega}):`,
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  }

  // ==========================================
  // 2. DESPACHAR (POST /index.php/apiV2.1/transaction — transacción simplificada)
  // Multi-bulto via packageAmount (no N transacciones).
  // Después pide la URL de la etiqueta via POST /apiV2/retailer/{token}/labels.
  // ==========================================
  async despachar(
    params: DespachoParams,
  ): Promise<{ tracking: string; etiquetaBase64?: string; etiquetaUrl?: string; bultos?: ResultadoBulto[]; refInterno?: string }> {
    if (!params.paquetes || params.paquetes.length === 0) {
      throw new Error('Pickit: despachar sin paquetes');
    }

    const descriptor = descriptorPorTipoEntrega(params.tipoEntrega);
    if (!descriptor) {
      throw new Error(
        `Pickit: tipoEntrega '${params.tipoEntrega}' no soportado — MVP solo domicilio/sucursal`,
      );
    }

    const pointId =
      descriptor.serviceType === 'PP'
        ? (params.sucursalDestinoId ?? null)
        : null;
    if (descriptor.serviceType === 'PP' && !pointId) {
      throw new Error('Pickit: despacho a sucursal requiere sucursalDestinoId');
    }

    const customer = {
      name: String(params.destinatarioNombre || '').split(' ').slice(0, -1).join(' ') || String(params.destinatarioNombre || '').trim() || 'Sin nombre',
      lastName: String(params.destinatarioNombre || '').split(' ').slice(-1).join(' ') || '-',
      pid: String(params.dni || ''),
      email: String(params.email || ''),
      phone: String(params.telefono || ''),
      ...(descriptor.serviceType === 'DOM'
        ? {
            address: {
              address: String(params.calle || ''),
              streetNumber: String(params.altura || ''),
              province: String(params.provincia || ''),
              postalCode: String(params.cp || ''),
              city: String(params.localidad || ''),
              country: 'Argentina',
            },
          }
        : {}),
    };

    const budgetPetition = this.construirBudgetPetition({
      descriptor,
      cpDestino: String(params.cp || ''),
      paquetes: params.paquetes,
      pointId,
      customer,
    });

    // La doc de Pickit tiene inconsistencia: la tabla de parámetros usa
    // `trackingInfo` pero los ejemplos CURL escriben `trakingInfo` (typo).
    // Mandamos AMBAS claves con el mismo valor para tolerar cualquiera de las
    // dos convenciones que pueda estar leyendo su backend. Cuando UAT levante,
    // confirmar cuál queda vigente y limpiar la que no use.
    const orderRef = String(params.referencia ?? '');
    const body: Record<string, unknown> = {
      budgetPetition,
      firstState: 2,
      packageAmount: params.paquetes.length,
      trackingInfo: { order: orderRef },
      trakingInfo: { order: orderRef },
    };

    const url = `${this.baseUrl}/index.php/apiV2.1/transaction`;
    const res = await fetchConTimeout(url, {
      method: 'POST',
      headers: this.authHeadersJson(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(
        `Pickit /transaction HTTP ${res.status}: ${detalle}`.slice(0, 300),
      );
    }

    const data: any = await res.json().catch(() => null);
    const transactionIdRaw = data?.transactionId ?? data?.result?.transactionId;
    const pickitCode: string =
      typeof data?.pickitCode === 'string' && data.pickitCode.trim()
        ? data.pickitCode.trim()
        : typeof data?.result?.pickitCode === 'string' && data.result.pickitCode.trim()
        ? data.result.pickitCode.trim()
        : '';

    const transactionId = Number(transactionIdRaw);
    if (!Number.isFinite(transactionId) || transactionId <= 0 || !pickitCode) {
      const preview = JSON.stringify(data ?? {}).slice(0, 300);
      throw new Error(
        `Pickit /transaction sin transactionId/pickitCode. Respuesta: ${preview}`,
      );
    }

    const etiquetaUrl = await this.pedirEtiquetaUrl(transactionId);

    console.log(
      `[Pickit] despacho OK pickitCode=${pickitCode} transactionId=${transactionId} bultos=${params.paquetes.length}`,
    );

    const resultado: {
      tracking: string;
      etiquetaUrl?: string;
      bultos?: ResultadoBulto[];
      refInterno?: string;
    } = {
      tracking: pickitCode,
      refInterno: String(transactionId),
    };
    if (etiquetaUrl) resultado.etiquetaUrl = etiquetaUrl;

    // Multi-bulto: Pickit maneja N bultos bajo UN transactionId/pickitCode.
    // Cada EnvioBulto queda ligado al mismo tracking público del envío
    // (no hay trackings por bulto distintos en Pickit).
    const bultos: ResultadoBulto[] = params.paquetes.map((_, i) => {
      const bulto: ResultadoBulto = {
        tracking: pickitCode,
        numeroBulto: String(i + 1),
        totalizador: `${i + 1}/${params.paquetes.length}`,
      };
      if (etiquetaUrl) bulto.etiquetaUrl = etiquetaUrl;
      return bulto;
    });
    resultado.bultos = bultos;

    return resultado;
  }

  // POST /apiV2/retailer/{token}/labels con arrayTransactionId: [int].
  // Devuelve url del PDF (string). Si falla o no viene URL, devolvemos null —
  // el caller (crear.ts, cableo Chat A) decidirá el fallback.
  private async pedirEtiquetaUrl(transactionId: number): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/apiV2/retailer/${encodeURIComponent(this.creds.token)}/labels`;
      const res = await fetchConTimeout(
        url,
        {
          method: 'POST',
          headers: this.authHeadersJson(),
          body: JSON.stringify({ arrayTransactionId: [transactionId] }),
        },
        ETIQUETA_TIMEOUT_MS,
      );
      if (!res.ok) {
        console.warn(
          `[Pickit] /labels HTTP ${res.status} para transactionId=${transactionId} — sin URL de etiqueta`,
        );
        return null;
      }
      const data: any = await res.json().catch(() => null);
      // Shape probable: { url: "..." } o { labels: { url: "..." } } o { result: { url: "..." } }.
      // TODO QA: confirmar el shape exacto cuando UAT levante.
      const candidata =
        data?.url ??
        data?.labels?.url ??
        data?.label?.url ??
        data?.result?.url ??
        (Array.isArray(data?.labels) ? data.labels[0]?.url : undefined);
      if (typeof candidata === 'string' && candidata.trim()) return candidata.trim();
      return null;
    } catch (e) {
      console.warn(
        '[Pickit] /labels falló:',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
  }

  // ==========================================
  // 3. OBTENER ETIQUETA (buffer PDF)
  // Patrón Hop/Andreani: bajamos los bytes de etiquetaUrl si existe.
  // TODO (dep. Chat A): re-pedirla por transactionId si etiquetaUrl falta.
  //   Hoy obtenerEtiquetaBuffer recibe solo { trackingNumber (=pickitCode),
  //   etiquetaUrl } — sin refInterno no podemos llamar /labels directo. Cuando
  //   Chat A persista refInterno y lo exponga acá (extender el ref), se puede
  //   hacer re-fetch idempotente desde el transactionId.
  // ==========================================
  async obtenerEtiquetaBuffer(
    ref: { trackingNumber: string; etiquetaUrl: string | null },
  ): Promise<Uint8Array> {
    if (!ref.etiquetaUrl) {
      throw new Error(
        `Pickit: no hay URL de etiqueta para ${ref.trackingNumber}. Re-despachá para regenerar (re-fetch por transactionId pendiente del cableo Chat A).`,
      );
    }
    const res = await fetchConTimeout(ref.etiquetaUrl, { method: 'GET' }, ETIQUETA_TIMEOUT_MS);
    if (!res.ok) {
      throw new Error(
        `Pickit: error al descargar etiqueta (HTTP ${res.status}) para ${ref.trackingNumber}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // ==========================================
  // 4. RASTREAR
  // Pickit es push-only (webhook) — no hay GET de estado de transacción.
  // Devolvemos "" para que el cron de rastreo (app/api/cron/rastreo/route.ts)
  // haga no-op (short-circuit en `if (nuevoEstadoCrudo && ... !== "DESCONOCIDO")`).
  //
  // TODO: hace falta un endpoint receptor app/api/pickit/webhook/route.ts
  // (fuera de este build) que haga el flujo equivalente: lookup por pickitCode,
  // traducirEstado(workflow.tag + state.tipo + subtipo), update Envio +
  // crear EventoTracking. El shape del payload está scrapeado en /tmp/pickit-docs.
  // ==========================================
  async rastrear(_tracking: string): Promise<string> {
    return '';
  }

  // ==========================================
  // 5. TRADUCIR ESTADO (Pickit workflow.tag → canónica Shipro)
  // Vocabulario canónico: lib/utils/estados.ts (ETIQUETA_CREADA /
  // PAQUETE_RECOLECTADO / EN_TRANSITO_A_DESTINO / EN_DISTRIBUCION / ENTREGADO /
  // VISITA_FALLIDA / CANCELADO / DEVUELTO_AL_REMITENTE / INCIDENCIA).
  //
  // Catálogo scrapeado de la doc /api/webhook (workflow dispatch20): ver la
  // doc oficial para la lista completa; acá cubrimos los tags comunes.
  // Sin match → devuelve el crudo (patrón Hop).
  // ==========================================
  traducirEstado(estadoCrudo: string): string {
    return traducirEstadoPickit(estadoCrudo);
  }

  // ==========================================
  // 6. OBTENER SUCURSALES (Pickit Points)
  // GET /apiV2/map/point?filter.postalCode={cp}&paginable=false&filter.point.hours=true
  // Solo incluye puntos con services[].type='PP' y que no tengan closure.state='active'.
  // ==========================================
  async obtenerSucursales(cp: string): Promise<SucursalInfo[]> {
    const puntos = await this.listarPuntosPorCp(cp, /*conHorarios=*/ true);
    const sucursales: SucursalInfo[] = [];
    for (const p of puntos) {
      if (!this.puntoOfrecePP(p)) continue;
      if (this.puntoCerrado(p)) continue;
      if (p?.id == null) continue;

      const altura =
        p?.streetNumber != null && String(p.streetNumber).trim()
          ? String(p.streetNumber).trim()
          : '';
      const calle =
        typeof p?.street === 'string' && p.street.trim()
          ? p.street.trim()
          : '';
      const direccion =
        typeof p?.address === 'string' && p.address.trim()
          ? p.address.trim()
          : [calle, altura].filter(Boolean).join(' ').trim();

      const suc: SucursalInfo = {
        id: String(p.id),
        nombre: String(p?.name ?? '').trim(),
        direccion,
        localidad: String(p?.city ?? '').trim(),
        provincia: String(p?.province ?? '').trim(),
        cp: String(p?.postalCode ?? '').trim(),
      };
      const lat = parseFloat(String(p?.lat ?? '').replace(',', '.'));
      const lng = parseFloat(String(p?.lng ?? '').replace(',', '.'));
      if (Number.isFinite(lat)) suc.latitud = lat;
      if (Number.isFinite(lng)) suc.longitud = lng;

      sucursales.push(suc);
    }
    return sucursales;
  }

  private async listarPuntosPorCp(cp: string, conHorarios = false): Promise<any[]> {
    try {
      const query = new URLSearchParams();
      query.append('filter.postalCode', String(cp));
      query.append('paginable', 'false');
      if (conHorarios) query.append('filter.point.hours', 'true');
      const url = `${this.baseUrl}/apiV2/map/point?${query.toString()}`;
      const res = await fetchConTimeout(url, { method: 'GET', headers: this.authHeaders() });
      if (!res.ok) {
        console.warn(`[Pickit] /map/point HTTP ${res.status} para CP ${cp}`);
        return [];
      }
      const data: any = await res.json().catch(() => null);
      if (Array.isArray(data?.result)) return data.result;
      if (Array.isArray(data)) return data;
      return [];
    } catch (e) {
      console.warn(
        '[Pickit] /map/point falló:',
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  }

  private puntoOfrecePP(p: any): boolean {
    const services = Array.isArray(p?.services) ? p.services : [];
    return services.some((s: any) => s?.type === 'PP');
  }

  private puntoCerrado(p: any): boolean {
    return p?.closure?.state === 'active';
  }

  // ==========================================
  // 7. CANCELAR (DELETE /apiV2/retailer/transaction/{transactionId})
  // El `tracking` que llega acá ES el transactionId que el engine va a pasar
  // una vez que Chat A cablee la persistencia del refInterno (hoy el call-site
  // usa tramo.trackingExterno; Chat A decide si guarda transactionId ahí).
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> {
    const url = `${this.baseUrl}/apiV2/retailer/transaction/${encodeURIComponent(tracking)}`;
    const res = await fetchConTimeout(url, {
      method: 'DELETE',
      headers: this.authHeadersJson(),
      body: JSON.stringify({}),
    });

    if (res.status === 404) return false;
    if (res.status === 401 || res.status === 403) {
      const detalle = await res.text().catch(() => '');
      throw new Error(
        `Pickit cancelación HTTP ${res.status} para ${tracking}: ${detalle}`.slice(0, 300),
      );
    }
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(
        `Pickit cancelación HTTP ${res.status} para ${tracking}: ${detalle}`.slice(0, 300),
      );
    }

    const data: any = await res.json().catch(() => null);
    if (Number(data?.code) === 200) return true;
    console.warn(
      `[Pickit] cancelación devolvió code≠200: ${JSON.stringify(data ?? {}).slice(0, 200)}`,
    );
    return false;
  }

  // Pickit es entregador puro: NO implementa solicitarRecoleccion ni
  // vincularRecoleccion (esas corresponden a couriers que pueden actuar
  // como recolectores de OTRO entregador, hoy Mocis/Intralog).
}
