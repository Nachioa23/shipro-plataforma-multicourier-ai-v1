// ============================================================================
// HELPER — MATRIZ DE PERMISOS GRANULAR (DEUDA 21, 2026-06-18)
//
// Single source of truth para validacion de permisos per-rol per-campo.
//
// Usado tanto en BACKEND (route handlers, defense-in-depth) como en
// FRONTEND (UI gating, hide/disable controls).
//
// PRINCIPIO: defense-in-depth — el backend NUNCA confia en el frontend.
// Cualquier mutacion debe pasar por puedeEditarCampo(rol, campo) antes
// de aplicarse al store de Prisma.
//
// REGLAS GENERALES (cliente-side):
// - admin_shipro    — puede todo (super admin).
// - operador_shipro — solo activo (audit/soporte para destrabar).
// - gerente_cliente — todo lo de su empresa EXCEPTO config financiera Shipro
//                     (tipoCuenta) ni credenciales del Modelo A (Shipro).
// - operador_cliente — NO puede tocar configuracion (rol operativo).
//
// CASOS ESPECIALES:
// - credencialesJsonPropias (Modelo B): credenciales del cliente, edita cliente.
// - credencialesJsonShipro (Modelo A): credenciales de Shipro, solo admin_shipro.
// - tipoCuenta: decision financiera Shipro (PREPAGO vs POSTPAGO), solo admin_shipro.
// ============================================================================

export type CampoPermiso =
  | "activo"
  | "usaCredencialesPropias"
  | "credencialesJsonPropias"
  | "credencialesJsonShipro"
  | "ajusteTarifaPorcentaje"
  | "markupFijo"
  | "requiereSeguro"
  | "tipoCuenta"
  | "serviciosActivos";

/**
 * Matriz de permisos: campo -> lista de roles que pueden editarlo.
 *
 * IMPORTANTE: si agregas un nuevo campo sensible al schema, agregalo aqui
 * y en CAMPOS_AUDITABLES (lib/auditoria-configuracion.ts). El backend
 * debe siempre llamar puedeEditarCampo() antes de aplicar update.
 */
const MATRIZ_PERMISOS: Record<CampoPermiso, string[]> = {
  // CredencialCourier — config de courier per-empresa
  activo: ["admin_shipro", "gerente_cliente", "operador_shipro"],
  usaCredencialesPropias: ["admin_shipro", "gerente_cliente"],
  credencialesJsonPropias: ["admin_shipro", "gerente_cliente"],
  credencialesJsonShipro: ["admin_shipro"],
  ajusteTarifaPorcentaje: ["admin_shipro", "gerente_cliente"],
  markupFijo: ["admin_shipro", "gerente_cliente"],
  requiereSeguro: ["admin_shipro", "gerente_cliente"],
  tipoCuenta: ["admin_shipro"],
  serviciosActivos: ["admin_shipro", "gerente_cliente"],
};

/**
 * Verifica si un rol puede editar un campo especifico.
 *
 * @param rol - rol del usuario (admin_shipro, gerente_cliente, etc).
 *              Acepta cualquier string; si el rol no esta en la matriz,
 *              retorna false (deny by default).
 * @param campo - campo a editar (debe estar en CampoPermiso).
 * @returns true si el rol puede editar el campo, false en caso contrario.
 *
 * @example
 *   puedeEditarCampo("gerente_cliente", "tipoCuenta")  // false
 *   puedeEditarCampo("admin_shipro", "tipoCuenta")     // true
 *   puedeEditarCampo("operador_cliente", "markupFijo") // false
 */
export function puedeEditarCampo(rol: string, campo: CampoPermiso): boolean {
  const rolesPermitidos = MATRIZ_PERMISOS[campo];
  if (!rolesPermitidos) {
    // Campo no esta en la matriz (typo o nuevo sin registrar).
    // Deny by default para evitar bypass accidental.
    return false;
  }
  return rolesPermitidos.includes(rol);
}

/**
 * Helper: dado un courier item del body POST, decide si las credenciales
 * son "Modelo A" (Shipro) o "Modelo B" (propias del cliente).
 * Usado para gating en backend antes de mutar credencialesJson.
 *
 * Logica: si usaCredencialesPropias es true -> Modelo B (cliente).
 *         si es false -> Modelo A (Shipro).
 */
export function esModeloBCredenciales(usaCredencialesPropias: boolean): boolean {
  return usaCredencialesPropias === true;
}
