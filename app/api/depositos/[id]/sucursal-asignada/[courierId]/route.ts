// =============================================================================
// ENDPOINT: GET /api/depositos/[id]/sucursal-asignada/[courierId]
// DEUDA 29 Sub-fase 6.D.3 (2026-05-20)
// =============================================================================
//
// Auto-asigna la sucursal del courier para operar desde un depósito específico.
// Centraliza la lógica de "qué sucursal usar" para un par (depósito × courier)
// según:
//   - La modalidad del courier (por_cp_origen / sucursal_unica / etc.)
//   - El estado de DepositoCourierConfig del par (dropOffCliente,
//     recogeViaConsolidador)
//   - El consolidador del depósito (Deposito.courierRecolectorId)
//
// EL CALLER (frontend o cron) USA ESTE ENDPOINT PARA:
//   - Mostrar al cliente qué sucursal va a operar antes de despachar
//   - Pre-poblar la sucursal en el flow de creación de envío
//   - Validar configuración del par antes de habilitar el courier
//
// ROLES PERMITIDOS: ROLES_LECTURA (los 4 roles).
//
// LÓGICA:
//   1. Validar params (depositoId, courierId enteros).
//   2. verificarAccesoDeposito (read).
//   3. Buscar courier (debe existir y estar activo).
//   4. Buscar DepositoCourierConfig del par (puede no existir → defaults).
//   5. Calcular cpOrigenEfectivo:
//      - Si config.recogeViaConsolidador && deposito.courierRecolectorId:
//          → buscar Courier(recolector) → cpOrigenEfectivo = recolector.cpDepositoConsolidador
//      - Sino: cpOrigenEfectivo = deposito.codigoPostal
//   6. Llamar asignarSucursalParaDeposito(...) con todos los inputs.
//   7. Devolver el ResultadoAutoAsignacion directo.
//
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { asignarSucursalParaDeposito } from "@/lib/sucursales/cercanas";

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

  // Fase K (DEUDA 32+37): include servicios.entrega_sucursal para que el helper
  // tieneSucursales pueda derivar abajo en asignarSucursalParaDeposito.
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, activo: true },
    include: {
      servicios: {
        where: { codigoServicio: "entrega_sucursal" },
        select: { codigoServicio: true, capacidadTecnicaMapeada: true },
      },
    },
  });
  if (!courier) {
    return NextResponse.json(
      { error: "Courier no encontrado o inactivo" },
      { status: 404 }
    );
  }

  // Buscar config del par (puede no existir — usar defaults neutros)
  const config = await prisma.depositoCourierConfig.findUnique({
    where: { depositoId_courierId: { depositoId, courierId } },
  });
  const dropOffCliente = config?.dropOffCliente ?? false;
  const recogeViaConsolidador = config?.recogeViaConsolidador ?? false;

  // Calcular cpOrigenEfectivo (con cascada al consolidador si corresponde)
  let cpOrigenEfectivo: string = acceso.deposito.codigoPostal;

  if (recogeViaConsolidador && acceso.deposito.courierRecolectorId !== null) {
    const recolector = await prisma.courier.findUnique({
      where: { id: acceso.deposito.courierRecolectorId },
    });
    if (!recolector || !recolector.cpDepositoConsolidador) {
      // Estado inconsistente: recogeViaConsolidador=true pero el recolector no tiene CP.
      // No debería pasar si el PUT del depósito valida correctamente.
      return NextResponse.json(
        {
          error:
            "Estado inconsistente: recogeViaConsolidador=true pero el courier recolector del depósito no tiene cpDepositoConsolidador configurado",
        },
        { status: 500 }
      );
    }
    cpOrigenEfectivo = recolector.cpDepositoConsolidador;
  }

  const resultado = await asignarSucursalParaDeposito({
    prisma,
    courier,
    cpOrigenEfectivo,
    latitudOrigen: acceso.deposito.latitud,
    longitudOrigen: acceso.deposito.longitud,
    dropOffCliente,
  });

  return NextResponse.json({
    courier: {
      id: courier.id,
      nombre: courier.nombre,
    },
    deposito: {
      id: acceso.deposito.id,
      codigoPostal: acceso.deposito.codigoPostal,
      courierRecolectorId: acceso.deposito.courierRecolectorId,
    },
    config: {
      dropOffCliente,
      recogeViaConsolidador,
    },
    cpOrigenEfectivo,
    resultado,
  });
}
