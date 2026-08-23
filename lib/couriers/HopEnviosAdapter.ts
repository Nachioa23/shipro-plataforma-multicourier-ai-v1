import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo,
  ResultadoBulto,
} from './CourierInterface';
import type { CredencialesHopEnvios } from './credenciales/hopenvios';

// Re-export para que CourierFactory pueda importar el tipo desde un solo lugar
// (mismo patrón que Oca/CorreoArgentino re-exportando sus creds).
export type { CredencialesHopEnvios } from './credenciales/hopenvios';

// DEUDA 141 (Hop Envíos): timeout de outbound fetch + reclasificación de AbortError
// como CourierTimeout. 8s consistente con los otros adapters — Hop es REST, budget
// típico < 2s por endpoint.
const COURIER_TIMEOUT_MS = 8000;

async function fetchConTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COURIER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("CourierTimeout: Hop Envíos no respondió en " + COURIER_TIMEOUT_MS + "ms");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// URL default: sandbox de Hop. Producción no es pública — se setea via env
// HOP_BASE_URL (leído por credenciales/hopenvios.ts obtenerShipro).
const HOP_SANDBOX_URL = "https://sandbox-api.hopenvios.com.ar";

export class HopEnviosAdapter implements ICourierIntegrator {
  private baseUrl: string;
  private creds: CredencialesHopEnvios;

  // DEUDA 141: el campo `amount` de la respuesta pricing/estimate no documenta
  // IVA. Se trata como neto — mismo criterio conservador que OCA y CA. Si Hop
  // confirma que los precios incluyen IVA, este flag pasa a true.
  readonly tarifaApiIncluyeIva = false;

  // Cache de token con expiración real (del campo expires_in de /login) + lock
  // anti-race-condition. Mismo patrón que MocisAdapter/AndreaniAdapter para que
  // N requests concurrentes con cache vencido hagan UNA sola llamada a /login.
  private tokenValor: string | null = null;
  private tokenExpiraAt: number = 0; // epoch absoluto en segundos
  private tokenPromise: Promise<string> | null = null;

  constructor(credenciales: CredencialesHopEnvios) {
    this.creds = credenciales;
    this.baseUrl = credenciales.baseUrl?.trim() || HOP_SANDBOX_URL;
  }

  // ==========================================
  // 1. AUTENTICACIÓN — token + refresh + lock
  // ==========================================
  private async getToken(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    const MARGEN_SEGUNDOS = 60;

    if (this.tokenValor && this.tokenExpiraAt > ahora + MARGEN_SEGUNDOS) {
      return this.tokenValor;
    }
    if (this.tokenPromise) {
      return this.tokenPromise;
    }
    this.tokenPromise = this.refreshToken();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  private async refreshToken(): Promise<string> {
    const formData = new URLSearchParams();
    formData.append("client_id", this.creds.clientId);
    formData.append("client_secret", this.creds.clientSecret);
    formData.append("email", this.creds.email);
    formData.append("password", this.creds.password);

    const res = await fetchConTimeout(`${this.baseUrl}/api/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!res.ok) {
      throw new Error("Hop Envíos rechazó las credenciales");
    }

    const data: any = await res.json().catch(() => null);
    const accessToken: string | undefined =
      typeof data?.access_token === "string" ? data.access_token.trim() : undefined;
    const expiresIn: number = Number(data?.expires_in) || 3600;

    if (!accessToken) {
      throw new Error("Hop Envíos rechazó las credenciales");
    }

    this.tokenValor = accessToken;
    this.tokenExpiraAt = Math.floor(Date.now() / 1000) + expiresIn;
    return accessToken;
  }

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  // Wrapper: intenta la request; si el server responde 401, fuerza refresh de
  // token y reintenta UNA vez. Cualquier otro fail bubblea intacto.
  private async fetchWithAuth(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const auth = await this.authHeader();
    const res1 = await fetchConTimeout(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...auth },
    });
    if (res1.status !== 401) return res1;

    // 401 → invalidar cache + re-login + retry único.
    this.tokenValor = null;
    this.tokenExpiraAt = 0;
    const auth2 = await this.authHeader();
    return await fetchConTimeout(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...auth2 },
    });
  }

  // ==========================================
  // 2. COTIZAR (GET /api/v1/pricing/estimate)
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<{ servicio: string; precioNeto: number }[]> {
    const totalPesoKg = params.paquetes.reduce((s, p) => s + (Number(p.pesoKg) || 0), 0);
    const maxAlto = params.paquetes.reduce((m, p) => Math.max(m, Number(p.altoCm) || 0), 0);
    const maxAncho = params.paquetes.reduce((m, p) => Math.max(m, Number(p.anchoCm) || 0), 0);
    const maxLargo = params.paquetes.reduce((m, p) => Math.max(m, Number(p.largoCm) || 0), 0);
    const totalValor = params.paquetes.reduce((s, p) => s + (Number(p.valorDeclarado) || 0), 0);

    const query = new URLSearchParams();
    query.append("origin_zipcode", String(params.cpOrigen));
    query.append("destiny_zipcode", String(params.cpDestino));
    query.append("shipping_type", "E");
    query.append("package[value]", String(Math.round(totalValor)));
    query.append("package[height]", String(Math.round(maxAlto)));
    query.append("package[length]", String(Math.round(maxLargo)));
    query.append("package[width]", String(Math.round(maxAncho)));
    query.append("package[weight]", String(Math.round(totalPesoKg * 1000))); // kg → gramos
    query.append("seller_code", this.creds.sellerCode);
    query.append("country_code", "AR");

    const url = `${this.baseUrl}/api/v1/pricing/estimate?${query.toString()}`;
    const res = await this.fetchWithAuth(url, { method: "GET" });

    // HTTP-fail o sin amount → no cobertura. Mismo criterio que Mocis/OCA/CA:
    // "no ofrecer" es más honesto que mostrar tarifa de rescate.
    if (!res.ok) {
      console.info(
        `[Hop Envíos] pricing HTTP ${res.status} para ${params.cpOrigen}→${params.cpDestino} — se oculta del checkout`,
      );
      return [];
    }

    const data: any = await res.json().catch(() => null);
    const amountRaw = data?.amount;
    const precioNeto = parseFloat(String(amountRaw ?? "").replace(",", "."));
    if (!Number.isFinite(precioNeto) || precioNeto <= 0) {
      console.info(
        `[Hop Envíos] sin tarifa para ${params.cpOrigen}→${params.cpDestino} (respuesta sin amount, se oculta del checkout)`,
      );
      return [];
    }

    const desc: string =
      typeof data?.package_description === "string" && data.package_description.trim()
        ? data.package_description.trim()
        : "";
    const servicio = desc ? `Hop Envíos — ${desc}` : "Hop Envíos";

    console.info(
      `[Hop Envíos] tarifa OK ${params.cpOrigen}→${params.cpDestino} amount=${precioNeto}`,
    );
    return [{ servicio, precioNeto }];
  }

  // Helpers: shipping_type + sub_type según tipoEntrega del sistema.
  private resolveShippingType(tipoEntrega?: string): string {
    return tipoEntrega === "devolucion" || tipoEntrega === "cambio" ? "R" : "E";
  }
  private resolveSubType(tipoEntrega?: string): string {
    return tipoEntrega === "devolucion" || tipoEntrega === "cambio" ? "DV" : "";
  }

  // ==========================================
  // 3. DESPACHAR (POST /api/v1/shipping — Familia 2)
  // Un request por bulto: N paquetes → N POSTs secuenciales → N trackings.
  // La complejidad Familia 2 queda escondida en el adapter.
  // ==========================================
  async despachar(
    params: DespachoParams,
  ): Promise<{ tracking: string; etiquetaBase64?: string; etiquetaUrl?: string; bultos?: ResultadoBulto[] }> {
    if (!params.paquetes || params.paquetes.length === 0) {
      throw new Error("Hop Envíos: despachar sin paquetes");
    }

    const shipping_type = this.resolveShippingType(params.tipoEntrega);
    const sub_type = this.resolveSubType(params.tipoEntrega);

    const bultos: ResultadoBulto[] = [];

    for (let i = 0; i < params.paquetes.length; i++) {
      const p = params.paquetes[i];

      const senderObj = params.origen
        ? {
            id_number: params.remitente?.cuit ?? "",
            name: params.remitente?.nombre ?? "",
            phone: params.remitente?.telefono ?? params.origen.telefono ?? "",
            mail: params.remitente?.email ?? params.origen.email ?? "",
            address_line: `${params.origen.calle} ${params.origen.altura}`,
            street_name: params.origen.calle,
            street_number: params.origen.altura,
            comment: "",
            zip_code: params.origen.cp,
            city_name: params.origen.localidad,
            state_name: params.origen.provincia,
            latitude: null,
            longitude: null,
            country: "AR",
          }
        : undefined;

      const body: Record<string, unknown> = {
        shipping_type,
        sub_type,
        reference_id: `${params.referencia ?? "SHIPRO"}-${i}`,
        seller_code: this.creds.sellerCode,
        storage_code: "DEPOSITO",
        days_offset: 0,
        label_type: "JPEG",
        country: "AR",
        client: {
          name: params.destinatarioNombre,
          email: params.email,
          id_type: "DNI",
          id_number: params.dni,
          telephone: params.telefono,
        },
        package: {
          width: String(Math.round(Number(p.anchoCm) || 0)),
          length: String(Math.round(Number(p.largoCm) || 0)),
          height: String(Math.round(Number(p.altoCm) || 0)),
          value: String(Math.round(Number(p.valorDeclarado) || 0)),
          weight: String(Math.round((Number(p.pesoKg) || 0) * 1000)), // kg → gramos
        },
      };
      if (senderObj) body.sender = senderObj;

      const res = await this.fetchWithAuth(`${this.baseUrl}/api/v1/shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        throw new Error(
          `Hop Envíos shipping HTTP ${res.status} bulto ${i + 1}: ${detalle}`.slice(0, 300),
        );
      }

      const data: any = await res.json().catch(() => null);
      const trackingNumber: string =
        typeof data?.tracking_nro === "string" && data.tracking_nro.trim()
          ? data.tracking_nro.trim()
          : typeof data?.trackingNumber === "string" && data.trackingNumber.trim()
          ? data.trackingNumber.trim()
          : "";

      if (!trackingNumber) {
        const preview = JSON.stringify(data ?? {}).slice(0, 300);
        throw new Error(
          `Hop Envíos no devolvió tracking para el bulto ${i + 1}. Respuesta: ${preview}`,
        );
      }

      const labelUrl: string | undefined =
        typeof data?.label_url === "string" && data.label_url.trim()
          ? data.label_url.trim()
          : undefined;

      const bulto: ResultadoBulto = { tracking: trackingNumber };
      if (labelUrl) bulto.etiquetaUrl = labelUrl;
      bultos.push(bulto);
    }

    console.log(
      `[Hop Envíos] despacho OK bultos=${bultos.length} primerTracking=${bultos[0].tracking}`,
    );

    const primerLabel = bultos[0].etiquetaUrl;
    const ret: { tracking: string; etiquetaUrl?: string; bultos?: ResultadoBulto[] } = {
      tracking: bultos[0].tracking,
      bultos,
    };
    if (primerLabel) ret.etiquetaUrl = primerLabel;
    return ret;
  }

  // ==========================================
  // 4. OBTENER ETIQUETA
  // Hop devuelve label_url pública en el despacho — acá bajamos los bytes.
  // ==========================================
  async obtenerEtiquetaBuffer(ref: { trackingNumber: string; etiquetaUrl: string | null }): Promise<Uint8Array> {
    if (!ref.etiquetaUrl) {
      throw new Error(
        `Hop Envíos: no hay URL de etiqueta para ${ref.trackingNumber}. Re-despachá para regenerar.`,
      );
    }
    const res = await fetchConTimeout(ref.etiquetaUrl, { method: "GET" });
    if (!res.ok) {
      throw new Error(
        `Hop Envíos: error al descargar etiqueta (HTTP ${res.status}) para ${ref.trackingNumber}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // ==========================================
  // 5. RASTREAR (GET /api/v1/tracking/{tracking})
  // ==========================================
  async rastrear(tracking: string): Promise<string> {
    try {
      const res = await this.fetchWithAuth(
        `${this.baseUrl}/api/v1/tracking/${encodeURIComponent(tracking)}`,
        { method: "GET" },
      );
      if (!res.ok) return "Error de Conexión";
      const data: any = await res.json().catch(() => null);
      const raw: string =
        typeof data?.last_status === "string"
          ? data.last_status
          : typeof data?.status === "string"
          ? data.status
          : "";
      if (!raw || String(raw).trim().length === 0) return "Desconocido";
      return this.traducirEstado(String(raw).trim());
    } catch (e) {
      return "Error de Conexión";
    }
  }

  // ==========================================
  // 6. TRADUCIR ESTADO (Hop → canónica Shipro)
  // ==========================================
  traducirEstado(estadoCrudo: string): string {
    const raw = String(estadoCrudo).trim();
    const norm = raw.toLowerCase();

    if (raw === "E-CON") return "ETIQUETA_CREADA";
    if (raw === "E-LIS") return "EN_CAMINO";
    if (raw === "E-ENT") return "ENTREGADO";

    if (norm === "confirmado") return "ETIQUETA_CREADA";
    if (norm === "listo para retirar") return "EN_CAMINO";
    if (norm === "entregado a cliente") return "ENTREGADO";

    if (norm.includes("cancel")) return "CANCELADO";
    if (norm.includes("devol")) return "DEVUELTO";

    return estadoCrudo;
  }

  // ==========================================
  // 7. OBTENER SUCURSALES (GET /api/v3/pickup_points)
  // Sin filtro por CP: devuelve todos los puntos del seller. La plataforma
  // filtra por proximidad después. Filtramos solo enable + habilitados para
  // deliveries/drop_off (los "cerrados" o no operativos no se ofrecen).
  // ==========================================
  async obtenerSucursales(_cp: string): Promise<SucursalInfo[]> {
    try {
      const query = new URLSearchParams();
      query.append("country", "AR");
      query.append("seller_code", this.creds.sellerCode);

      const res = await this.fetchWithAuth(
        `${this.baseUrl}/api/v3/pickup_points?${query.toString()}`,
        { method: "GET" },
      );
      if (!res.ok) {
        console.warn(`[Hop Envíos] pickup_points HTTP ${res.status}, se devuelve []`);
        return [];
      }
      const data: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.pickup_points)
        ? data.pickup_points
        : Array.isArray(data?.data)
        ? data.data
        : [];

      const sucursales: SucursalInfo[] = [];
      for (const it of items) {
        const enable = it?.enable === true;
        const habilitado =
          it?.allow_deliveries === true || it?.allow_drop_off === true;
        if (!enable || !habilitado) continue;

        const id = it?.id;
        if (id == null) continue;

        const suc: SucursalInfo = {
          id: String(id),
          nombre: String(it?.reference_name ?? "").trim(),
          direccion: `${String(it?.street ?? "").trim()} ${String(it?.door_number ?? "").trim()}`.trim(),
          localidad: String(it?.city ?? "").trim(),
          provincia: String(it?.state ?? "").trim(),
          cp: String(it?.zip_code ?? "").trim(),
        };
        const lat = parseFloat(String(it?.lat ?? "").replace(",", "."));
        const lng = parseFloat(String(it?.lng ?? "").replace(",", "."));
        if (Number.isFinite(lat)) suc.latitud = lat;
        if (Number.isFinite(lng)) suc.longitud = lng;

        sucursales.push(suc);
      }
      return sucursales;
    } catch (e) {
      console.warn(
        "[Hop Envíos] obtenerSucursales falló:",
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  }

  // ==========================================
  // 8. CANCELAR (DELETE /api/v1/shipping/{tracking})
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> {
    const res = await this.fetchWithAuth(
      `${this.baseUrl}/api/v1/shipping/${encodeURIComponent(tracking)}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(
        `Hop Envíos cancelación HTTP ${res.status} para ${tracking}: ${detalle}`.slice(0, 300),
      );
    }

    const data: any = await res.json().catch(() => null);
    if (Number(data?.status) === 200) return true;
    console.warn(
      `[Hop Envíos] cancelación devolvió status distinto de 200: ${JSON.stringify(data ?? {}).slice(0, 200)}`,
    );
    return false;
  }

  // ==========================================
  // 9. SOLICITAR RECOLECCIÓN (stub — no aplica a Hop PUDO)
  // ==========================================
  async solicitarRecoleccion(_fecha: Date, _cantidadBultos: number, _direccionOrigen: string): Promise<string> {
    throw new Error(
      "Hop Envíos: solicitarRecoleccion no implementado — la recolección se coordina a través de los Puntos HOP",
    );
  }
}
