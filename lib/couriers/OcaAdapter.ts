import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo,
  ResultadoBulto,
} from './CourierInterface';

// DEUDA 141 P1 (OCA e-Pak): timeout de outbound fetch + reclasificación de
// AbortError como CourierTimeout (crear.ts lo mapea a HTTP 503). Mismo patrón
// que Andreani/Mocis. OCA (SOAP legacy) tiene budget más alto que los REST
// modernos, pero 8s alcanza para las operaciones típicas de e-Pak.
const COURIER_TIMEOUT_MS = 8000;

async function fetchConTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COURIER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("CourierTimeout: OCA no respondió en " + COURIER_TIMEOUT_MS + "ms");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// DEUDA 141 P1 — Credenciales OCA e-Pak.
// =============================================================================
// El usuario/password viajan como parámetros PLAIN en cada request (no hay
// token de sesión). cuit + nrocuenta + operativa_* son datos comerciales que
// OCA asigna al cliente al firmar el contrato e-Pak.
// =============================================================================
export interface CredencialesOca {
  usuario: string;
  password: string;
  cuit: string;                    // con guiones: "30-12345678-9"
  nrocuenta: string;               // e.g. "111757/001"
  operativa_domicilio: string;     // código numérico acordado con OCA (e.g. "64665")
  operativa_sucursal?: string;
  operativa_inversa?: string;
  sandbox?: boolean;               // true → QA endpoint; false/undefined → producción
}

const OCA_URL_PROD = "https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx";
const OCA_URL_QA = "https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx";
const OCA_SOAP_NS = "http://www.tpcb.com.ar/";

// XML-escape para valores de atributos y contenido: pass-through defensivo para
// evitar romper el envelope cuando datos del cliente traen &, <, > o comillas.
function escapeXml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Fecha de hoy en formato YYYYMMDD (OCA la exige así en <origen fecha="..."/>).
function fechaHoyYYYYMMDD(): string {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export class OcaAdapter implements ICourierIntegrator {
  private baseUrl: string;
  private creds: CredencialesOca;

  // DEUDA 141 P1: OCA e-Pak Tarifar_Envio_Corporativo devuelve precio NETO
  // (verificado en documentación oficial e-Pak). Los otros métodos (etiquetas,
  // rastreo, cancel) no exponen precios así que este flag sólo pesa en cotizar.
  readonly tarifaApiIncluyeIva = false;

  constructor(credenciales: CredencialesOca) {
    this.creds = credenciales;
    this.baseUrl = credenciales.sandbox ? OCA_URL_QA : OCA_URL_PROD;
  }

  // ==========================================
  // XML HELPERS (SIN dependencias externas — mismo estilo que Andreani/Mocis)
  // ==========================================

  private buildSoapEnvelope(methodName: string, params: Record<string, string>): string {
    const cuerpo = Object.entries(params)
      .map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`)
      .join("\n");
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${methodName} xmlns="${OCA_SOAP_NS}">
${cuerpo}
    </${methodName}>
  </soap:Body>
</soap:Envelope>`;
  }

  private parseXmlValue(xml: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = xml.match(re);
    return m ? m[1] : null;
  }

  private parseXmlValues(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) results.push(m[1]);
    return results;
  }

  // ==========================================
  // SOAP POST — helper común para todos los métodos SOAP de e-Pak.
  // ==========================================
  private async soapPost(methodName: string, params: Record<string, string>): Promise<string> {
    const envelope = this.buildSoapEnvelope(methodName, params);
    const res = await fetchConTimeout(`${this.baseUrl}/${methodName}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"${OCA_SOAP_NS}${methodName}"`,
      },
      body: envelope,
    });
    if (!res.ok) {
      throw new Error(`OCA SOAP ${res.status} en ${methodName}`);
    }
    return await res.text();
  }

  // Helper interno: resuelve la operativa OCA según tipoEntrega.
  private resolveOperativa(tipoEntrega?: string): string {
    if (tipoEntrega === "sucursal") return this.creds.operativa_sucursal ?? this.creds.operativa_domicilio;
    if (tipoEntrega === "inversa" || tipoEntrega === "cambio" || tipoEntrega === "devolucion") {
      return this.creds.operativa_inversa ?? this.creds.operativa_domicilio;
    }
    return this.creds.operativa_domicilio;
  }

  // ==========================================
  // 1. COTIZAR (Tarifar_Envio_Corporativo)
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<{ servicio: string; precioNeto: number }[]> {
    const pesoTotal = params.paquetes.reduce((s, p) => s + (Number(p.pesoKg) || 0), 0);
    const volumenTotalM3 = params.paquetes.reduce(
      (s, p) => s + ((Number(p.largoCm) || 0) * (Number(p.anchoCm) || 0) * (Number(p.altoCm) || 0)) / 1_000_000,
      0,
    );
    const valorDeclarado = params.paquetes.reduce((s, p) => s + (Number(p.valorDeclarado) || 0), 0);

    const xml = await this.soapPost("Tarifar_Envio_Corporativo", {
      Cuit: this.creds.cuit,
      Operativa: this.creds.operativa_domicilio,
      PesoTotal: pesoTotal.toFixed(2),
      VolumenTotal: volumenTotalM3.toFixed(6),
      CodigoPostalOrigen: params.cpOrigen,
      CodigoPostalDestino: params.cpDestino,
      CantidadPaquetes: String(params.paquetes.length),
      ValorDeclarado: String(Math.round(valorDeclarado)),
    });

    // Ancho de banda: OCA devuelve el precio en <precio>/<Precio> (case-insensitive
    // en el helper). Si el tarifario devuelve fila vacía o precio "0", tratamos como
    // "sin cobertura para este CP" (mismo patrón que Mocis: retornar [] para que el
    // cotizador oculte el courier del checkout, no muestre tarifa de rescate).
    const precioStr = this.parseXmlValue(xml, "precio")?.trim() ?? "";
    if (!precioStr || precioStr === "0" || precioStr === "0.00") {
      console.info(
        `[OCA] sin tarifa para ${params.cpOrigen}→${params.cpDestino} (respuesta vacía o precio 0, se oculta del checkout)`,
      );
      return [];
    }

    const precioNeto = parseFloat(precioStr.replace(",", "."));
    if (!Number.isFinite(precioNeto) || precioNeto <= 0) {
      console.info(
        `[OCA] precio inválido "${precioStr}" para ${params.cpOrigen}→${params.cpDestino} — oculta del checkout`,
      );
      return [];
    }

    console.info(
      `[OCA] tarifa OK ${params.cpOrigen}→${params.cpDestino} precio=${precioNeto}`,
    );
    return [{ servicio: "Estándar", precioNeto }];
  }

  // ==========================================
  // 2. DESPACHAR (IngresoORMultiplesRetiros_v2)
  // Este endpoint NO usa SOAP envelope — acepta POST url-encoded con:
  //   usr, psw, ConfirmarRetiro, XML_Datos (string XML serializado con el pedido)
  // ==========================================
  async despachar(
    params: DespachoParams,
  ): Promise<{ tracking: string; etiquetaBase64?: string; etiquetaUrl?: string; bultos?: ResultadoBulto[] }> {
    const operativa = this.resolveOperativa(params.tipoEntrega);
    const fecha = fechaHoyYYYYMMDD();

    const paquetesXml = params.paquetes
      .map((p) => {
        const valor = p.requiereSeguro ? (Number(p.valorDeclarado) || 0) : 0;
        return `        <paquete alto="${escapeXml(p.altoCm)}" ancho="${escapeXml(p.anchoCm)}" largo="${escapeXml(p.largoCm)}" peso="${escapeXml(p.pesoKg)}" valor="${escapeXml(valor)}" cant="1" />`;
      })
      .join("\n");

    const emailOrigen = params.remitente?.email ?? params.origen?.email ?? "";

    const xmlDatos = `<?xml version="1.0" encoding="iso-8859-1" standalone="yes"?>
<ROWS>
  <cabecera ver="2.0" nrocuenta="${escapeXml(this.creds.nrocuenta)}" origen="API" />
  <origenes>
    <origen calle="${escapeXml(params.origen?.calle)}" nro="${escapeXml(params.origen?.altura)}" piso="" depto="" cp="${escapeXml(params.origen?.cp)}" localidad="${escapeXml(params.origen?.localidad)}" provincia="${escapeXml(params.origen?.provincia)}" contacto="${escapeXml(params.remitente?.nombre)}" email="${escapeXml(emailOrigen)}" solicitante="" observaciones="" centrocosto="1" idfranjahoraria="1" idcentroimposicionorigen="0" fecha="${fecha}">
      <envios>
        <envio idoperativa="${escapeXml(operativa)}" nroremito="${escapeXml(params.referencia ?? "SHIPRO")}">
          <destinatario apellido="${escapeXml(params.destinatarioNombre)}" nombre="" calle="${escapeXml(params.calle)}" nro="${escapeXml(params.altura)}" piso="${escapeXml(params.piso ?? "")}" depto="${escapeXml(params.dpto ?? "")}" localidad="${escapeXml(params.localidad)}" provincia="${escapeXml(params.provincia ?? "")}" cp="${escapeXml(params.cp)}" telefono="${escapeXml(params.telefono)}" email="${escapeXml(params.email)}" idci="${escapeXml(params.sucursalDestinoId ?? "0")}" celular="" observaciones="" />
          <paquetes>
${paquetesXml}
          </paquetes>
        </envio>
      </envios>
    </origen>
  </origenes>
</ROWS>`;

    const formData = new URLSearchParams();
    formData.append("usr", this.creds.usuario);
    formData.append("psw", this.creds.password);
    formData.append("ConfirmarRetiro", "True");
    formData.append("XML_Datos", xmlDatos);

    const res = await fetchConTimeout(`${this.baseUrl}/IngresoORMultiplesRetiros_v2`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!res.ok) {
      throw new Error(`OCA SOAP ${res.status} en IngresoORMultiplesRetiros_v2`);
    }

    const xmlResp = await res.text();

    // Numeros de envío: OCA puede devolver múltiples en <NumeroEnvio> o
    // <numeroEnvio>. El helper es case-insensitive; probamos ambos nombres
    // canónicos y consolidamos. idOrdenRetiro se loguea para trazabilidad.
    const idOrdenRetiro = this.parseXmlValue(xmlResp, "idOrdenRetiro")?.trim() ?? "";
    const trackings = [
      ...this.parseXmlValues(xmlResp, "NumeroEnvio"),
      ...this.parseXmlValues(xmlResp, "numeroEnvio"),
    ]
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (trackings.length === 0) {
      throw new Error(
        `OCA no devolvió tracking. Respuesta: ${xmlResp.slice(0, 300)}`,
      );
    }

    console.log(
      `[OCA] despacho OK idOrdenRetiro=${idOrdenRetiro} bultos=${trackings.length} primerTracking=${trackings[0]}`,
    );

    const bultos: ResultadoBulto[] = trackings.map((t) => ({ tracking: t }));

    return {
      tracking: bultos[0].tracking,
      bultos,
    };
  }

  // ==========================================
  // 3. OBTENER ETIQUETA (GetEtiquetasPorOrdenOrNumeroEnvio_PDF)
  // Devuelve el PDF como Base64 dentro del XML de respuesta.
  // ==========================================
  async obtenerEtiquetaBuffer(ref: { trackingNumber: string; etiquetaUrl: string | null }): Promise<Uint8Array> {
    const xml = await this.soapPost("GetEtiquetasPorOrdenOrNumeroEnvio_PDF", {
      usr: this.creds.usuario,
      psw: this.creds.password,
      nroEnvio: ref.trackingNumber,
    });

    // Probar tags conocidos donde OCA suele empaquetar el Base64. El primero que
    // dé un string no-vacío se decodifica.
    const candidates = [
      "GetEtiquetasPorOrdenOrNumeroEnvio_PDFResult",
      "return",
      "pdf",
      "PDF",
    ];
    let base64: string | null = null;
    for (const tag of candidates) {
      const v = this.parseXmlValue(xml, tag);
      if (v && v.trim().length > 0) {
        base64 = v.trim();
        break;
      }
    }

    if (!base64) {
      throw new Error(
        `OCA no devolvió PDF para tracking ${ref.trackingNumber}. Respuesta: ${xml.slice(0, 300)}`,
      );
    }

    // Sanitizar el Base64: quitar whitespace/newlines que suelen venir dentro del XML.
    const clean = base64.replace(/\s+/g, "");
    return Buffer.from(clean, "base64");
  }

  // ==========================================
  // 4. RASTREAR (GetEnvioEstadoActual)
  // ==========================================
  async rastrear(tracking: string): Promise<string> {
    try {
      const xml = await this.soapPost("GetEnvioEstadoActual", {
        numeroEnvio: tracking,
      });
      const desc =
        this.parseXmlValue(xml, "EstadoDescripcion") ??
        this.parseXmlValue(xml, "estadoDescripcion");
      if (!desc || desc.trim().length === 0) return "Desconocido";
      return this.traducirEstado(desc.trim());
    } catch (e) {
      return "Error de Conexión";
    }
  }

  // ==========================================
  // 5. TRADUCIR ESTADO (IdEstadoPiezaOCA → canónica Shipro)
  // La entrada puede ser tanto el ID numérico como el texto de descripción — se
  // normaliza y se busca en el mismo map. Pass-through si no matchea.
  // ==========================================
  traducirEstado(estadoCrudo: string): string {
    const raw = estadoCrudo.trim();
    // Normalizar el texto para matching (case-insensitive, sin acentos):
    const norm = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

    const mapaId: Record<string, string> = {
      "29": "ETIQUETA_CREADA",
      "34": "ETIQUETA_CREADA",
      "35": "ETIQUETA_CREADA",
      "19": "EN_CAMINO",
      "12": "EN_CAMINO",
      "41": "EN_CAMINO",
      "42": "EN_CAMINO",
      "45": "EN_REPARTO",
      "9": "EN_REPARTO",
      "10": "VISITA_FALLIDA",
      "17": "ENTREGADO",
      "104": "ENTREGADO",
      "103": "ENTREGADO",
      "90": "DEVUELTO",
      "36": "RETENIDO",
    };
    if (mapaId[raw] !== undefined) return mapaId[raw];

    if (norm.includes("logico recibido")) return "ETIQUETA_CREADA";
    if (norm.includes("a imprimir")) return "ETIQUETA_CREADA";
    if (norm.includes("impresion realizada")) return "ETIQUETA_CREADA";
    if (norm.includes("a generar manifiesto")) return "EN_CAMINO";
    if (norm.includes("despachada a planta")) return "EN_CAMINO";
    if (norm.includes("despachada a sucursal")) return "EN_CAMINO";
    if (norm.includes("fisico recibido")) return "EN_CAMINO";
    if (norm.includes("en calle")) return "EN_REPARTO";
    if (norm.includes("a despachar a calle")) return "EN_REPARTO";
    if (norm === "visita" || norm.startsWith("visita")) return "VISITA_FALLIDA";
    if (norm.includes("archivada")) return "ENTREGADO";
    if (norm.includes("entregada en sucursal")) return "ENTREGADO";
    if (norm.includes("enviada al cliente")) return "ENTREGADO";
    if (norm.includes("devolucion por accion")) return "DEVUELTO";
    if (norm.includes("retenida")) return "RETENIDO";

    return estadoCrudo;
  }

  // ==========================================
  // 6. OBTENER SUCURSALES (GetCentrosImposicionConServiciosByCP)
  // ==========================================
  async obtenerSucursales(cp: string): Promise<SucursalInfo[]> {
    try {
      const xml = await this.soapPost("GetCentrosImposicionConServiciosByCP", {
        CodigoPostal: cp,
      });

      // OCA devuelve cada sucursal en <Centro> (más común) o variantes. Probamos
      // ambos wrappers y consolidamos por si el WSDL cambia el nombre.
      const centrosCrudos = [
        ...this.parseXmlValues(xml, "Centro"),
        ...this.parseXmlValues(xml, "CentroImposicion"),
        ...this.parseXmlValues(xml, "sucursal"),
      ];

      const sucursales: SucursalInfo[] = [];
      for (const c of centrosCrudos) {
        const id =
          this.parseXmlValue(c, "idci") ??
          this.parseXmlValue(c, "IdCentroImposicion") ??
          this.parseXmlValue(c, "id") ??
          "";
        const nombre =
          this.parseXmlValue(c, "descripcion") ??
          this.parseXmlValue(c, "Descripcion") ??
          this.parseXmlValue(c, "Sucursal") ??
          "";
        const calle = this.parseXmlValue(c, "calle") ?? this.parseXmlValue(c, "Calle") ?? "";
        const nro = this.parseXmlValue(c, "nro") ?? this.parseXmlValue(c, "Numero") ?? "";
        const localidad = this.parseXmlValue(c, "localidad") ?? this.parseXmlValue(c, "Localidad") ?? "";
        const provincia = this.parseXmlValue(c, "provincia") ?? this.parseXmlValue(c, "Provincia") ?? "";
        const cpS = this.parseXmlValue(c, "cp") ?? this.parseXmlValue(c, "CodigoPostal") ?? "";
        const latRaw = this.parseXmlValue(c, "latitud") ?? this.parseXmlValue(c, "Latitud");
        const lngRaw = this.parseXmlValue(c, "longitud") ?? this.parseXmlValue(c, "Longitud");

        if (!id.trim()) continue;

        const suc: SucursalInfo = {
          id: id.trim(),
          nombre: nombre.trim(),
          direccion: `${calle.trim()} ${nro.trim()}`.trim(),
          localidad: localidad.trim(),
          provincia: provincia.trim(),
          cp: cpS.trim(),
        };
        if (latRaw) {
          const lat = parseFloat(latRaw.trim().replace(",", "."));
          if (Number.isFinite(lat)) suc.latitud = lat;
        }
        if (lngRaw) {
          const lng = parseFloat(lngRaw.trim().replace(",", "."));
          if (Number.isFinite(lng)) suc.longitud = lng;
        }
        sucursales.push(suc);
      }

      return sucursales;
    } catch (e) {
      console.warn("[OCA] obtenerSucursales falló:", e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  // ==========================================
  // 7. CANCELAR (AnularOrdenGenerada)
  // OCA cancela por idOrdenRetiro (no por numeroEnvio). Aceptamos lo que venga
  // y lo forwardeamos; si el caller pasa un numeroEnvio, OCA responderá con 120.
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> {
    const xml = await this.soapPost("AnularOrdenGenerada", {
      usr: this.creds.usuario,
      psw: this.creds.password,
      idOrdenRetiro: tracking,
    });

    // OCA devuelve un código numérico en el body del resultado. Probamos varios
    // wrappers conocidos + fallback a "primer número aparecido en <return>".
    const codigo = (
      this.parseXmlValue(xml, "AnularOrdenGeneradaResult") ??
      this.parseXmlValue(xml, "return") ??
      this.parseXmlValue(xml, "Codigo") ??
      this.parseXmlValue(xml, "codigo") ??
      ""
    ).trim();

    // Catálogo de códigos OCA (documentación e-Pak).
    switch (codigo) {
      case "100":
        return true;
      case "130":
        throw new Error("OCA no puede cancelar: el envío ya fue recolectado o está en ruta");
      case "120":
        throw new Error("OCA no puede cancelar: la orden no pertenece a esta cuenta");
      case "110":
        throw new Error("OCA rechazó las credenciales al intentar cancelar");
      default:
        console.warn(`[OCA] cancelación devolvió código no reconocido: "${codigo}"`);
        return false;
    }
  }

  // ==========================================
  // 8. SOLICITAR RECOLECCIÓN (stub — OCA integra la recolección en el despacho)
  // ==========================================
  async solicitarRecoleccion(_fecha: Date, _cantidadBultos: number, _direccionOrigen: string): Promise<string> {
    throw new Error(
      "OCA: solicitarRecoleccion no implementado — la recolección se gestiona a través del XML_Datos.idfranjahoraria en el despacho",
    );
  }
}
