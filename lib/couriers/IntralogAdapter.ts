import { ICourierIntegrator, CotizacionParams, DespachoParams, SucursalInfo, ResultadoBulto } from './CourierInterface';

// =============================================================================
// Intralog adapter. FASE 1 = courier de ENTREGA a domicilio (AMBA/INTERIOR según CP).
// FASE 2 (recolección/consolidación vía terceros) pendiente de info comercial de César
// Jaimes — solicitarRecoleccion queda como stub. Modalidades sucursal (PICK UP), express
// e inversa apagadas en serviciosSoportados hasta confirmar.
// =============================================================================
// Molde: MocisAdapter. Auth JWT (bearer), token cache + anti-race lock, fetchConTimeout
// (8s, mismo threshold que Mocis para respetar el circuit breaker de Tiendanube),
// !res.ok throw (falla real de sistema), respuesta válida-negativa → [] (courier dice
// "no puedo cotizar este destino", no ocultamos el checkout).
//
// API base: https://intralog.azurewebsites.net (todas las rutas verificadas con vendor).
// - POST /api/login → {access_token} (JWT, exp 10 días, sin refresh endpoint: re-login).
// - POST /intralog/pedido/cotizar → {error, total} (total NETO, sin IVA).
// - POST /intralog/heritas/pedido → {status, mensaje, tracking_url, lpns[]}.
// - GET  /intralog/pedido/:nro_pedido/etiqueta → PDF binario directo.
// - GET  /intralog/pedido/:nro_pedido/seguimiento → [{codigo, fecha, mensaje}].
// - POST /intralog/pedido/:nro_pedido/cancelar → {status, mensaje}.
// - :nro_pedido usado por etiqueta/tracking/cancelar = NUESTRO nro_pedido_seller.

// DEUDA 129: mismo timeout+reclasificación que Mocis (8s < circuit breaker Tiendanube 10s).
const COURIER_TIMEOUT_MS = 8000;

async function fetchConTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COURIER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("CourierTimeout: Intralog no respondió en " + COURIER_TIMEOUT_MS + "ms");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class IntralogAdapter implements ICourierIntegrator {
  private API_URL = 'https://intralog.azurewebsites.net';
  private usuario: string;
  private password: string;

  // César (Intralog) carga tarifas NETAS en su sistema (decisión de negocio Shipro,
  // homogéneo cross-courier post-DEUDA 123). El motor NO strippea IVA al intake.
  readonly tarifaApiIncluyeIva = false;

  private tokenActual: string | null = null;
  private tokenExpira: number = 0;             // epoch seconds
  private tokenPromise: Promise<string> | null = null;

  constructor(usuario: string, password: string) {
    this.usuario = usuario;
    this.password = password;
  }

  // ==========================================
  // 1. AUTENTICACIÓN
  //
  // Mismo patrón que Mocis: cache de token con margen de expiración + lock
  // anti-race (tokenPromise) para que N requests concurrentes con cache
  // vencido hagan UNA sola llamada a /api/login.
  //
  // Intralog: JWT vive 10 días. El login response NO devuelve un expiry
  // legible (sólo access_token). Seteamos tokenExpira = now + 9 días como
  // margen conservador (bajo del exp real). Sin refresh endpoint — al vencer
  // se hace re-login.
  // ==========================================
  private async getToken(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    const MARGEN_SEGUNDOS = 300; // 5 min

    if (this.tokenActual && this.tokenExpira > ahora + MARGEN_SEGUNDOS) {
      return this.tokenActual;
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
    const res = await fetchConTimeout(`${this.API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuarioNombre: this.usuario, usuarioPassword: this.password }),
    });

    if (!res.ok) {
      throw new Error(`Intralog HTTP ${res.status} al autenticar (login rechazado — verificar usuario/password)`);
    }

    const data = await res.json();
    const raw = String(data?.access_token ?? "");
    // Strip leading "Bearer " if present (por si el server lo devuelve prefijado).
    const token = raw.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new Error("Intralog rechazó las credenciales — response sin access_token.");
    }

    this.tokenActual = token;
    // JWT exp = 10 días; sin expiry legible en response → margen conservador 9 días.
    this.tokenExpira = Math.floor(Date.now() / 1000) + (9 * 24 * 3600);
    return token;
  }

  // ==========================================
  // 2. COTIZAR
  //
  // FASE 1: solo entrega a domicilio. La API acepta modalidad como zona de
  // cobertura ("Intralog - AMBA" | "INTERIOR"), NO como tipo de servicio.
  // Heurística provisoria: CP arrancando en 1 → AMBA (CABA/GBA), else INTERIOR.
  // TODO refinar con tabla real de zonas Intralog cuando esté disponible.
  //
  // params.tipoEntrega==='sucursal' es FASE 2 (PICK UP); defensivamente mapeamos
  // a "PICK UP" por si algún path envía sucursal antes del gate del cotizador
  // (que ya lo bloquea vía serviciosSoportados).
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<{ servicio: string, precioNeto: number }[]> {
    const token = await this.getToken();

    const modalidad = params.tipoEntrega === 'sucursal'
      ? "PICK UP"
      : (params.cpDestino.startsWith("1") ? "Intralog - AMBA" : "INTERIOR");

    const paquetes = params.paquetes.map(p => ({
      alto: p.altoCm ?? 10,
      ancho: p.anchoCm ?? 10,
      largo: p.largoCm ?? 10,
      peso: p.pesoKg ?? 1,
      cantidad: 1,
    }));

    const res = await fetchConTimeout(`${this.API_URL}/intralog/pedido/cotizar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        codigo_postal_origen: params.cpOrigen,
        codigo_postal_destino: params.cpDestino,
        modalidad,
        paquetes,
      }),
    });

    // HTTP-level failure = falla real de sistema — throw para que el cotizador use
    // la tarifa de rescate (DEUDA 129 refinement, mismo patrón que Mocis).
    if (!res.ok) {
      throw new Error(`Intralog HTTP ${res.status} al cotizar`);
    }

    const data = await res.json();

    // Respuesta válida negativa (200 OK pero courier dice "no puedo cotizar este
    // destino"): error no vacío o total inválido → [] para que el cotizador
    // OCULTE Intralog del checkout (no dispara la tarifa de rescate). Ver DEUDA 129.
    const totalNum = Number(data?.total);
    const errorMsg = typeof data?.error === 'string' ? data.error.trim() : "";
    if (!Number.isFinite(totalNum) || totalNum <= 0 || errorMsg.length > 0) {
      console.info(`[Intralog] sin tarifa para ${params.cpOrigen}→${params.cpDestino} modalidad=${modalidad} (respuesta válida negativa, se oculta del checkout): ${errorMsg || "total ausente/inválido"}`);
      return [];
    }

    // Intralog devuelve UN total (no un array de servicios), y en NETO (César
    // carga tarifas sin IVA — coincide con tarifaApiIncluyeIva=false arriba).
    return [{ servicio: "Estándar", precioNeto: totalNum }];
  }

  // ==========================================
  // 3. DESPACHAR
  //
  // FASE 1: solo entrega a domicilio, sin operador logístico tercero, sin punto
  // de entrega (PICK UP). El tracking handle que usan etiqueta/tracking/cancelar
  // es NUESTRO nro_pedido_seller (confirmado con vendor), así que lo usamos como
  // tracking principal del retorno.
  // ==========================================
  async despachar(params: DespachoParams): Promise<{ tracking: string, etiquetaBase64?: string, etiquetaUrl?: string, bultos?: ResultadoBulto[] }> {
    const token = await this.getToken();

    // Tracking handle: preferir el ref del caller (dispatch); si no viene,
    // generar un SHP-* provisorio. NOTA: nro_pedido_seller ES nuestro tracking
    // Intralog — todo lookup posterior (etiqueta / seguimiento / cancelar) usa
    // este string, no un id devuelto por Intralog.
    const nroPedidoSeller = params.referencia && params.referencia.trim().length > 0
      ? params.referencia.trim()
      : `SHP-${Date.now()}`;

    // Remitente: preferir params.origen (DEUDA 4 depósito real); fallback con warn.
    let remitente;
    if (params.origen) {
      remitente = {
        nombre: params.remitente?.nombre ?? "Remitente",
        calle: params.origen.calle,
        numero: params.origen.altura,
        piso: null as string | null,
        depto: null as string | null,
        localidad: params.origen.localidad,
        provincia: params.origen.provincia,
        codigo_postal: params.origen.cp,
        telefono: params.origen.telefono ?? params.remitente?.telefono ?? "",
        mail: params.origen.email ?? params.remitente?.email ?? "",
        observaciones: "",
      };
    } else {
      console.warn("[IntralogAdapter] despachar sin params.origen — usando fallback hardcoded. Callers deben pasar `origen` (DEUDA 4).");
      remitente = {
        nombre: params.remitente?.nombre ?? "Remitente",
        calle: "",
        numero: "",
        piso: null as string | null,
        depto: null as string | null,
        localidad: "",
        provincia: "",
        codigo_postal: "",
        telefono: params.remitente?.telefono ?? "",
        mail: params.remitente?.email ?? "",
        observaciones: "",
      };
    }

    const destinatario = {
      nombre: params.destinatarioNombre,
      calle: params.calle,
      numero: params.altura,
      piso: params.piso ?? null,
      depto: params.dpto ?? null,
      localidad: params.localidad,
      provincia: params.provincia ?? "",
      codigo_postal: params.cp,
      telefono: params.telefono,
      mail: params.email,
      observaciones: params.referencia ?? "",
    };

    const paquetesTotales = Array.isArray(params.paquetes) ? params.paquetes : [];
    const bultosCantidad = paquetesTotales.length;
    const pesoTotal = paquetesTotales.reduce((acc, p) => acc + (p.pesoKg || 0), 0);
    const metrosCubicos = paquetesTotales.reduce(
      (acc, p) => acc + ((p.altoCm || 0) * (p.anchoCm || 0) * (p.largoCm || 0)) / 1_000_000,
      0
    );
    const valorDeclaradoTotal = paquetesTotales.reduce((acc, p) => acc + (p.valorDeclarado || 0), 0);

    const paquetesBody = paquetesTotales.map(p => ({
      alto: p.altoCm ?? 10,
      ancho: p.anchoCm ?? 10,
      largo: p.largoCm ?? 10,
      peso: p.pesoKg ?? 1,
      // sku no-vacío — Intralog rechaza sku="" con rollback de constraint
      // (backend Java). Usamos el contenido o un placeholder; el DespachoParams
      // no trae SKU real.
      productos: [{ cantidad: 1, nombre: p.contenido ?? "Paquete", sku: p.contenido ?? "SIN-SKU" }],
    }));

    const body = {
      bultos: bultosCantidad,
      destinatario,
      remitente,
      es_express: false,                   // FASE 1: sin express.
      id_tienda: null,
      metros_cubicos: metrosCubicos,
      nro_pedido_seller: nroPedidoSeller,
      paquetes: paquetesBody,
      peso: pesoTotal,
      valor_declarado: valorDeclaradoTotal,
      operador_logistico_asignado: null,   // FASE 1: entrega directa Intralog, sin tercero.
      punto_entrega: null,                 // FASE 1: sin sucursal PICK UP.
    };

    console.log("[INTRALOG-DBG] body imposicion:", JSON.stringify(body));

    const res = await fetchConTimeout(`${this.API_URL}/intralog/heritas/pedido`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Intralog HTTP ${res.status} al despachar`);
    }

    const data = await res.json();
    if (data?.status === false) {
      throw new Error(`Intralog rechazó el despacho: ${data?.mensaje ?? "sin mensaje"}`);
    }

    const lpns: string[] = Array.isArray(data?.lpns) ? data.lpns : [];
    const bultosResult: ResultadoBulto[] = lpns.map((lpn, i) => ({
      tracking: lpn,
      numeroBulto: lpn,
      totalizador: `${i + 1}/${lpns.length}`,
    }));

    return {
      // Principal tracking = nro_pedido_seller (nuestro id, el que Intralog usa
      // para etiqueta/tracking/cancelar). Los lpns[] son per-bulto.
      tracking: nroPedidoSeller,
      bultos: bultosResult,
    };
  }

  // ==========================================
  // 4. OBTENER ETIQUETA (PDF binario directo, confirmado con vendor).
  // ==========================================
  async obtenerEtiquetaBuffer(ref: { trackingNumber: string; etiquetaUrl: string | null }): Promise<Uint8Array> {
    const token = await this.getToken();
    const res = await fetchConTimeout(`${this.API_URL}/intralog/pedido/${ref.trackingNumber}/etiqueta`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Intralog HTTP ${res.status} al descargar etiqueta ${ref.trackingNumber}`);
    }
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // ==========================================
  // 5. RASTREAR
  //
  // El endpoint devuelve el historial del pedido: [{codigo, fecha, mensaje}].
  // Intralog: "el estado del pedido es el peor de sus paquetes" — el endpoint
  // ya refleja ese cómputo. Tomamos el ÚLTIMO evento (el más reciente) como
  // el estado vigente y lo traducimos a canónico Shipro.
  // ==========================================
  async rastrear(tracking: string): Promise<string> {
    const token = await this.getToken();
    const res = await fetchConTimeout(`${this.API_URL}/intralog/pedido/${tracking}/seguimiento`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Intralog HTTP ${res.status} al rastrear ${tracking}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return this.traducirEstado("");
    }
    const ultimo = data[data.length - 1];
    return this.traducirEstado(String(ultimo?.codigo ?? ""));
  }

  // ==========================================
  // 6. TRADUCIR ESTADO
  //
  // Mapea los 17 códigos internos de Intralog al vocabulario canónico Shipro
  // (lib/utils/estados.ts ESTADOS_COURIER). Sub-estados de "problema de entrega"
  // que no bloquean re-visita (AUSENTE) → VISITA_FALLIDA; los que sí bloquean
  // (DOMICILIO_INCORRECTO, RECHAZADO, ZONA_PELIGROSA, FUERA_DE_RUTA) →
  // INCIDENCIA. EXTRAVIADO no tiene canónico directo → INCIDENCIA (el estado
  // crudo se preserva en EventoTracking.observacion para diagnóstico).
  // ==========================================
  traducirEstado(estadoCrudo: string): string {
    const estado = estadoCrudo.toUpperCase().trim();
    const map: Record<string, string> = {
      "PENDIENTE": "ETIQUETA_CREADA",
      "COLECTADO": "PAQUETE_RECOLECTADO",
      "RECIBIDO": "EN_TRANSITO_A_DESTINO",
      "RUTEADO": "EN_TRANSITO_A_DESTINO",
      "DESPACHADO": "EN_TRANSITO_A_DESTINO",
      "EN_TRONCAL": "EN_TRANSITO_A_DESTINO",
      "EN_SUCURSAL": "EN_SUCURSAL_DE_DESTINO",
      "AUSENTE": "VISITA_FALLIDA",
      "DOMICILIO_INCORRECTO": "INCIDENCIA",
      "RECHAZADO": "INCIDENCIA",
      "ZONA_PELIGROSA": "INCIDENCIA",
      "FUERA_DE_RUTA": "INCIDENCIA",
      "ENTREGADO": "ENTREGADO",
      "EXTRAVIADO": "INCIDENCIA",             // sin canónico directo — INCIDENCIA + raw preservado en observacion
      "CANCELADO": "CANCELADO",
      "ANULADO": "CANCELADO",
      "DEVOLUCION_CTE": "DEVUELTO_AL_REMITENTE",
    };
    return map[estado] ?? estado;
  }

  // ==========================================
  // 7. OBTENER SUCURSALES
  //
  // FASE 1: [] — sucursal (PICK UP) es FASE 2. Intralog lista sucursales por
  // provincia (GET /intralog/sucursales_correo/:provincia); se cablea cuando
  // se enable la modalidad sucursal en serviciosSoportados.
  // ==========================================
  async obtenerSucursales(_cp: string): Promise<SucursalInfo[]> {
    return [];
  }

  // ==========================================
  // 8. CANCELAR
  //
  // POST /intralog/pedido/:nro_pedido/cancelar. Los límites (deadline por
  // estado, cutoff comercial) no están documentados por el vendor — el
  // server decide si acepta. Devolvemos true si HTTP OK y status distinto
  // de false.
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> {
    const token = await this.getToken();
    const res = await fetchConTimeout(`${this.API_URL}/intralog/pedido/${tracking}/cancelar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return false;
    try {
      const data = await res.json();
      return data?.status !== false;
    } catch {
      return true;
    }
  }

  // ==========================================
  // 9. SOLICITAR RECOLECCIÓN — FASE 2 stub.
  // ==========================================
  async solicitarRecoleccion(_fecha: Date, _cantidadBultos: number, _direccionOrigen: string): Promise<string> {
    throw new Error("Intralog: solicitarRecoleccion (consolidación) no implementado — FASE 2, pendiente de definición operativa/comercial con César Jaimes (etiqueta de recolección + operador_logistico_asignado + tarifa DIST)");
  }
}
