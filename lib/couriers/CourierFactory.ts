import { ICourierIntegrator } from './CourierInterface';
import { AndreaniAdapter } from './AndreaniAdapter';
import { MocisAdapter } from './MocisAdapter';
import { normalizarParaComparacion } from './normalizar';
import { SERVICIOS_SOPORTADOS } from './serviciosSoportados';

// DEUDA 32+37: lista de couriers con adapter (nombre canonico normalizado).
// Se DERIVA del registry de servicios (SERVICIOS_SOPORTADOS) para garantizar
// una sola fuente de verdad — la lista nunca puede desincronizarse del registry.
// IMPORTANTE: el switch de CourierFactory.crear() debe tener un `case` por cada
// courier de esta lista. Al integrar un courier nuevo: (1) agregar su entrada al
// registry serviciosSoportados.ts, (2) agregar su `case` al switch de abajo Y a
// COURIERS_CON_CASE. La consistencia entre registry y switch se verifica con
// verificarConsistenciaCouriers() (abajo).
export const COURIERS_SOPORTADOS = Object.keys(SERVICIOS_SOPORTADOS);

// Lista explicita de couriers que tienen un `case` en el switch de crear().
// Los switches de JS no son reflectables, asi que esta lista se mantiene a mano
// junto al switch — misma disciplina que agregar un case. verificarConsistencia-
// Couriers() la compara contra el registry para detectar desincronizacion.
const COURIERS_CON_CASE = ['andreani', 'mocis'];

// Detecta drift entre el registry (COURIERS_SOPORTADOS) y el switch
// (COURIERS_CON_CASE). Devuelve los desalineados en cada direccion.
// enRegistrySinCase: declarados en el registry pero sin case -> apareceria
//   "soportado" pero fallaria al despachar con "no soportado".
// enCaseSinRegistry: tienen case pero no estan en el registry -> el adapter
//   existe pero el admin no puede mapear sus servicios.
// Consistente cuando ambas listas estan vacias.
export function verificarConsistenciaCouriers(): {
  consistente: boolean;
  enRegistrySinCase: string[];
  enCaseSinRegistry: string[];
} {
  const enRegistrySinCase = COURIERS_SOPORTADOS.filter((c) => !COURIERS_CON_CASE.includes(c));
  const enCaseSinRegistry = COURIERS_CON_CASE.filter((c) => !COURIERS_SOPORTADOS.includes(c));
  return {
    consistente: enRegistrySinCase.length === 0 && enCaseSinRegistry.length === 0,
    enRegistrySinCase,
    enCaseSinRegistry,
  };
}

// Devuelve la lista de couriers que tienen adapter, sin instanciar nada
// (no requiere credenciales). La consume el asistente de alta de courier:
// comparando esta lista contra los couriers en BD, los que faltan son los
// integrables (tienen adapter pero no fila en Courier todavia).
export function couriersSoportados(): string[] {
  return [...COURIERS_SOPORTADOS];
}

// Devuelve true si el courier (cualquier variante de nombre) tiene adapter.
export function courierTieneSoporte(courierNombre: string): boolean {
  return COURIERS_SOPORTADOS.includes(normalizarParaComparacion(courierNombre));
}

export class CourierFactory {
  static crear(courier: string, credenciales: any): ICourierIntegrator {
    // Defense-in-depth: tolerar variantes ("Moci's", "MOCIS", "andreani ")
    // sin importar cómo el caller normalizó. Una sola fuente de verdad.
    switch (normalizarParaComparacion(courier)) {

      case 'andreani':
        return new AndreaniAdapter({
          username: credenciales.usuario || credenciales.username,
          password: credenciales.password,
          cliente: credenciales.cliente || "0",
          id_sucursal_origen: credenciales.id_sucursal_origen,
          contrato_domicilio: credenciales.contrato_domicilio || credenciales.contrato || "0",
          contrato_sucursal: credenciales.contrato_sucursal || credenciales.contrato || "0",
          contrato_cambio: credenciales.contrato_cambio,
          contrato_devolucion: credenciales.contrato_devolucion,
          contrato_sucursal_sucursal: credenciales.contrato_sucursal_sucursal,
          contrato_domicilio_sucursal: credenciales.contrato_domicilio_sucursal,
          contrato_sucursal_domicilio: credenciales.contrato_sucursal_domicilio,
          contrato_domicilio_domicilio: credenciales.contrato_domicilio_domicilio
        });

      case 'mocis':
        if (!credenciales.clientApi || !credenciales.clientSecret) throw new Error("Faltan llaves de Moci's");
        return new MocisAdapter(credenciales.clientApi, credenciales.clientSecret);

      // Para sumar un nuevo courier: (1) agregar su entrada al registry
      // serviciosSoportados.ts (eso lo suma a COURIERS_SOPORTADOS), (2) importar
      // el adapter arriba, (3) agregar un nuevo `case` aca. Los 3 pasos juntos.

      default:
        throw new Error(`El courier '${courier}' no está soportado en la plataforma.`);
    }
  }
}