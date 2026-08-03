import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// FASE 2 sub 5 motor mov 1 (2026-08-03): resolvers de las tres variables de
// tarifa configurables (markup Shipro global, SMO por courier, markup
// intermediario por dueño). Ver docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md.
//
// Este módulo NO está conectado al motor de plata todavía. Sirve como pieza
// aislada + testeable para el movimiento 2 (wiring en cotizador +
// crear.ts:fallback + conciliación), que se hace en un commit aparte.
// El objetivo del split es que este commit no cambie precios.
//
// Contrato de las tres funciones:
//   - Cada una acepta un `client` opcional (default: prisma) para poder
//     participar dentro de una $transaction (`tx`) — mismo patrón que
//     lib/utils/operacion-fee.ts `calcularFeeOperacion`.
//   - Cada una usa el patrón activo-vigente EXACTO del resto del repo:
//         activo=true AND vigencia*Desde <= ahora
//         AND (vigencia*Hasta IS NULL OR vigencia*Hasta >= ahora)
//         orderBy vigencia*Desde desc, take 1.
//     Ojo con la ortografía: MarkupShiproVigencia y SmoCourier usan
//     `vigencia*` (misma que CourierIntermediario); OperacionFee tiene
//     `vigente*` (DEUDA 114, aparte).
//
// Aislamiento del motor: mientras nadie llame a estos resolvers, los precios
// no cambian. El commit del wiring (movimiento 2) es donde efectivamente
// migra el motor a las nuevas fuentes.

/**
 * Resuelve el % de markup Shipro a aplicar en la cascada de aplicarMarkup.
 *
 * REGLA (Nacho, 2026-08-03, ver DISENO-MODELO-DATOS-CONFIG-VARIABLES.md §5.2):
 *   - Si CredencialCourier.ajusteTarifaPorcentaje > 0 → es un OVERRIDE
 *     explícito para ese par cliente↔courier: devolvemos ese %.
 *   - Si es 0 → HEREDA el markup Shipro GLOBAL vigente
 *     (MarkupShiproVigencia). Motivación: el markup Shipro nunca es 0 en el
 *     negocio, así que 0 = "no seteado / inherit"; además una empresa
 *     accidentalmente en 0 hereda el global en vez de perder margen.
 *   - Si por algún motivo NO hay MarkupShiproVigencia activa (nunca
 *     debería, hay seed): warn + devolver 0. Fail-open sobre fail-loud
 *     porque la ausencia acá bloquearía cotización.
 *
 * NO hay cambio de schema: ajusteTarifaPorcentaje sigue siendo
 * Float @default(0.0) NOT NULL. La convención "0 = inherit" reemplaza a la
 * convención documentada "null = inherit" del diseño.
 */
export async function resolverMarkupShiproPorcentaje(
  ajusteTarifaPorcentaje: number,
  client: { markupShiproVigencia: typeof prisma.markupShiproVigencia } = prisma
): Promise<number> {
  if (Number.isFinite(ajusteTarifaPorcentaje) && ajusteTarifaPorcentaje > 0) {
    return ajusteTarifaPorcentaje;
  }

  const ahora = new Date();
  const activo = await client.markupShiproVigencia.findFirst({
    where: {
      activo: true,
      vigenciaDesde: { lte: ahora },
      OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: ahora } }],
    },
    orderBy: { vigenciaDesde: "desc" },
  });

  if (!activo) {
    console.warn(
      "[resolverMarkupShiproPorcentaje] No hay MarkupShiproVigencia activa — revisar seed/config. Devolviendo 0."
    );
    return 0;
  }

  return Number(activo.valorPorcentaje);
}

/**
 * Resuelve el SMO neto (Decimal, SIN IVA) del courier ejecutor.
 *
 * REGLA (Nacho, 2026-08-03, ver DISENO-MODELO-DATOS-CONFIG-VARIABLES.md §5.3):
 *   - Lee la fila activa/vigente de SmoCourier para el courier.
 *   - Sin fila activa: warn + devolver Decimal(0). NO se cae al legacy
 *     Courier.smoPrecioAlClienteConIva — los valores se seedearon en la
 *     migración (sub-piece 1, commit 3a0ce72 + seed en commit 00e8300).
 *     Si un courier no tiene fila SmoCourier es un problema de config que
 *     hay que ver, no debería enmascararse con un dual-read.
 */
export async function resolverSmoNeto(
  courierId: number,
  client: { smoCourier: typeof prisma.smoCourier } = prisma
): Promise<Prisma.Decimal> {
  const ahora = new Date();
  const activo = await client.smoCourier.findFirst({
    where: {
      courierId,
      activo: true,
      vigenciaDesde: { lte: ahora },
      OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: ahora } }],
    },
    orderBy: { vigenciaDesde: "desc" },
  });

  if (!activo) {
    console.warn(
      `[resolverSmoNeto] No hay SmoCourier activo para courierId=${courierId} — revisar seed/config. Devolviendo 0.`
    );
    return new Prisma.Decimal(0);
  }

  return activo.valorNeto;
}

/**
 * Resuelve el % del markup del intermediario (dueño de credenciales), Rama A.
 *
 * REGLA (Nacho, 2026-08-03, ver DISENO-MODELO-DATOS-CONFIG-VARIABLES.md §5.1
 * + DISENO-PROPIEDAD-CREDENCIALES.md):
 *   - Rama B (usaCredencialesPropias=true) → null: sin cascada de intermediario.
 *   - propietarioTipo === "SHIPRO"  → null: Shipro es dueño, no hay markup
 *     de intermediario (no es "tercero prestando"; Shipro se cobra a sí misma
 *     vía el markup Shipro global).
 *   - propietarioTipo === "COURIER" → owner-keyed: activo/vigente en
 *     CourierIntermediario donde propietarioCourierId === el dueño de la
 *     credencial. Si propietarioCourierId es null pese al tipo COURIER
 *     (inconsistencia), warn + null. Sin fila para ese dueño → null.
 *   - propietarioTipo === "CLIENTE" → null: defensivo (CLIENTE implica Rama B
 *     por construcción; si llegó acá con usaCredencialesPropias=false hay
 *     inconsistencia — warn).
 *   - propietarioTipo === null (LEGACY antes de FASE 2 pieza 1) → FALLBACK
 *     al lookup EJECUTOR-keyed histórico (CourierIntermediario.courierId ===
 *     courierEjecutorId). Preserva números de cotización pre-migración; la
 *     creación de envío YA bloquea estos casos con BLOQUEADO_CREDENCIAL
 *     (commit c85269d), así que este fallback sólo aplica al browse/quote.
 *
 * `courierIntermediario.markupPorcentaje` en schema es Float @default(0.0);
 * lo devolvemos como number sin transformar.
 */
export async function resolverIntermediarioMarkupPorcentaje(
  credencial: {
    usaCredencialesPropias: boolean;
    propietarioTipo: "CLIENTE" | "SHIPRO" | "COURIER" | null;
    propietarioCourierId: number | null;
  },
  courierEjecutorId: number,
  client: { courierIntermediario: typeof prisma.courierIntermediario } = prisma
): Promise<number | null> {
  // Rama B: sin intermediario en la cascada.
  if (credencial.usaCredencialesPropias === true) return null;

  const ahora = new Date();
  const vigenciaFilter = {
    activo: true,
    vigenciaDesde: { lte: ahora },
    OR: [
      { vigenciaHasta: null as Date | null },
      { vigenciaHasta: { gte: ahora } },
    ],
  };

  switch (credencial.propietarioTipo) {
    case "SHIPRO":
      return null;

    case "CLIENTE":
      // Defensivo: CLIENTE debería implicar Rama B (usaCredencialesPropias=true),
      // que ya retornó null arriba. Si llegamos acá, hay inconsistencia.
      console.warn(
        "[resolverIntermediarioMarkupPorcentaje] Credencial con propietarioTipo=CLIENTE y usaCredencialesPropias=false — inconsistencia de datos. Devolviendo null."
      );
      return null;

    case "COURIER": {
      if (credencial.propietarioCourierId == null) {
        console.warn(
          "[resolverIntermediarioMarkupPorcentaje] Credencial con propietarioTipo=COURIER pero propietarioCourierId=null — inconsistencia de datos. Devolviendo null."
        );
        return null;
      }
      const inter = await client.courierIntermediario.findFirst({
        where: { propietarioCourierId: credencial.propietarioCourierId, ...vigenciaFilter },
        orderBy: { vigenciaDesde: "desc" },
      });
      return inter ? Number(inter.markupPorcentaje) : null;
    }

    case null:
    default: {
      // LEGACY: credenciales pre-FASE-2-pieza-1 sin propietario seteado.
      // Fallback ejecutor-keyed histórico (mismo lookup que el motor
      // pre-cambio) para no cambiar los números de cotización de configs
      // viejas. La creación de envío ya bloquea estos casos con
      // BLOQUEADO_CREDENCIAL (sub-piece 3, commit c85269d), así que este
      // fallback sólo aplica al camino de browse/quote.
      const inter = await client.courierIntermediario.findFirst({
        where: { courierId: courierEjecutorId, ...vigenciaFilter },
        orderBy: { vigenciaDesde: "desc" },
      });
      return inter ? Number(inter.markupPorcentaje) : null;
    }
  }
}
