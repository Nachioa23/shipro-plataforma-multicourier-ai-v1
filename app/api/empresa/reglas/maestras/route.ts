// =============================================================================
// ENDPOINT: GET /api/empresa/reglas/maestras
// DEUDA 84 follow-up (2026-07-12)
// =============================================================================
//
// Catalogo maestro read-only de plantillas de ReglaRuteo. Las plantillas
// (empresaId=null) son la definicion global de Shipro — cualquier cliente
// autenticado tiene interes legitimo en leerlas (define QUE reglas puede
// activar). No son data sensible per-empresa; el aislamiento entre clientes
// vive en las filas empresaId=X, que siguen bajo /api/empresa/reglas (scope-
// filtered) y /api/admin/reglas (shipro-only para writes).
//
// FONDO — por que este endpoint existe:
//   /api/admin/reglas gano un gate x-rol in [admin_shipro, operador_shipro]
//   por DEUDA 87 FAMILIA 3, cerrando el leak de DEUDA 84 (findMany sin where
//   devolvia filas de todas las empresas). Efecto colateral: RuteoTab (que
//   ve el cliente) tambien fetcheaba de ese endpoint el catalogo maestro y
//   ahora recibe 403. Este endpoint separa lectura del catalogo (aca) de
//   lectura/escritura per-empresa (endpoints existentes).
//
// AUTH: solo autenticado, via resolverContext. Cualquier rol (admin/operador
// shipro + gerente/operador cliente) pasa. No hay filtro por empresaId — las
// plantillas no dependen de la empresa del caller.
//
// RESPONSE: ReglaRuteo[] con SOLO filas empresaId=null. Shape identica a la
// que devolvia /api/admin/reglas GET, para que RuteoTab reemplace la URL sin
// tocar la logica de merge.
// =============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const maestras = await prisma.reglaRuteo.findMany({
      where: { empresaId: null },
      orderBy: { prioridad: "asc" },
    });

    return NextResponse.json(maestras);
  } catch (error) {
    console.error("[empresa/reglas/maestras GET] Error interno:", error);
    return NextResponse.json({ error: "Error al obtener las reglas maestras" }, { status: 500 });
  }
}
