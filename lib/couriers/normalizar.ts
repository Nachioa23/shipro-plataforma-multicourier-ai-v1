import prisma from "@/lib/prisma";
import type { Courier, CredencialCourier } from "@prisma/client";

/**
 * Lowercase + strip de apóstrofes y espacios. Útil para keys de switch
 * (CourierFactory) o para comparaciones in-memory.
 *
 *   "Andreani" → "andreani"
 *   "Moci's"   → "mocis"
 *   "MOCI S"   → "mocis"
 */
export function normalizarParaComparacion(nombre: string): string {
  return (nombre || "").toLowerCase().replace(/['\s]/g, '');
}

/**
 * Resuelve un nombre de courier en cualquier formato al registro
 * de Courier (con nombre canónico de BD). null si no existe.
 *
 * Tolera: case insensitive, apóstrofes, espacios, abreviaciones
 * ("moci" matchea "Moci's").
 */
export async function obtenerCourier(nombreInput: string): Promise<Courier | null> {
  if (!nombreInput) return null;
  const normalizado = normalizarParaComparacion(nombreInput);
  const couriers = await prisma.courier.findMany();
  return couriers.find(c => {
    const cNorm = normalizarParaComparacion(c.nombre);
    return cNorm === normalizado || cNorm.startsWith(normalizado) || normalizado.startsWith(cNorm);
  }) ?? null;
}

/**
 * Resuelve la CredencialCourier de una empresa para un courier dado.
 * Acepta el nombre en cualquier formato (resuelve canónico antes
 * del findUnique).
 */
export async function obtenerCredencialCourier(
  empresaId: number,
  nombreInput: string
): Promise<CredencialCourier | null> {
  const courier = await obtenerCourier(nombreInput);
  if (!courier) return null;
  return prisma.credencialCourier.findUnique({
    where: {
      empresaId_nombreCourier: {
        empresaId,
        nombreCourier: courier.nombre
      }
    }
  });
}
