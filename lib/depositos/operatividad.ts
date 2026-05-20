// =============================================================================
// HELPER: validarOperatividadPar(...)
// DEUDA 29 Sub-fase 6.D.4 (2026-05-20)
// =============================================================================
//
// Valida si un par (depósito × courier) está en condiciones operativas para
// despachar envíos. Detecta motivos de bloqueo PRE-creación de envío:
// problemas estructurales (config inválida) que harían que un envío quede
// inviable después del cobro.
//
// Este helper NO valida estado runtime (ej. JSON de credencial expirado).
// Eso se detecta al despachar (BLOQUEADO_CREDENCIALES). Acá solo validamos
// configuración estática.
//
// =============================================================================
//
// MOTIVOS DE BLOQUEO DETECTADOS (6):
//
//   courier_inactivo:           Courier.activo === false
//   sin_credencial_activa:      No hay CredencialCourier con activo=true
//                               para (empresaId, nombreCourier)
//   sin_sucursal_asignable:     Helper de 6.D.3 devuelve sin_sucursales
//   sin_cobertura:              Helper de 6.D.3 devuelve sin_cobertura
//   consolidador_inconsistente: recogeViaConsolidador=true Y
//                               (no hay recolector asignado OR
//                                recolector sin cpDepositoConsolidador)
//   auto_consolidacion_invalida: courier es el recolector del depósito
//                                Y recogeViaConsolidador=true
//                                (el courier no puede recolectarse a sí mismo)
//
// CASOS NO BLOQUEANTES:
//
//   sin_config_par: DepositoCourierConfig no existe. Los defaults neutros
//                   (dropOff=false, recoge=false) son configuración válida.
//                   El endpoint puede mostrar "config no explícita" en
//                   detalle pero el par opera.
//
// REUSO DE LA LÓGICA DE 6.D.3:
//
// El helper invoca asignarSucursalParaDeposito (lib/sucursales/cercanas.ts)
// internamente para validar que existe sucursal asignable. Este reuso evita
// drift entre los endpoints sucursal-asignada y operatividad. El response
// incluye sucursalInfo cuando se computó (para que el frontend pueda mostrar
// la sucursal sugerida junto con la validación).
//
// =============================================================================

import { Courier, Deposito, PrismaClient } from "@prisma/client";
import {
  asignarSucursalParaDeposito,
  ResultadoAutoAsignacion,
} from "@/lib/sucursales/cercanas";

export type MotivoBloqueoPar =
  | "courier_inactivo"
  | "sin_credencial_activa"
  | "sin_sucursal_asignable"
  | "sin_cobertura"
  | "consolidador_inconsistente"
  | "auto_consolidacion_invalida";

export type ResultadoOperatividad =
  | { operativo: true; sucursalInfo: ResultadoAutoAsignacion }
  | {
      operativo: false;
      motivos: MotivoBloqueoPar[];
      detalle: string[];
      sucursalInfo?: ResultadoAutoAsignacion;
    };

export async function validarOperatividadPar(params: {
  prisma: PrismaClient;
  deposito: Deposito;
  courier: Courier;
}): Promise<ResultadoOperatividad> {
  const { prisma, deposito, courier } = params;

  const motivos: MotivoBloqueoPar[] = [];
  const detalle: string[] = [];

  // Check 1: courier activo
  if (!courier.activo) {
    motivos.push("courier_inactivo");
    detalle.push(`El courier '${courier.nombre}' está inactivo`);
  }

  // Check 2: credencial activa
  const credencial = await prisma.credencialCourier.findFirst({
    where: {
      empresaId: deposito.empresaId,
      nombreCourier: courier.nombre,
      activo: true,
    },
  });
  if (!credencial) {
    motivos.push("sin_credencial_activa");
    detalle.push(
      `No hay credencial activa para '${courier.nombre}' en la empresa del depósito`
    );
  }

  // Lookup de config (puede no existir → defaults neutros)
  const config = await prisma.depositoCourierConfig.findUnique({
    where: {
      depositoId_courierId: {
        depositoId: deposito.id,
        courierId: courier.id,
      },
    },
  });
  const dropOffCliente = config?.dropOffCliente ?? false;
  const recogeViaConsolidador = config?.recogeViaConsolidador ?? false;

  // Calcular cpOrigenEfectivo (con detección de inconsistencias)
  let cpOrigenEfectivo: string = deposito.codigoPostal;
  let sucursalInfo: ResultadoAutoAsignacion | undefined = undefined;

  if (recogeViaConsolidador) {
    // Check 3: auto-consolidación inválida
    if (deposito.courierRecolectorId === courier.id) {
      motivos.push("auto_consolidacion_invalida");
      detalle.push(
        `El courier '${courier.nombre}' es el recolector del depósito y no puede recolectarse a sí mismo`
      );
    } else if (deposito.courierRecolectorId === null) {
      // Check 4: consolidador inconsistente (no asignado)
      motivos.push("consolidador_inconsistente");
      detalle.push(
        "El par tiene recogeViaConsolidador=true pero el depósito no tiene recolector asignado"
      );
    } else {
      // Lookup del recolector
      const recolector = await prisma.courier.findUnique({
        where: { id: deposito.courierRecolectorId },
      });
      if (!recolector || !recolector.cpDepositoConsolidador) {
        // Check 5: consolidador sin CP
        motivos.push("consolidador_inconsistente");
        detalle.push(
          "El courier recolector del depósito no tiene cpDepositoConsolidador configurado"
        );
      } else {
        cpOrigenEfectivo = recolector.cpDepositoConsolidador;
      }
    }
  }

  // Si no hubo inconsistencia de consolidador, computar sucursal asignable
  const hayInconsistenciaConsolidador =
    motivos.includes("consolidador_inconsistente") ||
    motivos.includes("auto_consolidacion_invalida");

  if (!hayInconsistenciaConsolidador && courier.activo) {
    sucursalInfo = await asignarSucursalParaDeposito({
      prisma,
      courier,
      cpOrigenEfectivo,
      latitudOrigen: deposito.latitud,
      longitudOrigen: deposito.longitud,
      dropOffCliente,
    });

    // Check 6 y 7: sin_cobertura / sin_sucursales del helper de 6.D.3
    if (sucursalInfo.tipo === "sin_cobertura") {
      motivos.push("sin_cobertura");
      detalle.push(sucursalInfo.mensaje);
    } else if (sucursalInfo.tipo === "sin_sucursales") {
      motivos.push("sin_sucursal_asignable");
      detalle.push(sucursalInfo.mensaje);
    }
  }

  if (motivos.length === 0) {
    // sucursalInfo necesariamente está definido en este branch
    return { operativo: true, sucursalInfo: sucursalInfo as ResultadoAutoAsignacion };
  }

  return {
    operativo: false,
    motivos,
    detalle,
    ...(sucursalInfo !== undefined && { sucursalInfo }),
  };
}
