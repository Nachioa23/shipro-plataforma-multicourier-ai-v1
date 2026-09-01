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
 * Helper interno: resuelve el markup Shipro GLOBAL activo/vigente
 * (MarkupShiproVigencia). Es el valor que los MarkupCourier en modo HEREDA
 * siguen en vivo. Sin vigencia activa → warn + 0 (fail-open — nunca debería
 * pasar; hay seed que crea la fila inicial 10%).
 * DEUDA 157 Pieza 3 (2026-09-01): extraído del viejo resolverMarkupShiproPorcentaje
 * para reuso desde resolverMarkupCourierPorcentaje (HEREDA + safety net).
 */
async function resolverGlobalMarkupPorcentaje(
  client: { markupShiproVigencia: typeof prisma.markupShiproVigencia } = prisma
): Promise<number> {
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
      "[resolverGlobalMarkupPorcentaje] No hay MarkupShiproVigencia activa — revisar seed/config. Devolviendo 0."
    );
    return 0;
  }
  return Number(activo.valorPorcentaje);
}

/**
 * DEUDA 157 markup unificado Pieza 3 (2026-09-01): resuelve el % de markup
 * Shipro por courier desde MarkupCourier (con modo HEREDA/PROPIO). Reemplaza
 * el viejo resolverMarkupShiproPorcentaje (que leía el override per-credencial
 * + fallback global).
 *
 * REGLA (Nacho, 2026-09-01, ver DEUDA 157 markup unificado en DEUDAS.md):
 *   - Rama B (usaCredencialesPropias=true): **NO markup Shipro** — gate al
 *     tope, no se consulta MarkupCourier. Devuelve 0 sin query.
 *   - Rama A: lee la fila activa/vigente de MarkupCourier para el courier:
 *     * modo=HEREDA → devuelve el global MarkupShiproVigencia vigente
 *       (vínculo vivo: si el global cambia, este courier lo sigue).
 *     * modo=PROPIO → devuelve `valorPorcentaje` de la fila (permite 0 —
 *       markup apagado a propósito, distinto de heredar 0).
 *   - Sin fila MarkupCourier para el courier: NO debería pasar (Pieza 1
 *     hace que default HEREDA cubra todo courier activo automáticamente).
 *     Safety net: warn + cae al global (mismo comportamiento que HEREDA).
 *     NO throw — no romper cotización por config faltante.
 *
 * NOTA: el intermediario markup (owner-lent, Rama A) es un cascade SEPARADO
 * (resolverIntermediarioMarkupPorcentaje) y NO cambia con Pieza 3.
 */
export async function resolverMarkupCourierPorcentaje(
  courierId: number,
  usaCredencialesPropias: boolean,
  client: {
    markupShiproVigencia: typeof prisma.markupShiproVigencia;
    markupCourier: typeof prisma.markupCourier;
  } = prisma
): Promise<number> {
  // Rama B: sin markup Shipro por diseño (mismo criterio que aplicarMarkup L228).
  if (usaCredencialesPropias) return 0;

  const ahora = new Date();
  const row = await client.markupCourier.findFirst({
    where: {
      courierId,
      activo: true,
      vigenciaDesde: { lte: ahora },
      OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: ahora } }],
    },
    orderBy: { vigenciaDesde: "desc" },
    select: { modo: true, valorPorcentaje: true },
  });

  if (!row) {
    console.warn(
      `[resolverMarkupCourierPorcentaje] No hay MarkupCourier activo para courierId=${courierId} — cae al global (safety net). Revisar config (debería existir por default HEREDA de Pieza 1).`
    );
    return await resolverGlobalMarkupPorcentaje(client);
  }

  if (row.modo === "PROPIO") {
    return Number(row.valorPorcentaje);
  }

  // HEREDA → global en vivo.
  return await resolverGlobalMarkupPorcentaje(client);
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
