// ============================================================================
// HELPER — AUDITORIA DE CONFIGURACION (DEUDA 19)
//
// Centraliza el registro de cambios sensibles en credenciales y configuracion
// financiera. Llamar desde route handlers que mutan CredencialCourier o
// campos sensibles de Empresa.
//
// 12 campos auditados (CRITICOS + ALTOS — decision director D-19-2):
//
// CRITICOS (motivo obligatorio, throw error si falta):
//   - credencialesJson    (CredencialCourier) — credenciales del courier
//   - tipoCuenta          (CredencialCourier) — PREPAGO/POSTPAGO per courier
//   - usaCredencialesPropias (CredencialCourier) — Modelo A vs B
//   - activo              (CredencialCourier) — solo cuando va a false
//   - modalidadPago       (Empresa) — PREPAGO/POSTPAGO empresa-wide
//   - limiteDescubierto   (Empresa) — riesgo financiero
//   - apiKey              (Empresa) — rotacion
//   - modeloAHabilitado   (Empresa) — DEUDA 29 inmutable direccional
//
// ALTOS (motivo opcional):
//   - apiKeyActiva        (Empresa) — toggle activacion
//   - ajusteTarifaPorcentaje (CredencialCourier) — pricing
//   - markupFijo          (CredencialCourier) — pricing
//   - requiereSeguro      (CredencialCourier) — servicio
//
// Headers extraidos via proxy.ts (Sub-paso 19.c):
//   - x-usuario-email     → usuarioEmail
//   - x-rol               → rolUsuario
//   - x-ip-origen         → ipOrigen (con fallback a x-forwarded-for / x-real-ip)
//
// Skip silencioso si valorAnterior === valorNuevo (no-op, no se registra).
//
// USO TIPICO en un route handler:
//
//   await registrarCambioConfiguracion({
//     request,
//     empresaId,
//     courierId: courier.id,    // opcional
//     campo: "tipoCuenta",
//     valorAnterior: credAntes.tipoCuenta,
//     valorNuevo: nuevoTipoCuenta,
//     motivo: body.motivoAuditoria,  // del UI modal
//   });
// ============================================================================

import prisma from "@/lib/prisma";

// Lista canonica de campos auditados — single source of truth.
export const CAMPOS_AUDITABLES = {
  // CRITICOS — motivo obligatorio
  credencialesJson: { sensible: true, modelo: "CredencialCourier" },
  tipoCuenta: { sensible: true, modelo: "CredencialCourier" },
  usaCredencialesPropias: { sensible: true, modelo: "CredencialCourier" },
  activo: { sensible: true, modelo: "CredencialCourier" }, // solo cuando va a false
  modalidadPago: { sensible: true, modelo: "Empresa" },
  limiteDescubierto: { sensible: true, modelo: "Empresa" },
  apiKey: { sensible: true, modelo: "Empresa" },
  modeloAHabilitado: { sensible: true, modelo: "Empresa" },
  // ALTOS — motivo opcional
  apiKeyActiva: { sensible: false, modelo: "Empresa" },
  ajusteTarifaPorcentaje: { sensible: false, modelo: "CredencialCourier" },
  markupFijo: { sensible: false, modelo: "CredencialCourier" },
  requiereSeguro: { sensible: false, modelo: "CredencialCourier" },
} as const;

export type CampoAuditable = keyof typeof CAMPOS_AUDITABLES;

export class MotivoRequeridoError extends Error {
  constructor(campo: string) {
    super(`Motivo obligatorio para cambio en campo sensible: ${campo}`);
    this.name = "MotivoRequeridoError";
  }
}

export interface RegistrarCambioOpts {
  request: Request;
  empresaId: number;
  courierId?: number | null;
  campo: CampoAuditable;
  valorAnterior: string | number | boolean | null | undefined;
  valorNuevo: string | number | boolean | null | undefined;
  motivo?: string;
}

/**
 * Registra un cambio en AuditoriaConfiguracion.
 *
 * Reglas:
 * 1. Si valorAnterior === valorNuevo (no-op): skip silencioso, return null.
 * 2. Si campo es sensible y motivo es null/empty: throw MotivoRequeridoError.
 * 3. Si campo no es sensible: motivo opcional.
 * 4. Valores se normalizan a String (o null) para storage uniforme.
 * 5. credencialesJson special case: NO se almacena el valor literal (security).
 *    Solo "[REDACTED]" para indicar que hubo cambio.
 */
export async function registrarCambioConfiguracion(
  opts: RegistrarCambioOpts
): Promise<{ id: number } | null> {
  const { request, empresaId, courierId, campo, valorAnterior, valorNuevo, motivo } = opts;

  // 1. No-op check.
  const valAntStr = normalizarValor(campo, valorAnterior);
  const valNuevStr = normalizarValor(campo, valorNuevo);
  if (valAntStr === valNuevStr) {
    return null;
  }

  // 2. Sensitivity check.
  const meta = CAMPOS_AUDITABLES[campo];
  if (meta.sensible && (!motivo || motivo.trim().length === 0)) {
    throw new MotivoRequeridoError(campo);
  }

  // 3. Extract headers.
  const usuarioEmail = request.headers.get("x-usuario-email") || null;
  const rolUsuario = request.headers.get("x-rol") || null;
  const ipOrigen =
    request.headers.get("x-ip-origen") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    null;

  // 4. Insert.
  const audit = await prisma.auditoriaConfiguracion.create({
    data: {
      usuarioEmail,
      rolUsuario,
      ipOrigen,
      empresaId,
      courierId: courierId ?? null,
      campo,
      valorAnterior: valAntStr,
      valorNuevo: valNuevStr,
      motivo: motivo?.trim() || null,
    },
    select: { id: true },
  });

  return audit;
}

/**
 * Normaliza un valor para storage uniforme en BD.
 * Special case: credencialesJson NO se almacena literal por seguridad.
 */
function normalizarValor(
  campo: CampoAuditable,
  valor: string | number | boolean | null | undefined
): string | null {
  if (valor === null || valor === undefined) return null;

  // Security: nunca almacenar credenciales literales en audit log.
  if (campo === "credencialesJson") {
    return valor ? "[REDACTED]" : null;
  }

  // apiKey: solo almacenar ultimos 4 chars (consistente con GET endpoint patron).
  if (campo === "apiKey") {
    const str = String(valor);
    return str.length > 4 ? `***${str.slice(-4)}` : str;
  }

  return String(valor);
}
