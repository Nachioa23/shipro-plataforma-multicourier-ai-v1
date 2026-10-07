import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo,
  ResultadoBulto,
} from './CourierInterface';
import type { CredencialesCorreoArgentino } from './credenciales/correoargentino';
import { provinciaACodigoCorreo } from './correo/provincia-a-codigo';
import { resolverProvinciaDesdeCP } from '@/lib/geo/resolver-cp';

// Re-export para que CourierFactory pueda importar el tipo desde un solo lugar
// (mismo patrón que OcaAdapter re-exportando CredencialesOca).
export type { CredencialesCorreoArgentino } from './credenciales/correoargentino';

// DEUDA 141 (Correo Argentino Paq.ar v2.0): timeout de outbound fetch al courier
// + reclasificación de AbortError como CourierTimeout. 8s consistente con los otros
// adapters — CA/Paq.ar es REST, budget típico < 2s.
const COURIER_TIMEOUT_MS = 8000;
const ETIQUETA_TIMEOUT_MS = 30000; // etiqueta es back-office (sin presión de checkout) — 30s uniforme (decisión Nacho)

async function fetchConTimeout(input: string | URL, init?: RequestInit, timeoutMs: number = COURIER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("CourierTimeout: Correo Argentino no respondió en " + timeoutMs + "ms");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// URLs de Correo Argentino (DEUDA 141 + DEUDA 171 BUG 1):
//   Paq.ar API 2.0 — despacho / etiqueta / rastreo / sucursales / cancelación.
//     Sandbox: apitest.correoargentino.com.ar/paqar/v1
//     Producción: api.correoargentino.com.ar/paqar/v1
//   MiCorreo — SÓLO cotización. DEUDA 171 BUG 1 (2026-10-08): switch sandbox
//     agregado. Sandbox: apitest.correoargentino.com.ar/micorreo/v1. Producción:
//     api.correoargentino.com.ar/micorreo/v1.
const CA_PAQAR_URL_PROD    = "https://api.correoargentino.com.ar/paqar/v1";
const CA_PAQAR_URL_QA      = "https://apitest.correoargentino.com.ar/paqar/v1";
const CA_MICORREO_URL_PROD = "https://api.correoargentino.com.ar/micorreo/v1";
const CA_MICORREO_URL_QA   = "https://apitest.correoargentino.com.ar/micorreo/v1";

export class CorreoArgentinoAdapter implements ICourierIntegrator {
  private paqarBaseUrl: string;
  private micorreoBaseUrl: string;
  private creds: CredencialesCorreoArgentino;

  // DEUDA 171 BUG 1 (2026-10-08) — cache del Bearer token de MiCorreo. Vida
  // típica declarada por el `expires` del response (hora Argentina sin offset
  // → forzamos -03:00 al parsear). Refresh con margen de 5 min antes de vencer.
  private tokenMiCorreoCache: { token: string; venceEnMs: number } | null = null;

  // DEUDA 141: MiCorreo /rates devuelve precios NETOS por default (no hay campo
  // que declare IVA en la respuesta). Se trata como neto — mismo criterio conservador
  // que OCA. Si CA confirma que los precios incluyen IVA, este flag pasa a true.
  readonly tarifaApiIncluyeIva = false;

  constructor(credenciales: CredencialesCorreoArgentino) {
    this.creds = credenciales;
    this.paqarBaseUrl = credenciales.sandbox ? CA_PAQAR_URL_QA : CA_PAQAR_URL_PROD;
    // DEUDA 171 BUG 1: MiCorreo ahora también tiene switch sandbox (apitest).
    this.micorreoBaseUrl = credenciales.sandbox ? CA_MICORREO_URL_QA : CA_MICORREO_URL_PROD;
  }

  // Headers de auth para todas las llamadas Paq.ar v2.0 (despacho/etiqueta/rastreo/etc).
  // Paq.ar usa `Authorization: Apikey <key>` + `agreement: <acuerdo comercial>` en cada request.
  // MiCorreo (cotización) usa un mecanismo DIFERENTE: Basic auth → Bearer JWT via
  // getTokenMiCorreo() (DEUDA 171 BUG 1).
  private paqarAuthHeaders(): Record<string, string> {
    return {
      "Authorization": `Apikey ${this.creds.apiKey}`,
      "agreement": this.creds.agreement,
      "Content-Type": "application/json",
    };
  }

  // ==========================================
  // DEUDA 171 BUG 1 (2026-10-08) — getTokenMiCorreo
  // Flow: Basic auth (user:password) → POST /token → { token, expires }.
  // Cache in-memory por-adapter-instance con margen de 5 min antes del vencimiento
  // declarado por el server. En 401 del /rates, el caller limpia cache y reintenta
  // una vez (clock-skew / token revoked). Si falta user o password en credenciales,
  // throw inmediato — cotizar() lo atrapa y degrada a [] (venta no se pierde).
  // ==========================================
  private async getTokenMiCorreo(): Promise<string> {
    if (!this.creds.micorreoUser || !this.creds.micorreoPassword) {
      throw new Error('[Correo Argentino] MiCorreo credenciales incompletas (falta micorreoUser o micorreoPassword)');
    }
    const ahora = Date.now();
    const MARGEN_MS = 5 * 60_000; // refrescar 5 min antes del vencimiento
    if (this.tokenMiCorreoCache && this.tokenMiCorreoCache.venceEnMs - MARGEN_MS > ahora) {
      return this.tokenMiCorreoCache.token;
    }
    const basic = Buffer.from(`${this.creds.micorreoUser}:${this.creds.micorreoPassword}`).toString('base64');
    // Contrato GN: POST /token, Basic auth, SIN body. Respuesta: { token, expires: "YYYY-MM-DD HH:mm:ss" }
    const res = await fetchConTimeout(`${this.micorreoBaseUrl}/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basic}` },
    });
    if (!res.ok) {
      throw new Error(`[Correo Argentino] MiCorreo /token HTTP ${res.status} — revisar CA_MICORREO_USER/PASSWORD`);
    }
    const data: any = await res.json().catch(() => null);
    const token: string | undefined = data?.token;
    if (!token) throw new Error('[Correo Argentino] MiCorreo /token sin campo token');
    // expires viene en hora Argentina (UTC-3) sin offset → lo forzamos a -03:00
    let venceEnMs = ahora + 60 * 60_000; // fallback conservador si no parsea
    if (typeof data.expires === 'string') {
      const ms = Date.parse(data.expires.replace(' ', 'T') + '-03:00');
      if (!Number.isNaN(ms)) venceEnMs = ms;
    }
    this.tokenMiCorreoCache = { token, venceEnMs };
    return token;
  }

  // ==========================================
  // 1. COTIZAR (MiCorreo POST /rates)
  // DEUDA 171 BUG 1 (2026-10-08): auth real = Bearer JWT via getTokenMiCorreo().
  // customerId sigue en el body (es el id del cliente/contrato, no el auth).
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<{ servicio: string; precioNeto: number }[]> {
    // DEUDA 171 BUG 1: short-circuit sin credenciales de MiCorreo. Degradamos a []
    // sin tocar la red — Correo queda oculto del checkout; el cliente ve otros
    // couriers y la venta no se pierde.
    if (!this.creds.micorreoUser || !this.creds.micorreoPassword) {
      console.info(
        `[Correo Argentino] cotizar: credenciales MiCorreo faltantes (CA_MICORREO_USER/PASSWORD) — se oculta del checkout`,
      );
      return [];
    }

    const totalPesoKg = params.paquetes.reduce((s, p) => s + (Number(p.pesoKg) || 0), 0);
    // Para cotización consolidada: MAX por dimensión (single-parcel view; conservador
    // — captura el bulto más grande como referencia dimensional).
    const maxAlto  = params.paquetes.reduce((m, p) => Math.max(m, Number(p.altoCm)  || 0), 0);
    const maxAncho = params.paquetes.reduce((m, p) => Math.max(m, Number(p.anchoCm) || 0), 0);
    const maxLargo = params.paquetes.reduce((m, p) => Math.max(m, Number(p.largoCm) || 0), 0);

    const body = {
      customerId: this.creds.customerId,
      postalCodeOrigin: params.cpOrigen,
      postalCodeDestination: params.cpDestino,
      dimensions: {
        weight: Math.round(totalPesoKg * 1000), // kg → gramos
        height: Math.round(maxAlto),
        width:  Math.round(maxAncho),
        length: Math.round(maxLargo),
      },
    };

    // DEUDA 171 BUG 1: Bearer + retry 401. Un throw de getTokenMiCorreo (ej:
    // credenciales malas) queda atrapado en el try externo → log + return [].
    // cotizar() NUNCA tira hacia arriba — la venta no se pierde.
    try {
      const hacerRequest = async (): Promise<Response> => {
        const token = await this.getTokenMiCorreo();
        return fetchConTimeout(`${this.micorreoBaseUrl}/rates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      };

      let res = await hacerRequest();
      if (res.status === 401) {
        // Token vencido o clock-skew → invalidar cache y reintentar UNA vez.
        this.tokenMiCorreoCache = null;
        res = await hacerRequest();
      }

      if (!res.ok) {
        // Distinguir auth (401 persistente post-retry) de sin-cobertura (otros códigos).
        if (res.status === 401) {
          console.warn(
            `[Correo Argentino] MiCorreo /rates 401 PERSISTENTE post-retry para ${params.cpOrigen}→${params.cpDestino} — revisar credenciales MiCorreo`,
          );
        } else {
          console.info(
            `[Correo Argentino] MiCorreo HTTP ${res.status} para ${params.cpOrigen}→${params.cpDestino} — se oculta del checkout`,
          );
        }
        return [];
      }

      const data: any = await res.json().catch(() => null);
      const rates: any[] = Array.isArray(data?.rates) ? data.rates : [];
      if (rates.length === 0) {
        console.info(
          `[Correo Argentino] sin tarifas para ${params.cpOrigen}→${params.cpDestino} (respuesta vacía, se oculta del checkout)`,
        );
        return [];
      }

      const opciones: { servicio: string; precioNeto: number }[] = [];
      for (const r of rates) {
        const productName: string =
          typeof r?.productName === "string" && r.productName.trim()
            ? r.productName.trim()
            : typeof r?.productType === "string" && r.productType.trim()
            ? r.productType.trim()
            : "Estándar";
        const deliveredType: string = typeof r?.deliveredType === "string" ? r.deliveredType : "";
        const servicio = deliveredType === "S" ? `${productName} (Sucursal)` : productName;
        const precioRaw = r?.price ?? r?.total ?? r?.amount;
        const precioNeto = parseFloat(String(precioRaw ?? "").replace(",", "."));
        if (!Number.isFinite(precioNeto) || precioNeto <= 0) continue;
        opciones.push({ servicio, precioNeto });
      }

      console.info(
        `[Correo Argentino] tarifas OK ${params.cpOrigen}→${params.cpDestino} count=${opciones.length}`,
      );
      return opciones;
    } catch (e: any) {
      // Throw desde getTokenMiCorreo (401 en /token, user/pass mal), timeout, etc.
      // Log loud + return []: Correo se oculta del checkout, no afecta la venta.
      console.warn(
        `[Correo Argentino] cotizar falló para ${params.cpOrigen}→${params.cpDestino}: ${e?.message || e}`,
      );
      return [];
    }
  }

  // Helper: resuelve el deliveryType de Paq.ar según el tipoEntrega del sistema.
  private resolveDeliveryType(tipoEntrega?: string): string {
    return tipoEntrega === "sucursal" ? "agency" : "homeDelivery";
  }

  // ==========================================
  // 2. DESPACHAR (Paq.ar POST /v1/orders)
  // FAMILIA 2 (DEUDA 139): un request por bulto. N paquetes → N POSTs secuenciales →
  // N trackingNumbers. La complejidad queda escondida en el adapter; el sistema recibe
  // bultos[] uniforme como cualquier otro courier.
  // ==========================================
  async despachar(
    params: DespachoParams,
  ): Promise<{ tracking: string; etiquetaBase64?: string; etiquetaUrl?: string; bultos?: ResultadoBulto[] }> {
    if (!params.paquetes || params.paquetes.length === 0) {
      throw new Error("Correo Argentino: despachar sin paquetes");
    }

    const deliveryType = this.resolveDeliveryType(params.tipoEntrega);
    // saleDate en formato ISO con offset AR (-03:00). La API acepta el timestamp local.
    const saleDate = new Date().toISOString().replace("Z", "-03:00");

    const trackings: string[] = [];

    for (let i = 0; i < params.paquetes.length; i++) {
      const p = params.paquetes[i];

      const orderBody = {
        sellerId: this.creds.sellerId,
        trackingNumber: "", // dejar que CA genere el trackingNumber
        order: {
          senderData: {
            id: 0,
            businessName: params.remitente?.nombre ?? "",
            areaCodePhone: "",
            phoneNumber: params.remitente?.telefono ?? params.origen?.telefono ?? "",
            email: params.remitente?.email ?? params.origen?.email ?? "",
            address: {
              streetName: params.origen?.calle ?? "",
              streetNumber: params.origen?.altura ?? "",
              cityName: params.origen?.localidad ?? "",
              // Correo Argentino exige el código ISO 3166-2:AR de 1 letra ("B","C",...).
              // El nombre canónico se mapea vía helper local (Andreani usa nombre directo).
              state: provinciaACodigoCorreo(params.origen?.provincia),
              zipCode: params.origen?.cp ?? "",
            },
          },
          shippingData: {
            name: params.destinatarioNombre,
            areaCodePhone: "",
            phoneNumber: params.telefono,
            email: params.email,
            address: {
              streetName: params.calle,
              streetNumber: params.altura,
              cityName: params.localidad,
              state: provinciaACodigoCorreo(params.provincia),
              zipCode: params.cp,
            },
          },
          parcels: [
            {
              dimensions: {
                height: String(Math.round(Number(p.altoCm) || 0)),
                width: String(Math.round(Number(p.anchoCm) || 0)),
                depth: String(Math.round(Number(p.largoCm) || 0)),
              },
              productWeight: String(Math.round((Number(p.pesoKg) || 0) * 1000)), // kg → gramos
              productCategory: p.contenido ?? "General",
              declaredValue: String(Math.round(Number(p.valorDeclarado) || 0)),
            },
          ],
          deliveryType,
          agencyId: params.sucursalDestinoId ?? "",
          saleDate,
          serviceType: "CP", // Paq.ar Clásico default (upgradeable a CU/CE en pieza posterior)
          shipmentClientId: params.referencia ?? "",
        },
      };

      const res = await fetchConTimeout(`${this.paqarBaseUrl}/orders`, {
        method: "POST",
        headers: this.paqarAuthHeaders(),
        body: JSON.stringify(orderBody),
      });

      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        throw new Error(
          `Correo Argentino Paq.ar HTTP ${res.status} despachando bulto ${i + 1}: ${detalle}`.slice(0, 300),
        );
      }

      const data: any = await res.json().catch(() => null);
      // El trackingNumber puede venir top-level o en el body.data según la variante del
      // endpoint. Leer defensivamente.
      const trackingNumber: string =
        typeof data?.trackingNumber === "string" && data.trackingNumber.trim()
          ? data.trackingNumber.trim()
          : typeof data?.order?.trackingNumber === "string" && data.order.trackingNumber.trim()
          ? data.order.trackingNumber.trim()
          : "";

      if (!trackingNumber) {
        const preview = JSON.stringify(data ?? {}).slice(0, 300);
        throw new Error(
          `Correo Argentino no devolvió tracking para el bulto ${i + 1}. Respuesta: ${preview}`,
        );
      }

      trackings.push(trackingNumber);
    }

    console.log(
      `[Correo Argentino] despacho OK bultos=${trackings.length} primerTracking=${trackings[0]}`,
    );

    const bultos: ResultadoBulto[] = trackings.map((t) => ({ tracking: t }));

    return {
      tracking: bultos[0].tracking,
      bultos,
    };
  }

  // ==========================================
  // 3. OBTENER ETIQUETA (Paq.ar POST /v1/labels)
  // Devuelve fileBase64 → decodifica a Uint8Array (PDF bytes).
  // ==========================================
  async obtenerEtiquetaBuffer(ref: { trackingNumber: string; etiquetaUrl: string | null }): Promise<Uint8Array> {
    const body = [{ sellerId: this.creds.sellerId, trackingNumber: ref.trackingNumber }];

    const res = await fetchConTimeout(`${this.paqarBaseUrl}/labels`, {
      method: "POST",
      headers: this.paqarAuthHeaders(),
      body: JSON.stringify(body),
    }, ETIQUETA_TIMEOUT_MS);

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(
        `Correo Argentino Paq.ar HTTP ${res.status} pidiendo etiqueta ${ref.trackingNumber}: ${detalle}`.slice(0, 300),
      );
    }

    const data: any = await res.json().catch(() => null);
    // Respuesta esperada: array con un entry por trackingNumber. Buscamos el que matchea.
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.labels) ? data.labels : [];
    const match = items.find((it) =>
      typeof it?.trackingNumber === "string" && it.trackingNumber === ref.trackingNumber,
    );

    const fileBase64: string | null =
      typeof match?.fileBase64 === "string" && match.fileBase64.trim()
        ? match.fileBase64.trim()
        : null;
    const resultOk =
      match?.result === "OK" ||
      match?.result === "ok" ||
      match?.status === "OK" ||
      (!match?.result && !!fileBase64); // algunas respuestas omiten result si viene el file

    if (!fileBase64 || !resultOk) {
      const preview = JSON.stringify(data ?? {}).slice(0, 300);
      throw new Error(
        `Correo Argentino no devolvió etiqueta para ${ref.trackingNumber}. Respuesta: ${preview}`,
      );
    }

    // Sanitizar posibles whitespace/newlines del base64.
    const clean = fileBase64.replace(/\s+/g, "");
    return Buffer.from(clean, "base64");
  }

  // ==========================================
  // 4. RASTREAR (Paq.ar GET /v1/tracking con body — poco común pero documentado)
  // fetch permite body en GET; la API espera el arreglo de trackingNumbers.
  // ==========================================
  async rastrear(tracking: string): Promise<string> {
    try {
      const body = [{ trackingNumber: tracking }];

      const res = await fetchConTimeout(`${this.paqarBaseUrl}/tracking`, {
        method: "GET",
        headers: this.paqarAuthHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) return "Error de Conexión";

      const data: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.tracking)
        ? data.tracking
        : Array.isArray(data?.results)
        ? data.results
        : [];
      const entry = items.find(
        (it) => typeof it?.trackingNumber === "string" && it.trackingNumber === tracking,
      );
      if (!entry) return "Desconocido";

      // El "último estado" puede venir en events[].status (últimos primero) o
      // en un top-level status/lastStatus. Leer defensivamente.
      const events: any[] = Array.isArray(entry?.events) ? entry.events : [];
      const raw: string =
        (events.length > 0 && (events[0]?.status ?? events[0]?.description)) ??
        entry?.status ??
        entry?.lastStatus ??
        "";
      if (!raw || String(raw).trim().length === 0) return "Desconocido";
      return this.traducirEstado(String(raw).trim());
    } catch (e) {
      return "Error de Conexión";
    }
  }

  // ==========================================
  // 5. TRADUCIR ESTADO (CA → canónica Shipro)
  // El input puede ser un statusId corto (PRE/CAN/CAU) o el texto de descripción.
  // Normaliza case + acentos para matching robusto contra las descripciones ES-AR.
  // ==========================================
  traducirEstado(estadoCrudo: string): string {
    const raw = String(estadoCrudo).trim();
    const norm = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

    // Ids cortos directos.
    if (raw === "PRE") return "ETIQUETA_CREADA";
    if (raw === "CAN") return "CANCELADO";
    if (raw === "CAU") return "DEVUELTO";

    // Descripciones textuales.
    if (norm === "preimposicion") return "ETIQUETA_CREADA";
    if (norm === "en proceso de cancelacion") return "CANCELADO";
    if (norm === "caduco") return "DEVUELTO";

    if (norm.includes("entregado")) return "ENTREGADO";
    if (norm.includes("en camino") || norm.includes("en transito")) return "EN_CAMINO";
    if (norm.includes("en reparto") || norm.includes("en calle")) return "EN_REPARTO";
    if (norm.includes("visita") || norm.includes("ausente")) return "VISITA_FALLIDA";

    return estadoCrudo;
  }

  // ==========================================
  // 6. OBTENER SUCURSALES (Paq.ar GET /v1/agencies?pickup_availability=true)
  // Filtro documentado por CA: solo agencias habilitadas para retiro (pickup).
  // ==========================================
  // DEUDA 171 BUG 3 (2026-10-08) — Helper: fetch + parse de agencias desde una URL
  // ya armada. Extraído para no duplicar código entre el intento filtrado por
  // stateId y el fallback amplio (reintento por lista vacía). Devuelve [] en
  // !res.ok o cuando el parse no encuentra items — el caller decide si reintenta.
  private async fetchYParsearAgencias(url: string, cp: string): Promise<SucursalInfo[]> {
    const res = await fetchConTimeout(url, {
      method: "GET",
      headers: this.paqarAuthHeaders(),
    });

    if (!res.ok) {
      console.warn(
        `[Correo Argentino] obtenerSucursales HTTP ${res.status} para CP ${cp} (url=${url})`,
      );
      return [];
    }

    const data: any = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.agencies)
      ? data.agencies
      : [];

    const sucursales: SucursalInfo[] = [];
    for (const a of items) {
      const id = a?.agency_id ?? a?.agencyId ?? a?.id;
      if (id == null) continue;

      const nombre = String(a?.name ?? a?.description ?? "").trim();
      const address = a?.address ?? {};
      const calle = String(address?.streetName ?? address?.street ?? "").trim();
      const nro = String(address?.streetNumber ?? address?.number ?? "").trim();
      const direccion = `${calle} ${nro}`.trim();
      const localidad = String(address?.cityName ?? address?.city ?? a?.city ?? "").trim();
      const provincia = String(address?.state ?? a?.state ?? "").trim();
      const cpS = String(address?.zipCode ?? address?.postalCode ?? a?.zipCode ?? "").trim();

      const suc: SucursalInfo = {
        id: String(id),
        nombre,
        direccion,
        localidad,
        provincia,
        cp: cpS,
      };
      const latRaw = a?.lat ?? a?.latitude ?? address?.lat;
      const lngRaw = a?.lng ?? a?.longitude ?? address?.lng;
      if (latRaw != null) {
        const lat = parseFloat(String(latRaw).replace(",", "."));
        if (Number.isFinite(lat)) suc.latitud = lat;
      }
      if (lngRaw != null) {
        const lng = parseFloat(String(lngRaw).replace(",", "."));
        if (Number.isFinite(lng)) suc.longitud = lng;
      }
      sucursales.push(suc);
    }

    return sucursales;
  }

  async obtenerSucursales(cp: string): Promise<SucursalInfo[]> {
    try {
      // DEUDA 171 BUG 3 (2026-10-08): filtrar por `stateId` (provincia) derivado del CP.
      // El endpoint `/agencies` acepta `stateId`; antes el `cp` se recibía pero no se
      // usaba en el filtro — se devolvían TODAS las agencias de todo el país.
      // Fallback amplio: si el CP no resuelve a provincia conocida, o si el filtro
      // con stateId devuelve 0 agencias (p.ej. formato de código distinto del esperado),
      // reintentamos con el filtro original (solo pickup_availability) para no quedar
      // por debajo del comportamiento pre-fix. El ranking por lat/long contra el CP
      // destino (en el caller) sigue filtrando por cercanía sobre el resultado final.
      const urlAmplia = `${this.paqarBaseUrl}/agencies?pickup_availability=true`;
      let url = urlAmplia;
      const resolucion = await resolverProvinciaDesdeCP(cp);
      if (resolucion) {
        const codigo = provinciaACodigoCorreo(resolucion.provincia);
        if (codigo) {
          url = `${this.paqarBaseUrl}/agencies?stateId=${encodeURIComponent(codigo)}&pickup_availability=true`;
        } else {
          console.warn(
            `[Correo Argentino] obtenerSucursales: provincia '${resolucion.provincia}' sin código Correo para CP ${cp}, uso filtro amplio`,
          );
        }
      } else {
        console.warn(
          `[Correo Argentino] obtenerSucursales: CP ${cp} no resolvió provincia, uso filtro amplio`,
        );
      }
      const usoStateId = url.includes("stateId=");

      let sucursales = await this.fetchYParsearAgencias(url, cp);

      // Fallback por lista vacía: si usamos stateId y vino 0, reintentamos UNA vez
      // con la URL amplia. Garantiza cero regresión vs el comportamiento pre-fix.
      if (sucursales.length === 0 && usoStateId) {
        console.warn(
          `[Correo Argentino] obtenerSucursales: 0 agencias con stateId para CP ${cp}, reintento con filtro amplio`,
        );
        sucursales = await this.fetchYParsearAgencias(urlAmplia, cp);
      }

      return sucursales;
    } catch (e) {
      console.warn(
        "[Correo Argentino] obtenerSucursales falló:",
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  }

  // ==========================================
  // 7. CANCELAR (Paq.ar PATCH /v1/orders/{tracking}/cancel)
  // Sin body.
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> {
    const url = `${this.paqarBaseUrl}/orders/${encodeURIComponent(tracking)}/cancel`;
    const res = await fetchConTimeout(url, {
      method: "PATCH",
      headers: this.paqarAuthHeaders(),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(
        `Correo Argentino cancelación HTTP ${res.status} para ${tracking}: ${detalle}`.slice(0, 300),
      );
    }

    const data: any = await res.json().catch(() => null);
    const codigo = Number(data?.codigo ?? data?.code ?? data?.status);
    if (codigo === 200) return true;
    console.warn(
      `[Correo Argentino] cancelación devolvió código no-200: ${JSON.stringify(data ?? {}).slice(0, 200)}`,
    );
    return false;
  }

  // ==========================================
  // 8. SOLICITAR RECOLECCIÓN (stub — no aplica al modelo Paq.ar)
  // ==========================================
  async solicitarRecoleccion(_fecha: Date, _cantidadBultos: number, _direccionOrigen: string): Promise<string> {
    throw new Error(
      "Correo Argentino: solicitarRecoleccion no implementado — la recolección se gestiona operativamente con el acuerdo comercial",
    );
  }
}
