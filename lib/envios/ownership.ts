import prisma from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import type { Prisma, Envio } from "@prisma/client";

// Ownership canonico de Envio = empresa asignada en la creacion:
// relacion Envio.empresa via Envio.empresaId -> Empresa.id
// (escrita en lib/envios/crear.ts:597, "empresa: { connect: { id: empresaId } }").
// DEUDA 87 FAMILIA 2, decision de arquitectura 2026-07-04.
//
// Devuelve null ante mismatch (mismo criterio que lib/depositos/auth.ts:
// no filtrar existencia — defense-in-depth). El caller responde 404 en
// ambos casos: envio inexistente y envio ajeno son indistinguibles al cliente.

type Lookup = { trackingNumber: string } | { envioId: number };

export async function verificarAccesoEnvio<
  I extends Prisma.EnvioInclude | undefined = undefined
>(
  lookup: Lookup,
  ctx: AuthContext,
  include?: I
): Promise<
  | (I extends Prisma.EnvioInclude
      ? Prisma.EnvioGetPayload<{ include: I }>
      : Envio)
  | null
> {
  const where: Prisma.EnvioWhereUniqueInput =
    "trackingNumber" in lookup
      ? { trackingNumber: lookup.trackingNumber }
      : { id: lookup.envioId };

  const envio = await prisma.envio.findUnique({ where, include });

  if (!envio) return null;

  // Shipro (Modo Dios): scope global.
  if (ctx.empresaId === null) return envio as any;

  // Cliente/apikey: solo su empresa.
  if (envio.empresaId !== ctx.empresaId) return null;

  return envio as any;
}
