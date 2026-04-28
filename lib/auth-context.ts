import { NextResponse } from "next/server";

export interface AuthContext {
  empresaId: number | null;
  rol: string;
  modoDios: boolean;
}

/**
 * Resuelve el contexto de auth desde headers inyectados por proxy.ts.
 * - Cliente (rol no shipro): empresaId = header x-empresa-id SIEMPRE. Ignora filtroEmpresa.
 * - Shipro (admin_shipro / operador_shipro): empresaId = filtroEmpresa (query/body).
 *   null = "TODAS" (Modo Dios).
 *
 * Devuelve NextResponse 401/400 directamente si el contexto es inválido.
 * Workaround pendiente del modelo correcto en DEUDA 5 (Usuario.empresaId nullable).
 */
export function resolverContext(
  request: Request,
  filtroEmpresaRaw?: string | null
): AuthContext | NextResponse {
  const empresaIdHeader = request.headers.get("x-empresa-id");
  const rol = request.headers.get("x-rol") || "";

  if (!empresaIdHeader) {
    return NextResponse.json(
      { error: "Falta x-empresa-id (proxy mal configurado o ruta no pasó por proxy)" },
      { status: 401 }
    );
  }

  const esShipro = rol.startsWith("admin_shipro") || rol.startsWith("operador_shipro");

  if (esShipro) {
    if (!filtroEmpresaRaw || filtroEmpresaRaw === "TODAS") {
      return { empresaId: null, rol, modoDios: true };
    }
    const id = parseInt(filtroEmpresaRaw);
    if (isNaN(id)) {
      return NextResponse.json({ error: "filtroEmpresa inválido" }, { status: 400 });
    }
    return { empresaId: id, rol, modoDios: true };
  }

  const id = parseInt(empresaIdHeader);
  if (isNaN(id)) {
    return NextResponse.json({ error: "x-empresa-id inválido" }, { status: 400 });
  }
  return { empresaId: id, rol, modoDios: false };
}
