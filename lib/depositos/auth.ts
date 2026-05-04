import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Deposito } from "@prisma/client";

export const ROLES_LECTURA = ['admin_shipro', 'operador_shipro', 'gerente_cliente', 'operador_cliente'];
export const ROLES_ESCRITURA = ['admin_shipro', 'gerente_cliente'];

export type ContextoDeposito =
  | { ok: true; empresaId: number; rol: string }
  | { ok: false; response: NextResponse };

/**
 * Resuelve el empresaId efectivo para listados y creación.
 * - Shipro: lo toma del query (?empresaId=X) o body.empresaId.
 * - Cliente: lo toma del header inyectado por proxy (su sesión).
 *   Body o query con empresaId distinto se ignoran (defense-in-depth).
 */
export function resolverEmpresaIdParaCrear(
  request: Request,
  bodyEmpresaId?: number | string
): ContextoDeposito {
  const empresaIdHeader = request.headers.get("x-empresa-id");
  const rol = request.headers.get("x-rol") || "";
  if (!empresaIdHeader) {
    return { ok: false, response: NextResponse.json({ error: "Falta contexto de auth" }, { status: 401 }) };
  }

  if (empresaIdHeader === "SHIPRO") {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("empresaId");
    const candidato = bodyEmpresaId ?? fromQuery;
    if (candidato === undefined || candidato === null || candidato === "") {
      return { ok: false, response: NextResponse.json({ error: "empresaId requerido para usuarios Shipro" }, { status: 400 }) };
    }
    const id = parseInt(String(candidato));
    if (isNaN(id)) return { ok: false, response: NextResponse.json({ error: "empresaId inválido" }, { status: 400 }) };
    return { ok: true, empresaId: id, rol };
  }

  const id = parseInt(empresaIdHeader);
  if (isNaN(id)) return { ok: false, response: NextResponse.json({ error: "empresaId inválido" }, { status: 400 }) };
  return { ok: true, empresaId: id, rol };
}

/**
 * Verifica acceso a un depósito existente por id.
 * - Shipro: puede acceder a cualquier depósito.
 * - Cliente: solo a depósitos de SU empresa. Si pide uno de otra empresa,
 *   se devuelve 404 (no exponer existencia — defense-in-depth).
 *
 * Si requireWrite=true: además valida que el rol esté en ROLES_ESCRITURA.
 */
export type AccesoDeposito =
  | { ok: true; deposito: Deposito; rol: string; empresaIdSesion: number | null }
  | { ok: false; response: NextResponse };

export async function verificarAccesoDeposito(
  request: Request,
  depositoId: number,
  requireWrite: boolean
): Promise<AccesoDeposito> {
  const empresaIdHeader = request.headers.get("x-empresa-id");
  const rol = request.headers.get("x-rol") || "";
  if (!empresaIdHeader) {
    return { ok: false, response: NextResponse.json({ error: "Falta contexto de auth" }, { status: 401 }) };
  }

  if (!ROLES_LECTURA.includes(rol)) {
    return { ok: false, response: NextResponse.json({ error: "Sin permisos" }, { status: 403 }) };
  }

  const deposito = await prisma.deposito.findUnique({ where: { id: depositoId } });
  if (!deposito) {
    return { ok: false, response: NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 }) };
  }

  let empresaIdSesion: number | null = null;
  if (empresaIdHeader !== "SHIPRO") {
    empresaIdSesion = parseInt(empresaIdHeader);
    // Cliente intentando ver depósito de OTRA empresa: 404 (no exponer existencia)
    if (deposito.empresaId !== empresaIdSesion) {
      return { ok: false, response: NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 }) };
    }
  }

  if (requireWrite && !ROLES_ESCRITURA.includes(rol)) {
    return { ok: false, response: NextResponse.json({ error: "Sin permisos para modificar" }, { status: 403 }) };
  }

  return { ok: true, deposito, rol, empresaIdSesion };
}
