export interface CredencialesCorreoArgentino {
  // Paq.ar API 2.0 (despacho, etiqueta, rastreo, sucursales, cancelación)
  apiKey: string;      // Authorization: Apikey <apiKey>
  agreement: string;   // header: agreement
  sellerId: string;    // se manda en el body de cada order
  // MiCorreo API (cotización — endpoint distinto, auth distinta)
  customerId: string;  // se manda en el body del rates request
  // Environment
  sandbox?: boolean;   // true → apitest.correoargentino.com.ar
}

/**
 * Devuelve las credenciales master de Shipro para Correo Argentino, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesCorreoArgentino {
  return {
    apiKey: process.env.CA_API_KEY?.trim() || '',
    agreement: process.env.CA_AGREEMENT?.trim() || '',
    sellerId: process.env.CA_SELLER_ID?.trim() || '',
    customerId: process.env.CA_CUSTOMER_ID?.trim() || '',
    sandbox: process.env.CA_SANDBOX === 'true'
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan apiKey, agreement, sellerId o customerId), LANZA un error
 * específico para que el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesCorreoArgentino {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/correoargentino] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.apiKey || !parsed.agreement || !parsed.sellerId || !parsed.customerId) {
    console.warn('[credenciales/correoargentino] Credenciales propias incompletas (faltan apiKey/agreement/sellerId/customerId). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan campos Correo Argentino requeridos');
  }
  return {
    apiKey: parsed.apiKey,
    agreement: parsed.agreement,
    sellerId: parsed.sellerId,
    customerId: parsed.customerId,
    sandbox: parsed.sandbox === true
  };
}
