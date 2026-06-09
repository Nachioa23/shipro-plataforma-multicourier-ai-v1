import { ICourierIntegrator, CotizacionParams, DespachoParams, SucursalInfo } from './CourierInterface';

export class MocisAdapter implements ICourierIntegrator {
  private API_URL = 'https://mocis.akeron.net/api/v1';
  private clientApi: string;
  private clientSecret: string;
  
  private tokenActual: string | null = null;
  private tokenExpira: number = 0;
  // DEUDA 29 Sub-fase 2.F: lock anti-race-condition para refresh de token.
  private tokenPromise: Promise<string> | null = null;

  // Caché en memoria para no consultar las provincias en cada envío
  private provinciasAkeron: { id: number, name: string }[] = [];

  constructor(clientApi: string, clientSecret: string) {
    this.clientApi = clientApi;
    this.clientSecret = clientSecret;
  }

  // DEUDA 29 Sub-fase 2.G (no implementada por decisión):
  // Connection pooling con HTTP Agent explícito fue evaluado y descartado.
  // Node 18+ con undici embebido ya hace pooling per-host con keep-alive de
  // 4s, suficiente para los flows internos de Shipro (cotizar+despachar
  // consecutivos en <1s). El beneficio medible con volumen actual
  // (~10 envíos/día) es marginal vs la latencia variable de los APIs de
  // couriers (100-1000ms por request). Revisar si APM muestra handshake
  // TLS como bottleneck real. Análisis completo en commit message de 2.G.

  // ==========================================
  // 1. AUTENTICACIÓN
  //
  // DEUDA 29 Sub-fase 2.F: cache de token con expiración + lock anti-race.
  //   - Margen de 5 min antes de exp (api_expire_in viene en epoch absoluto).
  //   - Vida típica del token: 6h.
  //   - Lock con tokenPromise para que N requests concurrentes con cache
  //     vencido hagan UNA sola llamada a /auth/token.
  //
  // TODO Sub-fase 3: retry on 401 mid-request (mismo patrón que Andreani).
  // ==========================================
  private async getToken(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    const MARGEN_SEGUNDOS = 300; // 5 min

    // Cache válido
    if (this.tokenActual && this.tokenExpira > ahora + MARGEN_SEGUNDOS) {
      return this.tokenActual;
    }

    // Refresh en vuelo: esperar el que ya está corriendo.
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    // Disparar nuevo refresh
    this.tokenPromise = this.refreshToken();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  private async refreshToken(): Promise<string> {
    const formData = new URLSearchParams();
    formData.append('client_api', this.clientApi);
    formData.append('client_secret', this.clientSecret);

    const res = await fetch(`${this.API_URL}/auth/token`, { method: 'POST', body: formData });
    const data = await res.json();

    if (!data.status || !data.result || data.result.length === 0) {
      throw new Error("Moci's rechazó las credenciales. Verificá tu Client API y Secret.");
    }

    this.tokenActual = data.result[0].api_token;
    this.tokenExpira = data.result[0].api_expire_in;
    return this.tokenActual!;
  }

  // ==========================================
  // 2. HELPER: PROVINCIAS Y CÓDIGO POSTAL
  // ==========================================
  private async obtenerIdProvincia(nombreProvincia: string): Promise<string> {
    const token = await this.getToken();
    
    // Si el caché está vacío, le pedimos a Moci's su lista oficial
    if (this.provinciasAkeron.length === 0) {
      try {
        const res = await fetch(`${this.API_URL}/shipping/provincias`, {
          method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.status && data.result) {
          this.provinciasAkeron = data.result;
        }
      } catch (e) {
        console.warn("No se pudo cargar el listado de provincias de Moci's.");
      }
    }

    const provBuscada = nombreProvincia ? nombreProvincia.toLowerCase().trim() : "caba";
    
    // Buscamos coincidencia en la lista oficial (Buscando en name, nombre o descripcion)
    const coincidencia = this.provinciasAkeron.find(p => {
      // @ts-ignore - Atajamos cualquier nombre de variable que use Akeron
      const textoProvincia = (p.name || p.nombre || p.provincia || p.descripcion || "").toLowerCase();
      if (!textoProvincia) return false;
      
      return textoProvincia.includes(provBuscada) || provBuscada.includes(textoProvincia);
    });

    if (coincidencia) return coincidencia.id.toString();

    // Fallbacks duros por si la API falla o no hay coincidencia
    if (provBuscada.includes('caba') || provBuscada.includes('capital') || provBuscada.includes('ciudad')) return "2";
    return "1"; // Por defecto Provincia de Buenos Aires
  }

  private formatearCPA(cp: string, provinciaNombre?: string): string {
    const cpLimpio = cp.trim().toUpperCase();
    if (/^[A-Z][0-9]{4}/.test(cpLimpio)) return cpLimpio.substring(0, 5); // Ya es formato Akeron

    const numeros = cpLimpio.replace(/[^0-9]/g, '').substring(0, 4);
    const prov = provinciaNombre ? provinciaNombre.toLowerCase() : "";
    let letra = "B"; // Defecto BA
    
    if (prov.includes('caba') || prov.includes('capital') || prov.includes('ciudad')) letra = "C";
    else if (prov.includes('catamarca')) letra = "K";
    else if (prov.includes('chaco')) letra = "H";
    else if (prov.includes('chubut')) letra = "U";
    else if (prov.includes('cordoba') || prov.includes('córdoba')) letra = "X";
    else if (prov.includes('corrientes')) letra = "W";
    else if (prov.includes('entre rios') || prov.includes('entre ríos')) letra = "E";
    else if (prov.includes('formosa')) letra = "P";
    else if (prov.includes('jujuy')) letra = "Y";
    else if (prov.includes('pampa')) letra = "L";
    else if (prov.includes('rioja')) letra = "F";
    else if (prov.includes('mendoza')) letra = "M";
    else if (prov.includes('misiones')) letra = "N";
    else if (prov.includes('neuquen') || prov.includes('neuquén')) letra = "Q";
    else if (prov.includes('rio negro') || prov.includes('río negro')) letra = "R";
    else if (prov.includes('salta')) letra = "A";
    else if (prov.includes('san juan')) letra = "J";
    else if (prov.includes('san luis')) letra = "D";
    else if (prov.includes('santa cruz')) letra = "Z";
    else if (prov.includes('santa fe')) letra = "S";
    else if (prov.includes('santiago')) letra = "G";
    else if (prov.includes('tierra del fuego')) letra = "V";
    else if (prov.includes('tucuman') || prov.includes('tucumán')) letra = "T";
    else if (/^(10|11|12|13|14)/.test(numeros)) letra = "C";

    return `${letra}${numeros.padStart(4, '0')}`;
  }

  // ==========================================
  // 3. COTIZAR (shipping/price) - Multi-Servicio
  // ==========================================
  async cotizar(params: CotizacionParams): Promise<{servicio: string, precioNeto: number}[]> {
    const token = await this.getToken();
    const cpAkeron = this.formatearCPA(params.cpDestino);
    
    // Peso entero, Medidas con un decimal
    const itemsArray = params.paquetes.map(p => {
      const peso = Math.ceil(p.pesoKg || 1).toString(); 
      const alto = (p.altoCm || 10).toFixed(1);         
      const largo = (p.largoCm || 10).toFixed(1);       
      const ancho = (p.anchoCm || 10).toFixed(1);       
      return `${peso},${alto},${largo},${ancho}`;
    });
    
    const formData = new URLSearchParams();
    formData.append('postal_code', cpAkeron);
    formData.append('items', JSON.stringify(itemsArray)); 

    const res = await fetch(`${this.API_URL}/shipping/price`, { 
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData 
    });
    
    const data = await res.json();
    if (!data.status || !data.result || data.result.length === 0) {
      throw new Error(data.msg || "Moci's no cotiza esta zona.");
    }
    
    return data.result.map((opcionAkeron: any, index: number) => {
       let nombreServicio = "";

       // EL ABRELATAS: Si Akeron manda el servicio adentro de una "caja" (objeto)
       if (opcionAkeron.service && typeof opcionAkeron.service === 'object') {
         nombreServicio = opcionAkeron.service.name || opcionAkeron.service.description || "";
       } else {
         // Si lo manda como texto normal
         nombreServicio = opcionAkeron.service_name || opcionAkeron.name || opcionAkeron.service || "";
       }
       
       if (!nombreServicio) {
         if (index === 0) nombreServicio = "Same Day";
         else if (index === 1) nombreServicio = "Next Day";
         else nombreServicio = `Servicio Extra ${index + 1}`;
       }

       return {
         // Forzamos a que siempre sea un Texto (String) y lo limpiamos
         servicio: String(nombreServicio).trim(), 
         precioNeto: parseFloat(opcionAkeron.price)
       };
    });
  }

  // ==========================================
  // 4. CREAR ENVÍO (Normal e Inversa)
  // ==========================================
  async despachar(params: DespachoParams): Promise<{ tracking: string, etiquetaUrl?: string }> {
    const token = await this.getToken();
    
    const provinciaId = await this.obtenerIdProvincia(params.provincia || "CABA");
    const esInversa = params.tipoEntrega === 'inversa' || params.tipoEntrega === 'cambio' || params.tipoEntrega === 'devolucion';

    // ---------------------------------------------------------
    // VÍA 1: LOGÍSTICA INVERSA (Cambios y Devoluciones)
    // ---------------------------------------------------------
    if (esInversa) {
      if (!params.trackingOriginal) throw new Error("Moci's requiere el 'trackingOriginal' para hacer logística inversa.");

      const isCambio = params.tipoEntrega === 'cambio';
      
      const bodyInversa = {
        origen: { // El cliente que devuelve
          provincia: parseInt(provinciaId),
          postal_code: params.cp,
          address: `${params.calle} ${params.altura} ${params.piso || ''} ${params.dpto || ''}`.trim(),
          location: params.localidad,
          reference: params.referencia || "Retiro",
          sender: params.destinatarioNombre,
          telephone: params.telefono || "1100000000",
          email: params.email || "sinemail@shipro.pro"
        },
        // Destino = depósito del cliente que recibe la devolución/cambio.
        // Si params.origen viene (DEUDA 4): usar datos reales. Sino: fallback hardcoded
        // (deuda futura: eliminar fallback cuando todos los callers pasen origen).
        destino: params.origen
          ? {
              provincia: parseInt(await this.obtenerIdProvincia(params.origen.provincia)),
              postal_code: params.origen.cp,
              address: `${params.origen.calle} ${params.origen.altura}`.trim(),
              location: params.origen.localidad,
              reference: "Recepción Inversa",
              receives: "Logística Shipro",
              telephone: params.origen.telefono || "1100000000",
              email: params.origen.email || "operaciones@shipro.pro",
            }
          : { // Fallback temporal
              provincia: 2,
              postal_code: "1000",
              address: "Depósito Central",
              location: "CABA",
              reference: "Recepción Inversa",
              receives: "Logística Shipro",
              telephone: "1100000000",
              email: "operaciones@shipro.pro",
            },
        type_inversa: isCambio ? "2" : "1",
        devolucion_shipping_code: params.trackingOriginal,
        // Si es cambio, Akeron pide el tracking nuevo. Como todavía no lo tenemos, mandamos el original como referencia cruzada.
        cambio_shipping_code: isCambio ? params.trackingOriginal : undefined,
        bultos: 1,
        kg: params.paquetes[0]?.pesoKg || 1,
        service: 1
      };

      const resInversa = await fetch(`${this.API_URL}/shipping_inversa/new`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' // Akeron pide JSON acá
        },
        body: JSON.stringify(bodyInversa)
      });

      const dataInversa = await resInversa.json();

      if (!dataInversa.status || !dataInversa.result || dataInversa.result.length === 0) {
        throw new Error("Moci's rechazó la etiqueta inversa: " + (dataInversa.msg || "Desconocido"));
      }

      return {
        tracking: dataInversa.result[0],
        etiquetaUrl: `/api/etiquetas/mocis?tracking=${dataInversa.result[0]}`
      };
    }

    // ---------------------------------------------------------
    // VÍA 2: DESPACHO NORMAL (Hacia el cliente o Recolección)
    // ---------------------------------------------------------
    const bodyParams = new URLSearchParams();
    bodyParams.append('receives', params.destinatarioNombre);
    bodyParams.append('address', `${params.calle} ${params.altura} ${params.piso || ''} ${params.dpto || ''}`.trim());
    bodyParams.append('location', params.localidad);
    bodyParams.append('postal_code', params.cp);
    bodyParams.append('provincia', provinciaId);
    
    if (params.referencia) bodyParams.append('reference', params.referencia);
    if (params.telefono) bodyParams.append('phone', params.telefono);
    if (params.email) bodyParams.append('email', params.email);

    // ¡ACÁ ESTÁ EL ARREGLO! Mismo truco del Regex que usamos en cotizar
    // Peso: SIN decimales (entero). Alto, Largo, Ancho: CON un decimal.
    const itemsArray = params.paquetes.map(p => {
      const peso = Math.ceil(p.pesoKg || 1).toString(); 
      const alto = (p.altoCm || 10).toFixed(1);         
      const largo = (p.largoCm || 10).toFixed(1);       
      const ancho = (p.anchoCm || 10).toFixed(1);       
      return `${peso},${alto},${largo},${ancho}`;
    });
    
    bodyParams.append('items', JSON.stringify(itemsArray));

    const resNormal = await fetch(`${this.API_URL}/shipping/new`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded' // Akeron pide url-encoded acá
      },
      body: bodyParams.toString()
    });

    const dataNormal = await resNormal.json();

    if (!dataNormal.status || !dataNormal.result || dataNormal.result.length === 0) {
      throw new Error("Moci's rechazó el envío: " + (dataNormal.msg || "Desconocido"));
    }

    return {
      tracking: dataNormal.result[0],
      etiquetaUrl: `/api/etiquetas/mocis?tracking=${dataNormal.result[0]}`
    };
  }

  // ==========================================
  // 5. OBTENER ETIQUETA (shipping/print/label)
  // ==========================================
  async obtenerEtiquetaBuffer(tracking: string): Promise<Buffer> {
    const token = await this.getToken();
    
    const res = await fetch(`${this.API_URL}/shipping/print/label/${tracking}`, {
      method: 'GET', 
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const arrayBuffer = await res.arrayBuffer();
    const bufferCrudo = Buffer.from(arrayBuffer);
    const primerosBytes = bufferCrudo.toString('utf8', 0, 50).trim();
    
    // Si Moci's nos manda un JSON (que según ellos no hacían...)
    if (primerosBytes.startsWith('{')) {
       const dataStr = bufferCrudo.toString('utf8');
       const data = JSON.parse(dataStr);
       
       // Si el status es false, sí es un error real
       if (!data.status) {
         throw new Error(data.msg || "Moci's rechazó la etiqueta.");
       }

       // Si el status es true, extraemos la ruta del PDF
       let rutaPdf = "";
       const result = Array.isArray(data.result) ? data.result[0] : data.result;
       
       if (typeof result === 'object' && result !== null) {
         rutaPdf = result.pdf || result.label || result.file || "";
       } else if (typeof result === 'string') {
         rutaPdf = result;
       }

       if (!rutaPdf) throw new Error("Moci's dijo que generó el PDF pero no mandó la ruta.");

       // Extraemos la base de tu API_URL (Ej: https://api.mocis.com/v1 -> https://api.mocis.com)
       const baseUrl = new URL(this.API_URL).origin;
       
       // Armamos la URL final limpiando las barras
       const urlDescarga = rutaPdf.startsWith('http') ? rutaPdf : `${baseUrl}${rutaPdf.replace(/\\/g, '')}`;

       console.log(`✅ [Moci's] Archivo listo. Yendo a buscar a: ${urlDescarga}`);

       // Vamos a robar el PDF real
       const pdfRes = await fetch(urlDescarga, {
         headers: { 'Authorization': `Bearer ${token}` }
       });

       // Si da 404 es porque Akeron puso el archivo en una cola y tarda unos segundos
       if (pdfRes.status === 404) {
         throw new Error("El PDF se está generando en los servidores del correo. Por favor, intentá imprimir nuevamente en 1 o 2 minutos.");
       }

       if (!pdfRes.ok) throw new Error(`Error al descargar el PDF final (HTTP ${pdfRes.status})`);

       return Buffer.from(await pdfRes.arrayBuffer());
    }

    // Si algún día arreglan su API y mandan el PDF de una
    if (!res.ok) throw new Error(`Akeron rechazó la descarga (Error HTTP ${res.status}).`);

    console.log(`✅ [Moci's] PDF crudo descargado directo.`);
    return bufferCrudo;
  }

  // ==========================================
  // 6. CANCELAR ENVÍO (shipping/cancel)
  // ==========================================
  async cancelarEnvio(tracking: string): Promise<boolean> { 
    try {
      const token = await this.getToken();
      
      // Armamos el body en formato "urlencoded" como pide la documentación
      const bodyParams = new URLSearchParams();
      bodyParams.append('code', tracking);

      const res = await fetch(`${this.API_URL}/shipping/cancel`, {
        method: 'POST', // ¡Era POST!
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        body: bodyParams.toString()
      });
      
      const textoRespuesta = await res.text();

      // Mantenemos el escudo anti-HTML por si acaso
      if (textoRespuesta.trim().startsWith('<')) {
        console.error(`[Moci's] Error HTML al cancelar. Status: ${res.status}`);
        return false;
      }

      const data = JSON.parse(textoRespuesta);
      
      // Si Akeron nos dice true, es que se canceló con éxito
      if (data.status === true) {
        console.log(`✅ [Moci's] Etiqueta ${tracking} cancelada exitosamente.`);
        return true;
      } else {
        console.warn(`⚠️ [Moci's] Rechazó la cancelación de ${tracking}:`, data.msg);
        return false;
      }

    } catch (error) {
      console.error("Error cancelando en Moci's:", error);
      return false;
    }
  }

  // ==========================================
  // 7. ESTADO DEL ENVÍO (shipping/state)
  // ==========================================
  async rastrear(tracking: string): Promise<string> { 
    try {
      const token = await this.getToken();
      const res = await fetch(`${this.API_URL}/shipping/state/${tracking}`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.status && data.result && data.result.length > 0) return this.traducirEstado(data.result[0].state);
      return "Desconocido";
    } catch (e) {
      return "Error de Conexión";
    }
  }

  // F5.2 (2026-06-09): retorna directamente keys canonicas del catalogo F1
  // (`lib/utils/estados.ts ESTADOS_COURIER`). Reemplaza strings legacy
  // ("EN PREPARACIÓN" con tilde y espacio, "VISITA FALLIDA" con espacio)
  // por canonicas (ETIQUETA_CREADA, VISITA_FALLIDA con underscore).
  traducirEstado(estadoCrudo: string): string {
    const estado = estadoCrudo.toUpperCase();
    if (estado === '-') return "ETIQUETA_CREADA";
    if (estado === 'ENTREGADO') return "ENTREGADO";
    if (estado === 'NO ENTREGADO') return "VISITA_FALLIDA";
    return estadoCrudo;
  }

  async obtenerSucursales(cp: string): Promise<SucursalInfo[]> { return []; }
}