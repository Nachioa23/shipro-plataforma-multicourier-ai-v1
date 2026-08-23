export interface CredencialesHopEnvios {
  clientId: string;       // client_id para el login
  clientSecret: string;   // client_secret para el login
  email: string;          // email para el login
  password: string;       // password para el login
  sellerCode: string;     // seller_code que viaja en cada request
  baseUrl?: string;       // URL de producción (opcional — fallback a sandbox)
}

/**
 * Devuelve las credenciales master de Shipro para Hop Envíos, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesHopEnvios {
  return {
    clientId: process.env.HOP_CLIENT_ID?.trim() || '',
    clientSecret: process.env.HOP_CLIENT_SECRET?.trim() || '',
    email: process.env.HOP_EMAIL?.trim() || '',
    password: process.env.HOP_PASSWORD?.trim() || '',
    sellerCode: process.env.HOP_SELLER_CODE?.trim() || '',
    baseUrl: process.env.HOP_BASE_URL?.trim() || undefined
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan clientId, clientSecret, email, password o sellerCode),
 * LANZA un error específico para que el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesHopEnvios {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/hopenvios] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.clientId || !parsed.clientSecret || !parsed.email || !parsed.password || !parsed.sellerCode) {
    console.warn('[credenciales/hopenvios] Credenciales propias incompletas (faltan clientId/clientSecret/email/password/sellerCode). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan campos Hop Envíos requeridos');
  }
  return {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    email: parsed.email,
    password: parsed.password,
    sellerCode: parsed.sellerCode,
    baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : undefined
  };
}
