import { NextResponse } from "next/server";

export interface AuthContext {
  empresaId: number | null;
  rol: string;
  modoDios: boolean;
}

/**
 * Resuelve el contexto de auth desde headers inyectados por proxy.ts.
 * - Cliente (x-empresa-id numérico): empresaId = ese número. Ignora filtroEmpresa (defensivo).
 * - Shipro (x-empresa-id="SHIPRO"): empresaId = filtroEmpresa (query/body). null = "TODAS" (Modo Dios).
 *
 * x-rol se sigue chequeando como defense-in-depth para rutas que no pasen por proxy.
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

  const esShipro = empresaIdHeader === "SHIPRO" || rol.startsWith("admin_shipro") || rol.startsWith("operador_shipro");

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
