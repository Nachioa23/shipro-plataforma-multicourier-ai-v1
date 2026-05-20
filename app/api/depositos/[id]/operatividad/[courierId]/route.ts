// =============================================================================
// ENDPOINT: GET /api/depositos/[id]/operatividad/[courierId]
// DEUDA 29 Sub-fase 6.D.4 (2026-05-20)
// =============================================================================
//
// Valida si un par (depósito × courier) está en condiciones operativas para
// despachar. Devuelve operativo: true/false con motivos detallados si está
// bloqueado.
//
// EL CALLER (frontend) USA ESTE ENDPOINT PARA:
//   - Mostrar al cliente si un courier está disponible para un depósito
//   - Pre-validar antes de habilitar el courier en Mis Transportes
//   - Mostrar motivos de bloqueo concretos cuando no opera
//
// ROLES PERMITIDOS: ROLES_LECTURA (los 4 roles).
//
// COMPORTAMIENTO HTTP:
//   - 404: courier o depósito NO existen (verificarAccesoDeposito o lookup)
//   - 200: courier y depósito existen — response.operativo indica si opera
//          Si false, response.motivos[] detalla los bloqueos.
//
// NOTA: si el courier existe pero está inactivo, devuelve 200 con
// motivos: ["courier_inactivo"]. NO devuelve 404 (eso sería esconder
// información útil al cliente).
//
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { validarOperatividadPar } from "@/lib/depositos/operatividad";

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

  // Auth (404 si depósito no existe o no pertenece a la empresa del user)
  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  // Lookup courier SIN filtro de activo (queremos detectar courier_inactivo
  // como motivo de bloqueo, no como 404)
  const courier = await prisma.courier.findUnique({
    where: { id: courierId },
  });
  if (!courier) {
    return NextResponse.json(
      { error: "Courier no encontrado" },
      { status: 404 }
    );
  }

  // Validar operatividad del par
  const resultado = await validarOperatividadPar({
    prisma,
    deposito: acceso.deposito,
    courier,
  });

  // Response enriquecido (spread del resultado directo en top-level)
  return NextResponse.json({
    par: {
      depositoId: acceso.deposito.id,
      courierId: courier.id,
      courierNombre: courier.nombre,
    },
    ...resultado,
  });
}
