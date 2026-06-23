// ============================================================================
// HELPER — VALIDACIONES DE ONBOARDING (DEUDA 17, 2026-06-22)
//
// Centraliza la validacion de inputs del flow de onboarding cliente:
// - CUIT formato 11 digitos.
// - WhatsApp formato internacional estricto (+5491134567890).
// - Generacion de password temporal random seguro.
// ============================================================================

import crypto from "crypto";

/**
 * Valida formato CUIT argentino: 11 digitos.
 * Acepta con o sin guiones (los limpia para validar).
 *
 * @returns CUIT limpio (solo digitos) o null si invalido.
 */
export function validarCUIT(cuit: string): string | null {
  if (!cuit) return null;
  const limpio = cuit.replace(/[-.\s]/g, "");
  if (!/^\d{11}$/.test(limpio)) return null;
  return limpio;
}

/**
 * Valida formato WhatsApp internacional estricto: +5491134567890.
 * Requiere +54 obligatorio. No acepta espacios ni guiones.
 *
 * @returns true si el formato es correcto.
 */
export function validarWhatsApp(telefono: string): boolean {
  if (!telefono) return false;
  return /^\+549\d{10}$/.test(telefono);
}

/**
 * Genera un password temporal random seguro.
 *
 * Estructura: 12 chars, mix de mayusculas + minusculas + numeros.
 * Excluye chars confusos (0/O, 1/l/I) para legibilidad en mail.
 *
 * Ejemplo: "k7TmQrPx9Wnj"
 */
export function generarPasswordTemporal(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}
