// =============================================================================
// ENDPOINTS: GET (lista) + PUT (upsert) para DepositoCourierConfig
// DEUDA 29 Sub-fase 6.D RECTIFICADA (2026-05-19) — Modelo simplificado.
// =============================================================================
//
// Cambios respecto a 6.D.2 original (commit 452d2e0):
// - Eliminado modoFirstMile (era atributo, ahora es deducido por el sistema)
// - Eliminado courierRecolectorId (era atributo, ahora vive en Deposito)
// - Agregados dropOffCliente y recogeViaConsolidador (los únicos campos que
//   el cliente decide por par)
// - Validaciones reducidas de 6 a 3
// - Cleanup: import prisma desde @/lib/prisma (patrón canónico)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { procesarEnviosBloqueadosPorOperatividad } from "@/lib/envios/procesar-bloqueados-operatividad";

// =============================================================================
// GET /api/depositos/[id]/courier-configs
// Lista todas las configs de un depósito con datos enriquecidos del courier.
// Roles permitidos: ROLES_LECTURA (los 4 roles).
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const depositoId = parseInt(id, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }

  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  const configs = await prisma.depositoCourierConfig.findMany({
    where: { depositoId },
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
    orderBy: { courierId: "asc" },
  });

  return NextResponse.json({
    deposito: {
      id: acceso.deposito.id,
      nombre: acceso.deposito.nombre,
      codigoPostal: acceso.deposito.codigoPostal,
      courierRecolectorId: acceso.deposito.courierRecolectorId,
    },
    configs,
  });
}

// =============================================================================
// PUT /api/depositos/[id]/courier-configs
// Upsert de una config para un par (depósito × courier).
// Body: { courierId: number, dropOffCliente?: boolean, recogeViaConsolidador?: boolean }
// Roles permitidos: ROLES_ESCRITURA (admin_shipro + gerente_cliente).
//
// 3 VALIDACIONES DE NEGOCIO (rectificadas desde 6.D.2 original):
//
// V1. Courier existe y está activo.
// V2. dropOffCliente y recogeViaConsolidador (cuando presentes) son boolean
//     Y no pueden estar ambos en true (exclusión mutua).
// V3. Si recogeViaConsolidador=true: el depósito debe tener Deposito.courierRecolectorId
//     seteado Y el courierId del par no puede ser igual al courierRecolectorId
//     (un courier no se recoge a sí mismo).
// =============================================================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const depositoId = parseInt(id, 10);
  if (isNaN(depositoId)) {
    return NextResponse.json({ error: "depositoId inválido" }, { status: 400 });
  }

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body debe ser un objeto JSON" }, { status: 400 });
  }

  const { courierId, dropOffCliente, recogeViaConsolidador } = body as {
    courierId?: unknown;
    dropOffCliente?: unknown;
    recogeViaConsolidador?: unknown;
  };

  // V1.a: courierId obligatorio y numérico
  if (typeof courierId !== "number" || !Number.isInteger(courierId)) {
    return NextResponse.json(
      { error: "courierId debe ser un número entero" },
      { status: 400 }
    );
  }

  // V1.b: courier existe y activo
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, activo: true },
  });
  if (!courier) {
    return NextResponse.json(
      { error: "Courier no encontrado o inactivo" },
      { status: 404 }
    );
  }

  // Normalizar flags (default false, validar boolean si presentes)
  let dropOffNormalizado = false;
  let recogeNormalizado = false;

  if (dropOffCliente !== undefined) {
    if (typeof dropOffCliente !== "boolean") {
      return NextResponse.json(
        { error: "dropOffCliente debe ser boolean" },
        { status: 400 }
      );
    }
    dropOffNormalizado = dropOffCliente;
  }

  if (recogeViaConsolidador !== undefined) {
    if (typeof recogeViaConsolidador !== "boolean") {
      return NextResponse.json(
        { error: "recogeViaConsolidador debe ser boolean" },
        { status: 400 }
      );
    }
    recogeNormalizado = recogeViaConsolidador;
  }

  // V2: exclusión mutua
  if (dropOffNormalizado && recogeNormalizado) {
    return NextResponse.json(
      {
        error:
          "dropOffCliente y recogeViaConsolidador no pueden ser ambos true (un courier no puede recolectar vía consolidador y recibir drop-off al mismo tiempo)",
      },
      { status: 400 }
    );
  }

  // V3: si recogeViaConsolidador=true, validar setup del depósito
  if (recogeNormalizado) {
    if (acceso.deposito.courierRecolectorId === null) {
      return NextResponse.json(
        {
          error:
            "Este depósito no tiene un courier recolector asignado. Configurar Deposito.courierRecolectorId primero antes de marcar recogeViaConsolidador=true",
        },
        { status: 400 }
      );
    }
    if (acceso.deposito.courierRecolectorId === courierId) {
      return NextResponse.json(
        {
          error: `El courier '${courier.nombre}' es el courier recolector del depósito. No puede recolectar vía consolidador (sería recolectarse a sí mismo)`,
        },
        { status: 400 }
      );
    }
  }

  // Upsert
  const config = await prisma.depositoCourierConfig.upsert({
    where: {
      depositoId_courierId: { depositoId, courierId },
    },
    update: {
      dropOffCliente: dropOffNormalizado,
      recogeViaConsolidador: recogeNormalizado,
    },
    create: {
      depositoId,
      courierId,
      dropOffCliente: dropOffNormalizado,
      recogeViaConsolidador: recogeNormalizado,
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

  // === DEUDA 34: destrabe automatico post-configuracion del par ===
  // Configurar el par (deposito x courier) puede volverlo operativo.
  // Reprocesa los envios de ESTE par que estaban en BLOQUEADO_OPERATIVIDAD.
  // Falla contenida: si el reproceso lanza, no se rompe el guardado del par.
  let recovery;
  try {
    recovery = await procesarEnviosBloqueadosPorOperatividad(depositoId, courierId);
  } catch (recErr) {
    console.error("[courier-configs PUT] procesarEnviosBloqueadosPorOperatividad fallo:", recErr);
  }

  return NextResponse.json({
    config,
    ...(recovery ? { recovery } : {}),
  });
}
