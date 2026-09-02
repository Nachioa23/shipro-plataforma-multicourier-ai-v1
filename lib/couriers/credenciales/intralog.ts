export interface CredencialesIntralog {
  usuario: string;
  password: string;
}

/**
 * Devuelve las credenciales master de Shipro para Intralog, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesIntralog {
  return {
    usuario: process.env.INTRALOG_USUARIO?.trim() || '',
    password: process.env.INTRALOG_PASSWORD?.trim() || '',
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan usuario o password), LANZA un error específico
 * para que el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesIntralog {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/intralog] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.usuario || !parsed.password) {
    console.warn('[credenciales/intralog] Credenciales propias incompletas (faltan usuario/password). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan usuario o password');
  }
  return {
    usuario: parsed.usuario,
    password: parsed.password
  };
}
