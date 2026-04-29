export interface CredencialesAndreani {
  username: string;
  password: string;
  cliente: string;
  id_sucursal_origen: string;
  contrato_domicilio: string;
  contrato_sucursal: string;
  contrato_cambio: string;
  contrato_devolucion: string;
  contrato_sucursal_sucursal: string;
  contrato_domicilio_sucursal: string;
  contrato_sucursal_domicilio: string;
  contrato_domicilio_domicilio: string;
}

/**
 * Devuelve las credenciales master de Shipro para Andreani, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesAndreani {
  return {
    username: process.env.ANDREANI_USER?.trim() || '',
    password: process.env.ANDREANI_PASS?.trim() || '',
    cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
    id_sucursal_origen: process.env.ANDREANI_SUCURSAL_ORIGEN?.trim() || '',
    contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || '',
    contrato_sucursal: process.env.ANDREANI_CONTRATO_SUC?.trim() || '',
    contrato_cambio: process.env.ANDREANI_CONTRATO_CAMBIO?.trim() || '',
    contrato_devolucion: process.env.ANDREANI_CONTRATO_DEVOLUCION?.trim() || '',
    contrato_sucursal_sucursal: process.env.ANDREANI_CONTRATO_SUC_SUC?.trim() || '',
    contrato_domicilio_sucursal: process.env.ANDREANI_CONTRATO_DOM_SUC?.trim() || '',
    contrato_sucursal_domicilio: process.env.ANDREANI_CONTRATO_SUC_DOM?.trim() || '',
    contrato_domicilio_domicilio: process.env.ANDREANI_CONTRATO_DOM_DOM?.trim() || ''
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan username o password), LANZA un error específico para que
 * el caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera): si
 * Shipro prestara sus credenciales silenciosamente, el cliente usaría la
 * cuenta corriente de Shipro sin saberlo. En su lugar, el sistema genera una
 * etiqueta genérica cobrada del saldo del cliente hasta que arregle sus
 * credenciales en /mis-transportes.
 */
export function parsearPropias(json: string | null | undefined): CredencialesAndreani {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/andreani] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.username || !parsed.password) {
    console.warn('[credenciales/andreani] Credenciales propias incompletas (faltan username/password). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan username o password');
  }
  return {
    username: parsed.username,
    password: parsed.password,
    cliente: parsed.cliente || '',
    id_sucursal_origen: parsed.id_sucursal_origen || '',
    contrato_domicilio: parsed.contrato_domicilio || '',
    contrato_sucursal: parsed.contrato_sucursal || '',
    contrato_cambio: parsed.contrato_cambio || '',
    contrato_devolucion: parsed.contrato_devolucion || '',
    contrato_sucursal_sucursal: parsed.contrato_sucursal_sucursal || '',
    contrato_domicilio_sucursal: parsed.contrato_domicilio_sucursal || '',
    contrato_sucursal_domicilio: parsed.contrato_sucursal_domicilio || '',
    contrato_domicilio_domicilio: parsed.contrato_domicilio_domicilio || ''
  };
}
