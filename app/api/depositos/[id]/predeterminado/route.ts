import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { procesarEnviosBloqueadosPorDeposito } from "@/lib/envios/procesar-bloqueados-deposito";

// ==========================================
// POST /api/depositos/[id]/predeterminado
// Marca un depósito como predeterminado en transacción atómica:
// desmarca todos los demás de la empresa, marca este.
// Validaciones:
// - Depósito debe estar activo y no eliminado.
// ==========================================
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  const deposito = acceso.deposito;
  if (deposito.eliminado) return NextResponse.json({ error: "No se puede marcar un depósito eliminado como predeterminado." }, { status: 400 });
  if (!deposito.activo) return NextResponse.json({ error: "No se puede marcar un depósito inactivo como predeterminado. Activalo primero." }, { status: 400 });

  if (deposito.esPredeterminado) {
    return NextResponse.json({ success: true, deposito });
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    await tx.deposito.updateMany({
      where: { empresaId: deposito.empresaId, esPredeterminado: true, NOT: { id: depositoId } },
      data: { esPredeterminado: false },
    });
    return tx.deposito.update({
      where: { id: depositoId },
      data: { esPredeterminado: true },
    });
  });

  // DEUDA 4: la empresa ahora tiene predeterminado activo → intentar destrabar
  // envíos en BLOQUEADO_DEPOSITO (e-commerce que crearon antes de configurar).
  const recovery = await procesarEnviosBloqueadosPorDeposito(deposito.empresaId);

  return NextResponse.json({ success: true, deposito: actualizado, recovery });
}
