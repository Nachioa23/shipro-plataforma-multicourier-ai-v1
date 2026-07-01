// ============================================================================
// HELPER — SUSPENSION AUTOMATICA DE CUENTAS (DEUDA 22, 2026-06-18)
//
// Logica de evaluacion, suspension y reactivacion automatica de empresas
// segun saldoActivo + limiteDescubierto.
//
// DISEÑO DE 2 NIVELES (decision director DEUDA-22-D11):
//
// NIVEL 1 — Bloqueo blando (BLOQUEADO_SUSPENDIDO):
//   Trigger: saldoActivo + limiteDescubierto < monto del envio
//   Comportamiento: envio creado en limbo (no llama courier, no manda mail).
//   Se destraba automaticamente cuando llega un pago.
//   YA EXISTE en lib/envios/crear.ts via BLOQUEADO_SALDO (DEUDA 16).
//
// NIVEL 2 — Bloqueo duro (Empresa.suspendida = true):
//   Trigger: saldoActivo <= -(limiteDescubierto * MULTIPLICADOR_SUSPENSION)
//   Comportamiento: nuevas creaciones de envios devuelven HTTP 400 con
//   code CUENTA_SUSPENDIDA. Notifica admin_shipro por mail.
//
// REACTIVACION AUTOMATICA:
//   Cuando: saldoActivo >= -(limiteDescubierto * MULTIPLICADOR_REACTIVACION)
//   Despues de pago en /api/admin/finanzas POST.
//   Trigger en lib/envios/procesar-bloqueados.ts.
//
// AUDIT LOG: DEUDA 19 helper integrado (sensible: false, motivo autogenerado).
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarCambioConfiguracion } from "@/lib/auditoria-configuracion";
import { enviarMailEmpresaSuspendida } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";

// Constantes de umbrales — tunear segun apetito de riesgo financiero.
export const MULTIPLICADOR_SUSPENSION = 1.5;
export const MULTIPLICADOR_REACTIVACION = 0.5;

/**
 * Evalua si una empresa debe suspenderse o reactivarse segun su saldo actual.
 *
 * @param saldoActivo - saldo actual de la empresa (post-debit o post-credit)
 * @param limiteDescubierto - limite de credito autorizado
 * @param suspendidaActual - estado actual del flag suspendida
 * @returns { debeSuspender, debeReactivar } - acciones a tomar
 */
export function evaluarSuspension(
  saldoActivo: Prisma.Decimal,
  limiteDescubierto: Prisma.Decimal,
  suspendidaActual: boolean
): { debeSuspender: boolean; debeReactivar: boolean } {
  const umbralSuspension = limiteDescubierto.mul(MULTIPLICADOR_SUSPENSION).neg();
  const umbralReactivacion = limiteDescubierto.mul(MULTIPLICADOR_REACTIVACION).neg();

  const debeSuspender = !suspendidaActual && saldoActivo.lte(umbralSuspension);
  const debeReactivar = suspendidaActual && saldoActivo.gte(umbralReactivacion);

  return { debeSuspender, debeReactivar };
}

/**
 * Suspende una empresa: marca suspendida=true + fechaSuspension + audit log.
 *
 * @param empresaId - ID de la empresa a suspender
 * @param request - Request (para extraer headers de audit log)
 * @param saldoActual - saldo en el momento del trigger (para motivo audit)
 * @param limiteDescubierto - limite vigente (para motivo audit)
 */
export async function suspenderEmpresa(
  empresaId: number,
  request: Request | null,
  saldoActual: Prisma.Decimal,
  limiteDescubierto: Prisma.Decimal
): Promise<void> {
  // 1. Update Empresa.
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      suspendida: true,
      fechaSuspension: new Date(),
    },
  });

  // 2. Audit log (DEUDA 19) — motivo autogenerado describiendo el trigger.
  const motivo = `AUTO: saldo ${saldoActual.toFixed(2)} cruzo umbral de suspension ` +
    `-(limiteDescubierto ${limiteDescubierto.toFixed(2)} * ${MULTIPLICADOR_SUSPENSION})`;

  if (request) {
    // Context: API request — usar helper que captura headers (email, rol, IP).
    await registrarCambioConfiguracion({
      request,
      empresaId,
      campo: "suspendida",
      valorAnterior: false,
      valorNuevo: true,
      motivo,
    });
  } else {
    // Context: interno/cron/post-debit — audit log directo con rol "system".
    // No tenemos Request, asi que usuarioEmail=null, ipOrigen=null.
    await prisma.auditoriaConfiguracion.create({
      data: {
        empresaId,
        campo: "suspendida",
        valorAnterior: "false",
        valorNuevo: "true",
        motivo,
        usuarioEmail: null,
        rolUsuario: "system",
        ipOrigen: null,
      },
    });
  }

  console.log(`[DEUDA 22] Empresa ${empresaId} SUSPENDIDA. ${motivo}`);

  // 3. DEUDA-22-D13 + D14 + D16: notificar admin_shipro por mail (best-effort).
  // Solo al suspender (no al reactivar). Try/catch: si mail falla, no rompe la suspension.
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true },
    });
    if (!empresa) return;

    const admins = await prisma.usuario.findMany({
      where: { rol: "admin_shipro" },
      select: { email: true, nombre: true },
    });

    const baseUrl = getAppUrl();
    if (!baseUrl) {
      console.warn("[DEUDA 22] APP_URL no configurada — skip mail admin notification");
      return;
    }

    for (const admin of admins) {
      try {
        await enviarMailEmpresaSuspendida(
          admin.email,
          admin.nombre,
          empresa.nombre,
          saldoActual,
          limiteDescubierto,
          baseUrl
        );
        console.log(`[DEUDA 22] Mail suspension enviado a ${admin.email}`);
      } catch (mailErr) {
        console.error(`[DEUDA 22] Mail a ${admin.email} fallo:`, mailErr);
      }
    }
  } catch (notifyErr) {
    console.error("[DEUDA 22] Notificacion admins fallo (suspension OK igual):", notifyErr);
  }
}

/**
 * Reactiva una empresa: marca suspendida=false + fechaReactivacion + audit log.
 *
 * @param empresaId - ID de la empresa a reactivar
 * @param request - Request (para extraer headers de audit log)
 * @param saldoActual - saldo en el momento del trigger (para motivo audit)
 * @param limiteDescubierto - limite vigente (para motivo audit)
 */
export async function reactivarEmpresa(
  empresaId: number,
  request: Request | null,
  saldoActual: Prisma.Decimal,
  limiteDescubierto: Prisma.Decimal
): Promise<void> {
  // 1. Update Empresa.
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      suspendida: false,
      fechaReactivacion: new Date(),
    },
  });

  // 2. Audit log (DEUDA 19) — motivo autogenerado describiendo el trigger.
  const motivo = `AUTO: saldo ${saldoActual.toFixed(2)} cruzo umbral de reactivacion ` +
    `-(limiteDescubierto ${limiteDescubierto.toFixed(2)} * ${MULTIPLICADOR_REACTIVACION})`;

  if (request) {
    await registrarCambioConfiguracion({
      request,
      empresaId,
      campo: "suspendida",
      valorAnterior: true,
      valorNuevo: false,
      motivo,
    });
  } else {
    await prisma.auditoriaConfiguracion.create({
      data: {
        empresaId,
        campo: "suspendida",
        valorAnterior: "true",
        valorNuevo: "false",
        motivo,
        usuarioEmail: null,
        rolUsuario: "system",
        ipOrigen: null,
      },
    });
  }

  console.log(`[DEUDA 22] Empresa ${empresaId} REACTIVADA. ${motivo}`);
}
