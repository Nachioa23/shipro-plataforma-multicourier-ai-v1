import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo
} from './CourierInterface';

export interface CredencialesAndreani {
  username: string;
  password: string;
  cliente: string;
  id_sucursal_origen?: string;
  contrato_domicilio?: string;
  contrato_sucursal?: string;
  contrato_cambio?: string;
  contrato_devolucion?: string;
  contrato_sucursal_sucursal?: string;
  contrato_domicilio_sucursal?: string;
  contrato_sucursal_domicilio?: string;
  contrato_domicilio_domicilio?: string;
}

export class AndreaniAdapter implements ICourierIntegrator {
  private API_URL = 'https://apis.andreani.com';
  private creds: CredencialesAndreani;

  // DEUDA 29 Sub-fase 2.F: cache de token con expiración real (extraída del JWT)
  // y lock anti-race-condition. La vida típica del token es 24h, pero la fuente
  // de verdad es el claim `exp` del JWT mismo — Andreani NO devuelve un campo
  // `expires_in` al top-level (solo `token` y `refreshToken`, ambos JWTs).
  private tokenValor: string | null = null;
  private tokenExpiraAt: number = 0;                  // epoch absoluto en segundos
  private tokenPromise: Promise<string> | null = null; // lock: refresh en vuelo

  constructor(credenciales: CredencialesAndreani) {
    this.creds = credenciales;
  }

  // DEUDA 29 Sub-fase 2.G (no implementada por decisión):
  // Connection pooling con HTTP Agent explícito fue evaluado y descartado.
  // Node 18+ con undici embebido ya hace pooling per-host con keep-alive de
  // 4s, suficiente para los flows internos de Shipro (cotizar+despachar
  // consecutivos en <1s). El beneficio medible con volumen actual
  // (~10 envíos/día) es marginal vs la latencia variable de los APIs de
  // couriers (100-1000ms por request). Revisar si APM muestra handshake
  // TLS como bottleneck real. Análisis completo en commit message de 2.G.

  // ==============================================================
  // LOGIN Y MANEJO DE TOKEN
  //
  // Política de cache:
  //   - Cache válido (expira en > 5min) → reutilizar.
  //   - Cache vencido y NO hay refresh en vuelo → disparar refresh.
  //   - Cache vencido y SÍ hay refresh en vuelo → esperar al mismo promise
  //     (evita que N requests concurrentes peguen N veces a /login).
  //   - Margen de 5min antes de exp para no servir tokens que vencen mid-request.
  //
  // El `exp` real se extrae del JWT (claim payload.exp). Si el JWT es
  // malformado, fallback a +24h conservador (defense-in-depth).
  // ==============================================================
  private async getToken(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    const MARGEN_SEGUNDOS = 300; // 5 min

    // Cache válido
    if (this.tokenValor && this.tokenExpiraAt > ahora + MARGEN_SEGUNDOS) {
      return this.tokenValor;
    }

    // Refresh en vuelo: esperar el que ya está corriendo (race-condition lock).
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

  /**
   * Extrae el claim "exp" (epoch absoluto en segundos) del payload de un JWT.
   * Devuelve null si el JWT está malformado o no tiene el claim.
   */
  private parseJwtExp(jwt: string): number | null {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) return null;
      const pad = (4 - parts[1].length % 4) % 4;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
      const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }

  private async refreshToken(): Promise<string> {
    const credencialesBase64 = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64');

    const res = await fetch(`${this.API_URL}/login`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${credencialesBase64}` }
    });

    if (!res.ok) throw new Error("Falló la autenticación con Andreani");

    const data = await res.json();
    if (!data.token) throw new Error("Andreani no devolvió el token");

    const nuevoToken = String(data.token).trim();

    // La expiración está embebida en el JWT (claim exp). Fallback a +24h si el
    // JWT está malformado (defense-in-depth — verificado empíricamente que el
    // token actual vive 24h, pero confiamos primero en el JWT por si cambia).
    const ahora = Math.floor(Date.now() / 1000);
    const expFromJwt = this.parseJwtExp(nuevoToken);
    if (expFromJwt === null) {
      console.warn('[andreani] WARN: no se pudo extraer claim exp del JWT. Usando fallback +24h.');
    }

    this.tokenValor = nuevoToken;
    this.tokenExpiraAt = expFromJwt ?? (ahora + 86400);

    // TODO Sub-fase futura: Andreani devuelve refreshToken en data.refreshToken
    // (también JWT de 24h). Hoy NO lo usamos porque Basic Auth con credenciales
    // fijas funciona siempre. Evaluarlo si Andreani limita llamadas a /login.
    //
    // TODO Sub-fase 3: retry on 401 mid-request. Si Andreani revoca el token
    // entre getToken() y la llamada HTTP siguiente, hoy explota. Sub-fase 3
    // captura 401 → resetea cache → reintenta 1 vez.

    return nuevoToken;
  }

  // ==============================================================
  // MOTOR DE DECISIÓN DE CONTRATOS
  // ==============================================================
  private determinarContrato(tipoEntrega: string, tipoOrigen: 'sucursal' | 'domicilio' = 'sucursal'): string {
    if (tipoEntrega === 'inversa' || tipoEntrega === 'devolucion') {
      return this.creds.contrato_devolucion || this.creds.contrato_domicilio || "";
    }
    if (tipoEntrega === 'cambio') {
      return this.creds.contrato_cambio || this.creds.contrato_domicilio || "";
    }
    if (tipoEntrega === 'sucursal') {
      if (tipoOrigen === 'sucursal') return this.creds.contrato_sucursal_sucursal || this.creds.contrato_sucursal || "";
      if (tipoOrigen === 'domicilio') return this.creds.contrato_domicilio_sucursal || this.creds.contrato_sucursal || "";
      return this.creds.contrato_sucursal || "";
    }
    if (tipoOrigen === 'sucursal') return this.creds.contrato_sucursal_domicilio || this.creds.contrato_domicilio || "";
    if (tipoOrigen === 'domicilio') return this.creds.contrato_domicilio_domicilio || this.creds.contrato_domicilio || "";
    
    return this.creds.contrato_domicilio || "";
  }

  // ==============================================================
  // PILAR 1: COTIZAR (Actualizado a Multi-Servicio)
  // ==============================================================
  async cotizar(params: CotizacionParams): Promise<{servicio: string, precioNeto: number}[]> {
    const token = await this.getToken();
    const pesoTotal = params.paquetes.reduce((acc, p) => acc + p.pesoKg, 0);
    const volumenTotal = params.paquetes.reduce((acc, p) => acc + (p.largoCm * p.anchoCm * p.altoCm), 0);

    const contratoAUsar = this.determinarContrato(params.tipoEntrega || 'domicilio', 'sucursal');

    const query = new URLSearchParams({
      cpDestino: params.cpDestino,
      contrato: contratoAUsar,
      cliente: this.creds.cliente,
      'bultos[0][volumen]': volumenTotal.toString() || "1000",
      'bultos[0][kilos]': pesoTotal.toString()
    });

    const res = await fetch(`${this.API_URL}/v1/tarifas?${query.toString()}`, { 
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await res.json();
    if (data && data.tarifaConIva && data.tarifaConIva.total) {
       // Envolvemos la respuesta única de Andreani en el nuevo formato de Array
       return [{
         servicio: "Estándar",
         precioNeto: parseFloat(data.tarifaConIva.total)
       }];
    }
    throw new Error("Andreani no devolvió tarifas para esta cotización");
  }

  // ==============================================================
  // PILAR 2: DESPACHAR (Crear Etiqueta)
  // ==============================================================
  async despachar(params: DespachoParams): Promise<{ tracking: string, etiquetaBase64?: string, etiquetaUrl?: string }> {
    const token = await this.getToken();
    const paquetePrincipal = params.paquetes[0];

    const contratoAUsar = this.determinarContrato(params.tipoEntrega || 'domicilio', 'sucursal');

    // DEUDA 29 Sub-fase 2.D.despachar: jerarquía de resolución de sucursal
    // de imposición:
    //   1. params.sucursalOrigenId (preferencia del cliente configurada en BD,
    //      resuelta en dispatch.ts vía DepositoSucursalPreferida).
    //   2. creds.id_sucursal_origen (.env o credenciales propias del cliente).
    //   3. params.origen (CP del depósito real, DEUDA 4).
    //   4. Fallback hardcoded (defense-in-depth, deuda futura: eliminar cuando
    //      todos los callers pasen origen explícito).
    let origenConfig: any;
    if (params.sucursalOrigenId) {
      origenConfig = { sucursal: { id: params.sucursalOrigenId } };
    } else if (this.creds.id_sucursal_origen) {
      origenConfig = { sucursal: { id: this.creds.id_sucursal_origen } };
    } else if (params.origen) {
      origenConfig = {
        postal: {
          codigoPostal: params.origen.cp,
          calle: params.origen.calle,
          numero: params.origen.altura,
          localidad: params.origen.localidad,
          region: params.origen.provincia,
          pais: params.origen.pais || "Argentina",
        },
      };
    } else {
      origenConfig = { postal: { codigoPostal: "1000", calle: "Av Libertador", numero: "1234", localidad: "CABA", region: "CABA", pais: "Argentina" } };
    }

    let destinoConfig: any = { 
      postal: { 
        codigoPostal: params.cp, 
        calle: params.calle, 
        numero: params.altura, 
        localidad: params.localidad, 
        region: params.provincia || "Buenos Aires", 
        pais: "Argentina" 
      } 
    };

    if (params.tipoEntrega === 'sucursal' && params.sucursalDestinoId) {
      destinoConfig = { sucursal: { id: params.sucursalDestinoId } };
    }

    // DEUDA 29 Sub-fase 2.E: remitente parametrizado desde Empresa + Depósito.
    // Logs warning cuando se usan fallbacks (visibilidad de uso indebido).
    if (!params.remitente) {
      console.warn('[andreani] WARN: despachar() sin params.remitente — usando fallback hardcoded Shipro');
    }
    if (params.remitente && !params.remitente.email) {
      console.warn(`[andreani] WARN: empresa "${params.remitente.nombre}" (CUIT ${params.remitente.cuit}) sin email — usando fallback hardcoded`);
    }
    if (params.remitente && !params.remitente.telefono) {
      console.warn(`[andreani] WARN: empresa "${params.remitente.nombre}" sin teléfono — usando fallback hardcoded`);
    }

    const body = {
      contrato: contratoAUsar,
      origen: origenConfig,
      destino: destinoConfig,
      remitente: {
        nombreCompleto: params.remitente?.nombre || "Shipro / Cliente",
        email: params.remitente?.email || "logistica@shipro.pro",
        documentoTipo: "CUIT",
        documentoNumero: params.remitente?.cuit || "30712371729",
        telefonos: [{ tipo: 1, numero: params.remitente?.telefono || "1155772580" }],
      },
      destinatario: [{ nombreCompleto: params.destinatarioNombre, eMail: params.email || "sin_mail@shipro.io", documentoTipo: "DNI", documentoNumero: params.dni || "11111111", telefonos: [{ tipo: 2, numero: params.telefono || "1100000000" }] }],
      bultos: [{
        kilos: paquetePrincipal?.pesoKg || 1,
        largoCm: paquetePrincipal?.largoCm || 10,
        altoCm: paquetePrincipal?.altoCm || 10,
        anchoCm: paquetePrincipal?.anchoCm || 10,
        volumenCm: (paquetePrincipal?.largoCm * paquetePrincipal?.anchoCm * paquetePrincipal?.altoCm) || 1000,
        valorDeclaradoSinImpuestos: paquetePrincipal?.valorDeclarado || 1000,
        valorDeclaradoConImpuestos: paquetePrincipal?.valorDeclarado || 1000,
        referencias: [{ meta: "detalle", contenido: params.referencia || paquetePrincipal?.contenido || "Envío Shipro" }]
      }]
    };

    const res = await fetch(`${this.API_URL}/v2/ordenes-de-envio`, {
      method: 'POST',
      headers: { 
          'Authorization': `Bearer ${token}`, 
          'x-authorization-token': token, 
          'Content-Type': 'application/json' 
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Error creando el envío en Andreani");
    
    const nroTracking = data.numeroAndreani || (data.bultos && data.bultos[0].numeroDeEnvio) || "ANDREANI-PENDIENTE";
    const urlPdf = data.etiquetasPorAgrupador || null;

    return { tracking: nroTracking, etiquetaUrl: urlPdf };
  }

  // ==============================================================
  // PILAR 3: RASTREAR
  // ==============================================================
  async rastrear(tracking: string): Promise<string> { 
    const token = await this.getToken();
    
    const res = await fetch(`${this.API_URL}/v2/envios/${tracking}`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'x-authorization-token': token 
        }
    });
    
    if (!res.ok) {
      throw new Error("No se pudo consultar el estado");
    }
    
    const data = await res.json();
    const estadoCrudo = data.estado || "Desconocido";
    
    return this.traducirEstado(estadoCrudo);
  }

  // ==============================================================
  // PILAR 4: TRADUCTOR DE ESTADOS
  // ==============================================================
  // F5.1 (2026-06-09): retorna directamente keys canonicas del catalogo F1
  // (`lib/utils/estados.ts ESTADOS_COURIER`). Reemplaza strings legacy
  // (IMPRESO, EN_TRANSITO, EN_REPARTO) por canonicas (ETIQUETA_CREADA,
  // EN_TRANSITO_A_DESTINO, EN_DISTRIBUCION). "visita" se separa de
  // INCIDENCIA para mapear a VISITA_FALLIDA (necesario para Metrica 2.2).
  traducirEstado(estadoCrudo: string): string {
    const estadoMinuscula = estadoCrudo.toLowerCase().trim();

    // Estado courier inicial (Andreani registro la etiqueta).
    if (estadoMinuscula.includes("pendiente") || estadoMinuscula.includes("creada") || estadoMinuscula.includes("alta")) return "ETIQUETA_CREADA";

    // Estados de movimiento.
    if (estadoMinuscula.includes("ingreso") || estadoMinuscula.includes("circuito operativo") || estadoMinuscula.includes("en viaje") || estadoMinuscula.includes("procesamiento")) return "EN_TRANSITO_A_DESTINO";
    if (estadoMinuscula.includes("distribución") || estadoMinuscula.includes("distribucion")) return "EN_DISTRIBUCION";

    // Estado final exitoso.
    if (estadoMinuscula.includes("entregado") || estadoMinuscula.includes("successful") || estadoMinuscula.includes("rendicion")) return "ENTREGADO";

    // Visita fallida (separado de INCIDENCIA para Metrica 2.2).
    if (estadoMinuscula.includes("visita")) return "VISITA_FALLIDA";

    // Incidencias (paquete rechazado, siniestrado, devuelto, no entregado).
    // El estadoCrudoOriginal se preserva en EventoTracking.observacion para
    // discriminar el sub-tipo exacto si se necesita.
    if (estadoMinuscula.includes("rechazado") || estadoMinuscula.includes("siniestro") || estadoMinuscula.includes("devuelto") || estadoMinuscula.includes("no entregado")) return "INCIDENCIA";

    // Fallback: estado raw uppercase si no matchea nada conocido.
    return estadoCrudo.toUpperCase();
  }

  // ==============================================================
  // PILAR 5: OBTENER SUCURSALES (PASO 1: LA RED AMPLIA B2C)
  // ==============================================================
  async obtenerSucursales(cp: string): Promise<any[]> {
    const token = await this.getToken();
    const contratoAUsar = this.creds.contrato_sucursal || this.creds.contrato_domicilio || "";

    // Eliminamos la frontera del CP y forzamos a Andreani a darnos su red B2C con atención al público.
    const query = new URLSearchParams({
      contrato: contratoAUsar,
      canal: "B2C",
      seHaceAtencionAlCliente: "true"
    });

    const res = await fetch(`${this.API_URL}/v2/sucursales?${query.toString()}`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'x-authorization-token': token 
      }
    });

    if (!res.ok) {
      console.error(`[Andreani] Error buscando la red de sucursales.`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((suc: any) => ({
      id: suc.numero || suc.codigo || String(suc.id),
      nombre: suc.descripcion || "Sucursal Andreani",
      direccion: `${suc.direccion?.calle || ''} ${suc.direccion?.numero || ''}`.trim(),
      localidad: suc.direccion?.localidad || "",
      provincia: suc.direccion?.provincia || "",
      cp: suc.direccion?.codigoPostal || "",
      horarios: suc.horarioDeAtencion || "Consultar horarios",
      latitud: suc.coordenadas?.latitud ? parseFloat(suc.coordenadas.latitud) : null,
      longitud: suc.coordenadas?.longitud ? parseFloat(suc.coordenadas.longitud) : null,
      // Booleanos para el filtro de nuestra API
      entregaEnvios: suc.datosAdicionales?.entregaEnvios === true
    }));
  }

  // ==============================================================
  // PILAR 6: CANCELAR ENVÍO
  // ==============================================================
  async cancelarEnvio(tracking: string): Promise<boolean> { 
    const token = await this.getToken();
    const bodyAccion = { accion: "cancelacion", datos: { contrato: this.creds.contrato_domicilio, numeroAndreani: [tracking] } };

    const res = await fetch(`${this.API_URL}/v2/nueva-accion`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'x-authorization-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyAccion)
    });

    if (res.ok || res.status === 202) return true;
    const data = await res.json();
    throw new Error(data.message || "No se pudo anular la etiqueta en Andreani");
  }

  // ==============================================================
  // PILAR EXTRA: DESCARGAR PDF
  // ==============================================================
  async obtenerEtiquetaBuffer(urlEtiqueta: string): Promise<ArrayBuffer> {
    const token = await this.getToken();
    const res = await fetch(urlEtiqueta, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'x-authorization-token': token }
    });

    if (!res.ok) throw new Error("Andreani bloqueó la descarga del PDF");
    return await res.arrayBuffer();
  }
}