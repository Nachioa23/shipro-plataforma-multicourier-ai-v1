// =============================================================================
// ENDPOINTS: GET (single) + DELETE para DepositoCourierConfig
// DEUDA 29 Sub-fase 6.D.2 — Acceso individual a una config (depósito × courier)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";

const prisma = new PrismaClient();

// =============================================================================
// GET /api/depositos/[id]/courier-configs/[courierId]
// Devuelve una config específica con datos enriquecidos.
// Roles permitidos: ROLES_LECTURA (los 4 roles).
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; courierId: string }> }
) {
  const { id, courierId: courierIdParam } = await params;

  const depositoId = parseInt(id, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }

  const courierId = parseInt(courierIdParam, 10);
  if (isNaN(courierId)) {
    return NextResponse.json({ error: "courierId inválido" }, { status: 400 });
  }

  // Auth + ownership + existencia del depósito.
  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  // Buscar la config específica.
  const config = await prisma.depositoCourierConfig.findUnique({
    where: {
      depositoId_courierId: { depositoId, courierId },
    },
    include: {
      courier: {
        select: {
          id: true,
          nombre: true,
          activo: true,
          tieneSucursales: true,
          puedeConsolidar: true,
          cpDepositoConsolidador: true,
        },
      },
      courierRecolector: {
        select: {
          id: true,
          nombre: true,
          puedeConsolidar: true,
          cpDepositoConsolidador: true,
        },
      },
    },
  });

  if (!config) {
    return NextResponse.json(
      { error: "Config no encontrada para este depósito y courier" },
      { status: 404 }
    );
  }

  return NextResponse.json({ config });
}

// =============================================================================
// DELETE /api/depositos/[id]/courier-configs/[courierId]
// Elimina una config específica (hard delete).
// Roles permitidos: ROLES_ESCRITURA (admin_shipro + gerente_cliente).
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; courierId: string }> }
) {
  const { id, courierId: courierIdParam } = await params;

  const depositoId = parseInt(id, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }

  const courierId = parseInt(courierIdParam, 10);
  if (isNaN(courierId)) {
    return NextResponse.json({ error: "courierId inválido" }, { status: 400 });
  }

  // Auth + ownership + permiso de escritura.
  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  // Verificar que la config existe antes de borrar (para devolver 404 explícito).
  const existente = await prisma.depositoCourierConfig.findUnique({
    where: {
      depositoId_courierId: { depositoId, courierId },
    },
  });

  if (!existente) {
    return NextResponse.json(
      { error: "Config no encontrada para este depósito y courier" },
      { status: 404 }
    );
  }

  // Hard delete (no es soft-delete porque no tiene impacto histórico).
  await prisma.depositoCourierConfig.delete({
    where: {
      depositoId_courierId: { depositoId, courierId },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      message: "Config eliminada correctamente",
      deleted: {
        depositoId,
        courierId,
      },
    },
    { status: 200 }
  );
}
