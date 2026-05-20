// =============================================================================
// ENDPOINTS: GET (single) + DELETE para una config específica (par depósito × courier)
// DEUDA 29 Sub-fase 6.D RECTIFICADA (2026-05-19) — Modelo simplificado.
// =============================================================================
//
// Cambios respecto a 6.D.2 original (commit 452d2e0):
// - GET: eliminado include de courierRecolector (campo ya no existe)
// - DELETE: cambia estrategia interna de "findUnique + check + delete" a
//   "delete + catch P2025" (1 query vs 2). Shape del response NO cambia.
// - Cleanup: import prisma desde @/lib/prisma (patrón canónico)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";

// =============================================================================
// GET /api/depositos/[id]/courier-configs/[courierId]
// Devuelve la config específica de un par (depósito × courier) si existe.
// Roles permitidos: ROLES_LECTURA (los 4 roles).
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; courierId: string }> }
) {
  const { id, courierId: courierIdStr } = await params;
  const depositoId = parseInt(id, 10);
  const courierId = parseInt(courierIdStr, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }
  if (isNaN(courierId)) {
    return NextResponse.json({ error: "courierId inválido" }, { status: 400 });
  }

  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

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
// Elimina la config para un par específico (no toca el courier ni el depósito,
// solo el registro de configuración).
// Roles permitidos: ROLES_ESCRITURA (admin_shipro + gerente_cliente).
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; courierId: string }> }
) {
  const { id, courierId: courierIdStr } = await params;
  const depositoId = parseInt(id, 10);
  const courierId = parseInt(courierIdStr, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }
  if (isNaN(courierId)) {
    return NextResponse.json({ error: "courierId inválido" }, { status: 400 });
  }

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  try {
    await prisma.depositoCourierConfig.delete({
      where: {
        depositoId_courierId: { depositoId, courierId },
      },
    });
  } catch (e) {
    // Prisma lanza P2025 si no encuentra la fila
    if (e && typeof e === "object" && "code" in e && e.code === "P2025") {
      return NextResponse.json(
        { error: "Config no encontrada para este depósito y courier" },
        { status: 404 }
      );
    }
    throw e;
  }

  return NextResponse.json({
    ok: true,
    message: "Config eliminada correctamente",
    deleted: { depositoId, courierId },
  });
}
