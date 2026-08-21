export interface CredencialesOca {
  usuario: string;
  password: string;
  cuit: string;
  nrocuenta: string;
  operativa_domicilio: string;
  operativa_sucursal?: string;
  operativa_inversa?: string;
  sandbox?: boolean;
}

/**
 * Devuelve las credenciales master de Shipro para OCA, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesOca {
  return {
    usuario: process.env.OCA_USUARIO?.trim() || '',
    password: process.env.OCA_PASSWORD?.trim() || '',
    cuit: process.env.OCA_CUIT?.trim() || '',
    nrocuenta: process.env.OCA_NROCUENTA?.trim() || '',
    operativa_domicilio: process.env.OCA_OPERATIVA_DOM?.trim() || '',
    operativa_sucursal: process.env.OCA_OPERATIVA_SUC?.trim() || undefined,
    operativa_inversa: process.env.OCA_OPERATIVA_INV?.trim() || undefined,
    sandbox: process.env.OCA_SANDBOX === 'true'
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan usuario, password, cuit, nrocuenta u operativa_domicilio),
 * LANZA un error específico para que el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesOca {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/oca] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.usuario || !parsed.password || !parsed.cuit || !parsed.nrocuenta || !parsed.operativa_domicilio) {
    console.warn('[credenciales/oca] Credenciales propias incompletas (faltan usuario/password/cuit/nrocuenta/operativa_domicilio). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan campos OCA requeridos');
  }
  return {
    usuario: parsed.usuario,
    password: parsed.password,
    cuit: parsed.cuit,
    nrocuenta: parsed.nrocuenta,
    operativa_domicilio: parsed.operativa_domicilio,
    operativa_sucursal: parsed.operativa_sucursal || undefined,
    operativa_inversa: parsed.operativa_inversa || undefined,
    sandbox: parsed.sandbox === true
  };
}
