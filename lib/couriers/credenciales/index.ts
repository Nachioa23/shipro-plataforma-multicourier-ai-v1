import * as andreani from './andreani';
import * as mocis from './mocis';

/**
 * Devuelve credenciales master de Shipro para el courier indicado.
 * Si el courier no está soportado, retorna {}.
 *
 * Para sumar un courier nuevo:
 *   1. Crear lib/couriers/credenciales/<nombre>.ts con su Interface +
 *      obtenerShipro() + parsearPropias().
 *   2. Agregar el case correspondiente acá.
 */
export function obtenerCredencialesShipro(courier: string): unknown {
  const c = courier.toLowerCase().replace(/['\s]/g, '');
  switch (c) {
    case 'andreani': return andreani.obtenerShipro();
    case 'mocis':    return mocis.obtenerShipro();
    default:         return {};
  }
}

/**
 * Parsea las credenciales propias del cliente. Si el JSON está ausente, vacío,
 * inválido o le faltan los campos críticos del courier, LANZA un error específico.
 *
 * El caller debe capturar el error y aplicar la lógica de etiqueta genérica
 * (NO hacer fallback automático a las credenciales master de Shipro — política
 * de protección financiera: ver doc en andreani.ts).
 */
export function parsearCredencialesPropias(courier: string, json: string | null | undefined): unknown {
  const c = courier.toLowerCase().replace(/['\s]/g, '');
  switch (c) {
    case 'andreani': return andreani.parsearPropias(json);
    case 'mocis':    return mocis.parsearPropias(json);
    default:         return {};
  }
}

export type { CredencialesAndreani } from './andreani';
export type { CredencialesMocis } from './mocis';
