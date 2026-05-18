// =============================================================================
// ENDPOINTS: GET (lista) + PUT (upsert) para DepositoCourierConfig
// DEUDA 29 Sub-fase 6.D.2 — CRUD para configuración de modalidad operativa
//                          por par (depósito × courier)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";

const prisma = new PrismaClient();

const MODOS_FIRST_MILE_VALIDOS = ["mismo_courier", "consolidador", "drop_off_cliente"];

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

  // Auth + ownership + existencia del depósito.
  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  // Query enriquecida: incluye datos del courier principal + del recolector.
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
      courierRecolector: {
        select: {
          id: true,
          nombre: true,
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
    },
    configs,
  });
}

// =============================================================================
// PUT /api/depositos/[id]/courier-configs
// Upsert de una config para un par (depósito × courier).
// Body: { courierId: number, modoFirstMile: string, courierRecolectorId?: number | null }
// Roles permitidos: ROLES_ESCRITURA (admin_shipro + gerente_cliente).
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

  // Auth + ownership + permiso de escritura.
  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  // Parsear body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body debe ser un objeto JSON" }, { status: 400 });
  }

  const { courierId, modoFirstMile, courierRecolectorId } = body as {
    courierId?: unknown;
    modoFirstMile?: unknown;
    courierRecolectorId?: unknown;
  };

  // Validación 1: courierId requerido y numérico.
  if (typeof courierId !== "number" || !Number.isInteger(courierId)) {
    return NextResponse.json(
      { error: "courierId debe ser un número entero" },
      { status: 400 }
    );
  }

  // Validación 2: modoFirstMile válido.
  if (typeof modoFirstMile !== "string" || !MODOS_FIRST_MILE_VALIDOS.includes(modoFirstMile)) {
    return NextResponse.json(
      {
        error: `modoFirstMile debe ser uno de: ${MODOS_FIRST_MILE_VALIDOS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Validación 3: el courier existe y está activo.
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, activo: true },
  });
  if (!courier) {
    return NextResponse.json(
      { error: "Courier no encontrado o inactivo" },
      { status: 404 }
    );
  }

  // Validación 4: coherencia consolidador <-> courierRecolectorId.
  let recolectorIdNormalizado: number | null = null;

  if (modoFirstMile === "consolidador") {
    // Si modo es consolidador, courierRecolectorId es obligatorio y numérico.
    if (typeof courierRecolectorId !== "number" || !Number.isInteger(courierRecolectorId)) {
      return NextResponse.json(
        {
          error:
            "Con modoFirstMile='consolidador' es obligatorio enviar courierRecolectorId (numérico)",
        },
        { status: 400 }
      );
    }
    recolectorIdNormalizado = courierRecolectorId;

    // Validación 5: el recolector existe y tiene puedeConsolidar=true.
    const recolector = await prisma.courier.findFirst({
      where: { id: recolectorIdNormalizado, activo: true },
    });
    if (!recolector) {
      return NextResponse.json(
        { error: "courierRecolectorId no encontrado o inactivo" },
        { status: 404 }
      );
    }
    if (!recolector.puedeConsolidar) {
      return NextResponse.json(
        {
          error: `El courier '${recolector.nombre}' no puede ser recolector (puedeConsolidar=false)`,
        },
        { status: 400 }
      );
    }

    // Validación 6: "1 solo recolector activo por depósito".
    // Buscar si ya existe OTRA config (no la actual del par depositoId+courierId) con
    // modoFirstMile='consolidador' en el mismo depósito.
    const otroConsolidador = await prisma.depositoCourierConfig.findFirst({
      where: {
        depositoId,
        modoFirstMile: "consolidador",
        NOT: { courierId },
      },
      include: { courier: { select: { nombre: true } } },
    });
    if (otroConsolidador) {
      return NextResponse.json(
        {
          error: `Ya existe otra config con consolidador en este depósito (courier: ${otroConsolidador.courier.nombre}). Solo se permite 1 recolector activo por depósito.`,
        },
        { status: 409 }
      );
    }
  } else {
    // Si modo NO es consolidador, courierRecolectorId debe ser null o no estar presente.
    if (
      courierRecolectorId !== undefined &&
      courierRecolectorId !== null
    ) {
      return NextResponse.json(
        {
          error: `Con modoFirstMile='${modoFirstMile}', courierRecolectorId debe ser null o omitirse`,
        },
        { status: 400 }
      );
    }
  }

  // Upsert: crea o actualiza según el constraint único (depositoId, courierId).
  const config = await prisma.depositoCourierConfig.upsert({
    where: {
      depositoId_courierId: { depositoId, courierId },
    },
    update: {
      modoFirstMile,
      courierRecolectorId: recolectorIdNormalizado,
    },
    create: {
      depositoId,
      courierId,
      modoFirstMile,
      courierRecolectorId: recolectorIdNormalizado,
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

  return NextResponse.json({ config });
}
