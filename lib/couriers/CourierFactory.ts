import { ICourierIntegrator } from './CourierInterface';
import { AndreaniAdapter } from './AndreaniAdapter';
import { MocisAdapter } from './MocisAdapter';
import { OcaAdapter, CredencialesOca } from './OcaAdapter';
import { CorreoArgentinoAdapter, CredencialesCorreoArgentino } from './CorreoArgentinoAdapter';
import { HopEnviosAdapter, CredencialesHopEnvios } from './HopEnviosAdapter';
import { IntralogAdapter } from './IntralogAdapter';
import { PickitAdapter, CredencialesPickit } from './PickitAdapter';
import { MockCourierAdapter } from './MockCourierAdapter';
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
const COURIERS_CON_CASE = ['andreani', 'mocis', 'oca', 'correoargentino', 'hopenvios', 'intralog', 'pickit'];

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
    // ------------------------------------------------------------------
    // LOAD TEST ESCAPE HATCH — NUNCA debe activarse en prod.
    // Doble gate independiente (NODE_ENV se removió porque next start lo
    // fija en "production" y queremos testear contra el build de prod):
    //   1. flag explícito LOAD_TEST_MOCK_COURIERS=true,
    //   2. DATABASE_URL NO apunta a la BD de prod (akamaidb).
    // Si cualquiera de las 2 falla, caemos al switch real.
    // ------------------------------------------------------------------
    const dbHost = process.env.DATABASE_URL || "";
    if (process.env.LOAD_TEST_MOCK_COURIERS === 'true' && !dbHost.includes('akamaidb')) {
      console.warn('⚠️ [LOAD TEST] MockCourierAdapter activo para', courier, '— NUNCA en prod');
      return new MockCourierAdapter(courier);
    }

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

      case 'oca': {
        const oca: CredencialesOca = {
          usuario:              credenciales.usuario || "",
          password:             credenciales.password || "",
          cuit:                 credenciales.cuit || "",
          nrocuenta:            credenciales.nrocuenta || "",
          operativa_domicilio:  credenciales.operativa_domicilio || "",
          operativa_sucursal:   credenciales.operativa_sucursal,
          operativa_inversa:    credenciales.operativa_inversa,
          sandbox:              credenciales.sandbox === true,
        };
        if (!oca.usuario || !oca.password || !oca.cuit || !oca.nrocuenta || !oca.operativa_domicilio) {
          throw new Error("Faltan credenciales de OCA: se requieren usuario, password, cuit, nrocuenta y operativa_domicilio");
        }
        return new OcaAdapter(oca);
      }

      case 'correoargentino': {
        const ca: CredencialesCorreoArgentino = {
          apiKey:     credenciales.apiKey     || "",
          agreement:  credenciales.agreement  || "",
          sellerId:   credenciales.sellerId   || "",
          customerId: credenciales.customerId || "",
          // DEUDA 171 BUG 1 (2026-10-08): propagación de credenciales MiCorreo.
          // NO entran al check de abajo (ese es Paq.ar/despacho). Si vienen vacías,
          // cotizar() hace short-circuit y devuelve [] (venta cae a otro courier).
          micorreoUser:     credenciales.micorreoUser     || "",
          micorreoPassword: credenciales.micorreoPassword || "",
          sandbox:    credenciales.sandbox === true,
        };
        if (!ca.apiKey || !ca.agreement || !ca.sellerId || !ca.customerId) {
          throw new Error(
            "Faltan credenciales de Correo Argentino: se requieren apiKey, agreement, sellerId y customerId",
          );
        }
        return new CorreoArgentinoAdapter(ca);
      }

      case 'hopenvios': {
        const hop: CredencialesHopEnvios = {
          clientId:     credenciales.clientId     || "",
          clientSecret: credenciales.clientSecret || "",
          email:        credenciales.email        || "",
          password:     credenciales.password     || "",
          sellerCode:   credenciales.sellerCode   || "",
          baseUrl:      credenciales.baseUrl,
        };
        if (!hop.clientId || !hop.clientSecret || !hop.email || !hop.password || !hop.sellerCode) {
          throw new Error(
            "Faltan credenciales de Hop Envíos: se requieren clientId, clientSecret, email, password y sellerCode",
          );
        }
        return new HopEnviosAdapter(hop);
      }

      case 'intralog':
        if (!credenciales.usuario || !credenciales.password) {
          throw new Error('Faltan credenciales de Intralog (usuario/password)');
        }
        return new IntralogAdapter(credenciales.usuario, credenciales.password);

      case 'pickit': {
        const slaIdNum = Number(credenciales.slaId);
        const pk: CredencialesPickit = {
          apiKey:  credenciales.apiKey  || "",
          token:   credenciales.token   || "",
          baseUrl: credenciales.baseUrl,
          sandbox: credenciales.sandbox === true,
          slaId:   Number.isFinite(slaIdNum) && slaIdNum > 0 ? Math.floor(slaIdNum) : 1,
        };
        if (!pk.apiKey || !pk.token) {
          throw new Error(
            "Faltan credenciales de Pickit: se requieren apiKey y token",
          );
        }
        return new PickitAdapter(pk);
      }

      // Para sumar un nuevo courier: (1) agregar su entrada al registry
      // serviciosSoportados.ts (eso lo suma a COURIERS_SOPORTADOS), (2) importar
      // el adapter arriba, (3) agregar un nuevo `case` aca. Los 3 pasos juntos.

      default:
        throw new Error(`El courier '${courier}' no está soportado en la plataforma.`);
    }
  }
}