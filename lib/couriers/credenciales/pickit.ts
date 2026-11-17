export interface CredencialesPickit {
  apiKey: string;         // API key del seller en Pickit
  token: string;          // token/secret del seller
  baseUrl?: string;       // URL de producción (opcional — fallback a UAT)
  sandbox?: boolean;      // true = apuntar a entorno de pruebas (semántico; el default ya es UAT)
  slaId: number;          // sla.id que Pickit requiere en /budget y /transaction (default 1, TODO confirmar en QA)
}

const SLA_ID_DEFAULT = 1;

function parsearSlaId(valor: unknown): number {
  const n = Number(valor);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return SLA_ID_DEFAULT;
}

/**
 * Devuelve las credenciales master de Shipro para Pickit, leídas desde .env.local.
 * Solo se usa cuando el cliente NO tiene credenciales propias (usaCredencialesPropias = false)
 * o cuando no existe registro en CredencialCourier para esa empresa+courier.
 */
export function obtenerShipro(): CredencialesPickit {
  return {
    apiKey: process.env.PICKIT_API_KEY?.trim() || '',
    token: process.env.PICKIT_TOKEN?.trim() || '',
    baseUrl: process.env.PICKIT_BASE_URL?.trim() || undefined,
    sandbox: process.env.PICKIT_SANDBOX?.trim() === 'true',
    slaId: parsearSlaId(process.env.PICKIT_SLA_ID?.trim()),
  };
}

/**
 * Parsea las credenciales propias del cliente. Si están ausentes, vacías o
 * incompletas (faltan apiKey o token), LANZA un error específico para que el
 * caller entre al flujo de etiqueta genérica.
 *
 * NO HACE FALLBACK A SHIPRO. Política de negocio (protección financiera).
 * Ver doc en andreani.ts.
 */
export function parsearPropias(json: string | null | undefined): CredencialesPickit {
  if (!json) {
    throw new Error('CredencialesPropiasFaltantes: JSON vacío o nulo en credencialesJson');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[credenciales/pickit] JSON inválido en credenciales propias. Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasInvalidas: JSON malformado');
  }
  if (!parsed.apiKey || !parsed.token) {
    console.warn('[credenciales/pickit] Credenciales propias incompletas (faltan apiKey/token). Se debe generar etiqueta genérica.');
    throw new Error('CredencialesPropiasIncompletas: faltan campos Pickit requeridos');
  }
  return {
    apiKey: parsed.apiKey,
    token: parsed.token,
    baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : undefined,
    sandbox: parsed.sandbox === true,
    slaId: parsearSlaId(parsed.slaId),
  };
}
