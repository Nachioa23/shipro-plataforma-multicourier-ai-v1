// =============================================================================
// ENDPOINT: PUT /api/depositos/[id]/recolector
// DEUDA 36.E Fase 4c/d STEP 3 (2026-07-11)
// =============================================================================
//
// Setter DEDICADO del recolector de un deposito, PENSADO EXCLUSIVAMENTE PARA EL
// WIZARD DE ONBOARDING. En ese momento el deposito es recien creado y no tiene
// ningun DepositoCourierConfig — no hay cascada que resetear, no hay elegibles
// que activar, no hay validacion cruzada de configs de otros couriers.
//
// GUARD RAIL: si el deposito YA tiene DepositoCourierConfig (>=1 fila), el
// endpoint rechaza con 400 DEPOSITO_NO_VACIO. Esto garantiza que el atajo
// no-cascade solo se aplique en depositos frescos; el path completo con cascada
// (reset de configs, calculo de elegibles, upserts atomicos) sigue viviendo en
// PUT /api/depositos/[id].
//
// VALIDACIONES (mismas que el PUT completo, minus la cascade):
//   - courierRecolectorId en body: null o entero positivo.
//   - Si es numero:
//       * el courier debe existir y estar activo.
//       * el courier debe tener puedeConsolidar=true (un recolector debe consolidar).
//       * el courier debe tener cpDepositoConsolidador configurado.
//       * el courier debe cubrir el CP del deposito en SucursalCourierCp
//         (verificacion "cubreCpDeposito" — snippet copiado literal del PUT
//         completo para mantener las mismas reglas de cobertura).
//   - Si no hay filas de SucursalCourierCp para ese courier, se skip la
//     validacion de cobertura (best-effort, mismo criterio que el PUT completo).
//
// ROLES PERMITIDOS: ROLES_ESCRITURA (via verificarAccesoDeposito con requireWrite=true).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const depositoId = parseInt(id, 10);
    if (isNaN(depositoId)) {
      return NextResponse.json({ error: "depositoId invalido" }, { status: 400 });
    }

    const acceso = await verificarAccesoDeposito(request, depositoId, true);
    if (!acceso.ok) return acceso.response;
    const deposito = acceso.deposito;

    const body = await request.json().catch(() => ({}));
    const raw = (body as { courierRecolectorId?: unknown }).courierRecolectorId;

    // courierRecolectorId debe ser null o entero positivo.
    let courierRecolectorIdNuevo: number | null;
    if (raw === null) {
      courierRecolectorIdNuevo = null;
    } else if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
      courierRecolectorIdNuevo = raw;
    } else {
      return NextResponse.json(
        { error: "courierRecolectorId debe ser null o un entero positivo" },
        { status: 400 }
      );
    }

    // GUARD RAIL: solo permitir este atajo si el deposito no tiene configs.
    // Si tiene, el flujo correcto es PUT /api/depositos/[id] (que hace la
    // cascada). Se responde 400 DEPOSITO_NO_VACIO para que el caller sepa
    // por que se rechazo y como resolverlo.
    const configsCount = await prisma.depositoCourierConfig.count({
      where: { depositoId },
    });
    if (configsCount > 0) {
      return NextResponse.json(
        {
          error:
            "Este depósito ya tiene couriers configurados. Usá la edición de depósito para cambiar el recolector.",
          code: "DEPOSITO_NO_VACIO",
        },
        { status: 400 }
      );
    }

    // Si el body pide asignar un recolector: validar el courier
    // (mismo criterio que el PUT completo, snippet L125-177).
    if (courierRecolectorIdNuevo !== null) {
      const courierConsolidador = await prisma.courier.findFirst({
        where: { id: courierRecolectorIdNuevo, activo: true },
      });
      if (!courierConsolidador) {
        return NextResponse.json(
          { error: "Courier recolector no encontrado o inactivo" },
          { status: 404 }
        );
      }
      if (!courierConsolidador.puedeConsolidar) {
        return NextResponse.json(
          {
            error: `El courier '${courierConsolidador.nombre}' no tiene capacidad de consolidación (puedeConsolidar=false)`,
          },
          { status: 400 }
        );
      }
      if (!courierConsolidador.cpDepositoConsolidador) {
        return NextResponse.json(
          {
            error: `El courier '${courierConsolidador.nombre}' no tiene cpDepositoConsolidador configurado, no puede ser asignado como recolector`,
          },
          { status: 400 }
        );
      }

      // Validacion de cobertura del CP del deposito por el consolidador (best-effort,
      // mismo snippet que el PUT completo).
      const consolidadorTieneCobertura = await prisma.sucursalCourierCp.findFirst({
        where: {
          sucursal: {
            courierId: courierRecolectorIdNuevo,
            activa: true,
            eliminada: false,
          },
        },
        select: { id: true },
      });
      if (consolidadorTieneCobertura) {
        const cubreCpDeposito = await prisma.sucursalCourierCp.findFirst({
          where: {
            codigoPostal: deposito.codigoPostal,
            sucursal: {
              courierId: courierRecolectorIdNuevo,
              activa: true,
              eliminada: false,
            },
          },
          select: { id: true },
        });
        if (!cubreCpDeposito) {
          return NextResponse.json(
            {
              error: `El courier '${courierConsolidador.nombre}' no cubre el CP del depósito (${deposito.codigoPostal}). No puede ser asignado como recolector.`,
              code: "RECOLECTOR_SIN_COBERTURA",
            },
            { status: 400 }
          );
        }
      }
      // Si no hay cobertura en SucursalCourierCp: skip (best-effort, DEUDA 32 post-MVP).
    }

    const actualizado = await prisma.deposito.update({
      where: { id: depositoId },
      data: { courierRecolectorId: courierRecolectorIdNuevo },
    });

    return NextResponse.json({
      deposito: {
        id: actualizado.id,
        courierRecolectorId: actualizado.courierRecolectorId,
      },
    });
  } catch (error) {
    console.error("[depositos/recolector PUT] Error interno:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
