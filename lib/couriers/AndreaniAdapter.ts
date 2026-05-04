import { 
  ICourierIntegrator, 
  CotizacionParams, 
  DespachoParams, 
  SucursalCourier 
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
  private tokenActual: string | null = null;

  constructor(credenciales: CredencialesAndreani) {
    this.creds = credenciales;
  }

  // ==============================================================
  // LOGIN Y MANEJO DE TOKEN
  // ==============================================================
  private async getToken(): Promise<string> {
    if (this.tokenActual) return this.tokenActual;
    
    const credencialesBase64 = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64');
    
    const res = await fetch(`${this.API_URL}/login`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${credencialesBase64}` }
    });

    if (!res.ok) throw new Error("Falló la autenticación con Andreani");
    
    const data = await res.json();
    if (!data.token) throw new Error("Andreani no devolvió el token");
    
    const nuevoToken = String(data.token).trim();
    this.tokenActual = nuevoToken;
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

    // Origen del despacho:
    // 1. Si la credencial tiene id_sucursal_origen configurado → Andreani retira de esa sucursal.
    // 2. Sino, si params.origen viene (DEUDA 4) → usar datos del depósito real del cliente.
    // 3. Sino → fallback hardcoded (deuda futura: eliminar este fallback cuando todos los
    //    callers pasen origen explícito; hoy se mantiene por compatibilidad temporal).
    let origenConfig: any;
    if (this.creds.id_sucursal_origen) {
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

    const body = {
      contrato: contratoAUsar,
      origen: origenConfig,
      destino: destinoConfig,
      remitente: { nombreCompleto: "Shipro / Cliente", email: "logistica@shipro.pro", documentoTipo: "CUIT", documentoNumero: "30712371729", telefonos: [{ tipo: 1, numero: "1155772580" }] },
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
  traducirEstado(estadoCrudo: string): string { 
    const estadoMinuscula = estadoCrudo.toLowerCase().trim();

    if (estadoMinuscula.includes("pendiente") || estadoMinuscula.includes("creada") || estadoMinuscula.includes("alta")) return "IMPRESO";
    if (estadoMinuscula.includes("ingreso") || estadoMinuscula.includes("circuito operativo") || estadoMinuscula.includes("en viaje") || estadoMinuscula.includes("procesamiento")) return "EN_TRANSITO";
    if (estadoMinuscula.includes("distribución") || estadoMinuscula.includes("distribucion")) return "EN_REPARTO";
    if (estadoMinuscula.includes("entregado") || estadoMinuscula.includes("successful") || estadoMinuscula.includes("rendicion")) return "ENTREGADO";
    if (estadoMinuscula.includes("visita") || estadoMinuscula.includes("rechazado") || estadoMinuscula.includes("siniestro") || estadoMinuscula.includes("devuelto") || estadoMinuscula.includes("no entregado")) return "INCIDENCIA";

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