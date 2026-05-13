// ==========================================================
// 1. EL OBJETO PAQUETE (Con lógica de Seguros y Aforo)
// ==========================================
export interface Paquete {
  pesoKg: number;
  largoCm: number;
  anchoCm: number;
  altoCm: number;
  valorDeclarado: number;
  requiereSeguro: boolean; // El switch del que hablabas: true/false
  contenido?: string;
}

// ==========================================================
// 2. PARÁMETROS DE COTIZACIÓN
// ==========================================================
export interface CotizacionParams {
  cpOrigen: string;
  cpDestino: string;
  paquetes: Paquete[];
  tipoEntrega?: 'domicilio' | 'sucursal' | 'inversa' | 'cambio' | 'devolucion'; 
}

// NUEVO: El formato de respuesta para soportar Multi-Servicios
export interface OpcionCotizacion {
  servicio: string;     // Ej: "Estándar", "Same Day", "Urgente"
  precioNeto: number;   // El precio pelado, sin IVA ni Markup
}

// ==========================================================
// 3. PARÁMETROS DE DESPACHO (Creación de Etiqueta)
// ==========================================
export interface DespachoParams {
  // Datos del Destinatario (O remitente si es inversa)
  destinatarioNombre: string;
  calle: string;
  altura: string;
  piso?: string;
  dpto?: string;
  localidad: string;
  cp: string;
  provincia?: string;
  telefono: string;
  email: string;
  dni: string;

  paquetes: Paquete[];
  referencia?: string;

  // Lista unificada para que TypeScript no tire errores
  tipoEntrega?: 'domicilio' | 'sucursal' | 'inversa' | 'cambio' | 'devolucion';

  // VITAL: Si es a sucursal, acá viene el ID de la sucursal elegida en el checkout
  sucursalDestinoId?: string;

  // VITAL: Para logística inversa (Devolución/Cambio), enviamos el tracking original
  trackingOriginal?: string;

  // DEUDA 4: datos del depósito de origen (snapshot del momento del despacho).
  // Si no viene, los adapters caen al fallback hardcoded por compatibilidad
  // temporal — eliminar fallbacks cuando todos los callers pasen origen.
  origen?: {
    calle: string;
    altura: string;
    cp: string;
    localidad: string;
    provincia: string;
    pais?: string;
    telefono?: string;
    email?: string;
  };

  // DEUDA 29 Sub-fase 2.E: remitente real desde Empresa + Depósito.
  // Opcional para no romper adapters que no lo usen (Mocis es last-mile zonal,
  // no maneja remitente). Andreani lo consume; si no viene, cae a fallback
  // hardcoded con log warning (defense-in-depth).
  remitente?: {
    nombre: string;     // Empresa.nombre (razón social/comercial)
    cuit: string;       // Empresa.cuit
    telefono?: string;  // Deposito.contactoTelefono
    email?: string;     // Deposito.contactoEmail (nullable en BD)
  };
}

// ==========================================================
// 4. ESTRUCTURA DE UNA SUCURSAL (Para mostrar en el Checkout)
// ==========================================
export interface SucursalInfo {
  id: string; // El código interno del courier (Ej: "SUC-123")
  nombre: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
  latitud?: number;
  longitud?: number;
}

// ==========================================================
// 5. EL MOLDE MAESTRO (ICourierIntegrator)
// ==========================================
export interface ICourierIntegrator {
  // AHORA DEVUELVE UN ARRAY DE OPCIONES
  cotizar(params: CotizacionParams): Promise<OpcionCotizacion[]>;
  
  despachar(params: DespachoParams): Promise<{ tracking: string, etiquetaBase64?: string, etiquetaUrl?: string }>;
  rastrear(tracking: string): Promise<string>;
  traducirEstado(estadoCrudo: string): string;
  obtenerSucursales(cp: string): Promise<SucursalInfo[]>;
  cancelarEnvio(tracking: string): Promise<boolean>;
  solicitarRecoleccion?(fecha: Date, cantidadBultos: number, direccionOrigen: string): Promise<string>;
}