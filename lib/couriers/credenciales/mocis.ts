export interface CredencialesMocis {
  clientApi: string;
  clientSecret: string;
}

/**
 * Devuelve las credenciales master de Shipro para Mocis, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesMocis {
  return {
    clientApi: process.env.MOCIS_CLIENT_API?.trim() || '',
    clientSecret: process.env.MOCIS_CLIENT_SECRET?.trim() || ''
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan clientApi o clientSecret), LANZA un error específico
 * para que el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesMocis {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/mocis] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.clientApi || !parsed.clientSecret) {
    console.warn('[credenciales/mocis] Credenciales propias incompletas (faltan clientApi/clientSecret). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan clientApi o clientSecret');
  }
  return {
    clientApi: parsed.clientApi,
    clientSecret: parsed.clientSecret
  };
}
