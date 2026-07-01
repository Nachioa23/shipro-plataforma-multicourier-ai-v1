import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// DEUDA 10 Paso 4b (D-10-FEE-CHARGE): helper del fee por operacion Modelo B.
// Lee el OperacionFee vigente de una empresa y calcula el monto a debitar de la
// billetera: valor + IVA. El valor almacenado es PRE-IVA (lo carga el admin sin
// impuestos en el onboarding); aca se le suma el 21%.
//
// Modelo B: el courier le factura el envio directo al cliente; Shipro solo cobra
// este fee por operacion (exitoso o no el despacho, mientras se emita etiqueta).
//
// NO incluye logica de descuentos temporales ni vencimiento automatico: eso vive
// en el onboarding (carga del valor) y en DEUDA 72 (motor de propagacion). Aca
// solo se lee el valor vigente que este cargado, sea estandar o con descuento.

// IVA Argentina. Hoy hardcodeado a 21% (consistente con lib/cotizador.ts).
// DEUDA 73 formalizara el manejo de impuestos como tasa configurable.
const IVA_AR_MULTIPLIER = new Prisma.Decimal("1.21");

export type TipoFee = "FIJO" | "PORCENTAJE";

export interface ResultadoFeeOperacion {
  feePreIva: Prisma.Decimal;   // el valor cargado, sin IVA
  feeConIva: Prisma.Decimal;   // valor + 21% IVA — esto es lo que se debita de la billetera
  tipo: TipoFee;
  detalle: string;     // texto humano para el MovimientoFinanciero / logs
}

/**
 * Lee el OperacionFee activo y vigente de una empresa y calcula el monto a cobrar.
 * Para tipo "PORCENTAJE", el porcentaje se aplica sobre basePrecio (la tarifa del
 * courier — D-10 Respuesta 4). Para "FIJO", basePrecio se ignora.
 *
 * @param empresaId - la empresa Modelo B
 * @param basePrecio - precio del courier sobre el que aplica el % (solo para tipo PORCENTAJE)
 * @returns ResultadoFeeOperacion, o null si no hay fee vigente configurado.
 */
export async function calcularFeeOperacion(
  empresaId: number,
  basePrecio: Prisma.Decimal,
  client: { operacionFee: typeof prisma.operacionFee } = prisma
): Promise<ResultadoFeeOperacion | null> {
  const ahora = new Date();

  const fee = await client.operacionFee.findFirst({
    where: {
      empresaId,
      activo: true,
      vigenteDesde: { lte: ahora },
      OR: [
        { vigenteHasta: null },
        { vigenteHasta: { gte: ahora } },
      ],
    },
    orderBy: { vigenteDesde: "desc" },
  });

  if (!fee) {
    return null;
  }

  const tipo = (fee.tipo === "PORCENTAJE" ? "PORCENTAJE" : "FIJO") as TipoFee;

  // Valor base PRE-IVA segun tipo.
  const feePreIva = tipo === "PORCENTAJE"
    ? basePrecio.mul(fee.valor).div(100)
    : fee.valor;

  const feeConIva = feePreIva.mul(IVA_AR_MULTIPLIER);

  const detalle = tipo === "PORCENTAJE"
    ? `Fee Modelo B ${fee.valor.toString()}% sobre $${basePrecio.toFixed(2)} = $${feePreIva.toFixed(2)} + IVA = $${feeConIva.toFixed(2)}`
    : `Fee Modelo B fijo $${feePreIva.toFixed(2)} + IVA = $${feeConIva.toFixed(2)}`;

  return { feePreIva, feeConIva, tipo, detalle };
}
