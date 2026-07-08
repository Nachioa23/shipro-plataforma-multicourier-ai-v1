// =============================================================================
// ENDPOINT: GET /api/depositos/[id]/couriers-elegibles
// DEUDA 36.E Phase 1 (2026-07-08)
// =============================================================================
//
// Grilla de elegibilidad de couriers para un deposito: enumera TODOS los
// couriers activos + su estado de cobertura contra el CP efectivo del par.
//
// EL CALLER (frontend onboarding wizard / DepositoForm) USA ESTE ENDPOINT PARA:
//   - Mostrar al cliente la grilla de couriers habilitables por el deposito.
//   - Indicar cobertura: activable (por_cp / sucursal_unica) vs bloqueado con
//     motivo (sin_cobertura / sin_sucursales / drop_off_cliente).
//   - Preview dinamico: al hover/pick de un recolector, la grilla se re-evalua
//     con el CP del hub del recolector como origen efectivo por cada courier
//     no-recolector.
//
// QUERY PARAMS:
//   - recolectorProyectadoId (opcional): int. Si presente, se computa el CP
//     efectivo para cada courier ASUMIENDO ese courier como recolector. Si
//     ausente, se usa el courierRecolectorId actual del deposito (o ninguno).
//
// ROLES PERMITIDOS: ROLES_LECTURA (los 4 roles) via verificarAccesoDeposito.
//
// COMPORTAMIENTO HTTP:
//   - 400: depositoId invalido.
//   - 401/403/404: verificarAccesoDeposito (falta auth / rol / empresa ajena).
//   - 200: grilla completa.
//   - 500: error interno.
//
// SIN ESCRITURAS: endpoint puramente de lectura, no crea ni modifica registros.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { asignarSucursalParaDeposito } from "@/lib/sucursales/cercanas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const depositoId = parseInt(id, 10);
    if (isNaN(depositoId)) {
      return NextResponse.json({ error: "depositoId invalido" }, { status: 400 });
    }

    // Query param opcional: recolectorProyectadoId (int; null si ausente/invalido).
    const { searchParams } = new URL(request.url);
    const recolectorProyectadoRaw = searchParams.get("recolectorProyectadoId");
    let recolectorProyectadoId: number | null = null;
    if (recolectorProyectadoRaw) {
      const parsed = parseInt(recolectorProyectadoRaw, 10);
      recolectorProyectadoId = isNaN(parsed) ? null : parsed;
    }

    // Auth: 404 si el deposito no existe o pertenece a otra empresa (defense-in-depth).
    const acceso = await verificarAccesoDeposito(request, depositoId, false);
    if (!acceso.ok) return acceso.response;

    const deposito = acceso.deposito;

    // Carga en paralelo:
    //   - todos los couriers activos, con la relacion servicios cargada (mismo
    //     patron que operatividad/[courierId]: solo entrega_sucursal, suficiente
    //     para que asignarSucursalParaDeposito derive la modalidad).
    //   - las credenciales de la empresa (per (empresaId, nombreCourier)).
    //   - las configs del deposito (per (depositoId, courierId)).
    const [couriers, credenciales, configs] = await Promise.all([
      prisma.courier.findMany({
        where: { activo: true },
        include: {
          servicios: {
            where: { codigoServicio: "entrega_sucursal" },
          },
        },
      }),
      prisma.credencialCourier.findMany({
        where: { empresaId: deposito.empresaId },
      }),
      prisma.depositoCourierConfig.findMany({
        where: { depositoId },
      }),
    ]);

    // Resolver recolector proyectado (query param) o actual (state del deposito).
    // Se busca dentro de la lista ya cargada — sin query extra.
    const recolectorIdAResolver =
      recolectorProyectadoId ?? deposito.courierRecolectorId;
    const recolectorResuelto = recolectorIdAResolver
      ? couriers.find((c) => c.id === recolectorIdAResolver) ?? null
      : null;

    // Lookup maps.
    const credencialesPorNombre = new Map(
      credenciales.map((c) => [c.nombreCourier, c])
    );
    const configsPorCourier = new Map(configs.map((c) => [c.courierId, c]));

    // Per-courier: compute cpOrigenEfectivo + cobertura.
    // asignarSucursalParaDeposito hace su propio lookup en SucursalCourierCp,
    // asi que las llamadas van en paralelo (2 couriers hoy — no es cuello).
    const couriersResult = await Promise.all(
      couriers.map(async (courier) => {
        const config = configsPorCourier.get(courier.id);
        const credencial = credencialesPorNombre.get(courier.nombre);

        // cpOrigenEfectivo: recolector hub CP si (a) hay recolector resuelto,
        // (b) el courier NO es el recolector, y (c) el recolector tiene hub CP.
        // Sino, CP del deposito.
        let cpOrigenEfectivo: string = deposito.codigoPostal;
        if (
          recolectorResuelto &&
          courier.id !== recolectorResuelto.id &&
          recolectorResuelto.cpDepositoConsolidador
        ) {
          cpOrigenEfectivo = recolectorResuelto.cpDepositoConsolidador;
        }

        const dropOffCliente = config?.dropOffCliente ?? false;

        const cobertura = await asignarSucursalParaDeposito({
          prisma,
          courier,
          cpOrigenEfectivo,
          latitudOrigen: deposito.latitud,
          longitudOrigen: deposito.longitud,
          dropOffCliente,
        });

        return {
          courierId: courier.id,
          nombre: courier.nombre,
          activo: courier.activo,
          puedeConsolidar: courier.puedeConsolidar,
          cpDepositoConsolidador: courier.cpDepositoConsolidador,
          tieneCredencial: !!credencial,
          credencialActiva: credencial?.activo === true,
          tieneConfig: !!config,
          dropOffCliente,
          recogeViaConsolidador: config?.recogeViaConsolidador ?? false,
          cpOrigenEfectivo,
          cobertura,
        };
      })
    );

    return NextResponse.json({
      deposito: {
        id: deposito.id,
        nombre: deposito.nombre,
        codigoPostal: deposito.codigoPostal,
        courierRecolectorId: deposito.courierRecolectorId,
      },
      recolectorProyectadoId: recolectorResuelto?.id ?? null,
      couriers: couriersResult,
    });
  } catch (error) {
    console.error("[couriers-elegibles] Error interno:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
