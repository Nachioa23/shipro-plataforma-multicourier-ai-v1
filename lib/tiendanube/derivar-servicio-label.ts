// =============================================================================
// DEUDA 144 (Momento 3 labels, pieza 3a) — Deriva (courier + servicio + sucursal)
// desde el shipping.option de un fulfillment order de Tiendanube.
// =============================================================================
// FUENTE PRIMARIA — option.reference: es el JSON string que emitimos en el rates
// callback (shape: `{ courier, modalidad, codigoServicio, id, sucursalId? }` —
// ver app/api/tiendanube/rates/route.ts). Poggi/doc confirman que Tiendanube lo
// devuelve íntegro en el fulfillment order. Este camino recupera además el
// sucursalId (id LOCAL de SucursalCourier) cuando la rate era pickup.
//
// RED DE RESPALDO — option.code: slug estable que Tiendanube valida y preserva
// (lo pre-registramos como carrier option, ver lib/tiendanube/carrier.ts). Se
// resuelve mirroring de enumerarServiciosPublicados(empresaId), buscando la
// entrada con .code === option.code. Como el slug es lossy (lowercase +
// non-alnum → guion), la reversión REQUIERE el contexto de la empresa y no se
// puede hacer parseando el string.
//
// Ambos fallan → null (el caller marca la etiqueta como no-derivable; el reporte
// FAILED a Tiendanube queda para 3b).
//
// tipoEntrega: PRIORIZA shippingType ("pickup"→sucursal, "ship"→domicilio) por
// ser el ground-truth que manda Tiendanube en el propio callback. Si no viene
// (shape inesperado), se infiere del reference (sucursalId presente ⇒ sucursal;
// ausente ⇒ domicilio) — el fallback por-code trae su propio tipoEntrega desde
// el registry.
// =============================================================================

import { enumerarServiciosPublicados } from "@/lib/tiendanube/servicios-publicados";

export interface ServicioDerivado {
  /** Nombre canónico del courier (matcheable por obtenerCourier — tolerante a case/apóstrofes). */
  courierNombre: string;
  /** Código canónico del servicio del registry (ej. "entrega_domicilio_estandar"). Null si no aplicable. */
  codigoServicio: string | null;
  tipoEntrega: "domicilio" | "sucursal";
  /** id LOCAL de SucursalCourier — sólo cuando la rate era pickup y viene por reference. */
  sucursalId: number | null;
  /** Trazabilidad: de dónde salió el resultado. Útil para debug/audit. */
  fuente: "reference" | "code";
}

export async function derivarServicioLabel(
  empresaId: number,
  option: { code?: string | null; reference?: string | null },
  shippingType?: string | null,
): Promise<ServicioDerivado | null> {
  // Camino 1 — reference (fuente primaria).
  const refRaw = option?.reference;
  if (refRaw) {
    try {
      const ref: any = JSON.parse(refRaw);
      const courierNombre =
        typeof ref?.courier === "string" && ref.courier.trim() ? ref.courier.trim() : null;
      const codigoServicio =
        typeof ref?.codigoServicio === "string" && ref.codigoServicio.trim()
          ? ref.codigoServicio.trim()
          : null;
      if (courierNombre && codigoServicio) {
        const sucursalIdParsed = Number(ref?.sucursalId);
        const sucursalId = Number.isInteger(sucursalIdParsed) ? sucursalIdParsed : null;
        const tipoEntrega: "domicilio" | "sucursal" =
          shippingType === "pickup"
            ? "sucursal"
            : shippingType === "ship"
            ? "domicilio"
            : sucursalId !== null
            ? "sucursal"
            : "domicilio";
        return {
          courierNombre,
          codigoServicio,
          tipoEntrega,
          sucursalId,
          fuente: "reference",
        };
      }
      // reference parseó pero le faltan campos críticos → cae al camino 2.
    } catch {
      // JSON inválido → cae al camino 2.
    }
  }

  // Camino 2 — code (red de respaldo). Requiere empresaId para reversar el slug.
  const code =
    typeof option?.code === "string" && option.code.trim() ? option.code.trim() : null;
  if (!code) return null;

  const servicios = await enumerarServiciosPublicados(empresaId);
  const match = servicios.find((s) => s.code === code);
  if (!match) return null;

  return {
    courierNombre: match.courierNombre,
    codigoServicio: match.codigoServicio,
    tipoEntrega: match.tipoEntrega,
    sucursalId: null,
    fuente: "code",
  };
}
