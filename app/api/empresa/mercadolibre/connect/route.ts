import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { crearInstallLinkMercadoLibre } from "@/lib/mercadolibre/install-link";

// ============================================================================
// MEF Fase 1 pieza self-service — genera install-link ML para el cliente
// autenticado. Session-scoped: el cliente conecta SU PROPIA cuenta ML.
//
// 🚨 SECURITY INVARIANT (crítica, verificada por grep en la validación):
//     `empresaId` sale EXCLUSIVAMENTE de `token.empresaId` (JWT firmado
//     NextAuth). Este endpoint NUNCA lee `body.empresaId` ni ningún input
//     del request — el body no se parsea. Un cliente malicioso que intente
//     `body: { empresaId: <otra empresa> }` es ignorado por completo; el
//     valor de empresaId proviene del JWT firmado con NEXTAUTH_SECRET.
//
// Roles permitidos: gerente_cliente + operador_cliente (los roles del cliente
// de la empresa dueña de la cuenta ML a conectar). Roles Shipro
// (admin/operador_shipro) usan el endpoint operador
// `/api/mercadolibre/install/link` que sí acepta empresaId en el body (para
// generar el link a nombre de un cliente en soporte).
//
// Contract:
//   POST /api/empresa/mercadolibre/connect
//   Headers: cookie NextAuth (proxy la valida antes de llegar acá).
//   Body: (ignorado — no se lee).
//   Response 200: { url: string, expira: string }
//   Response 401: { error } — no autenticado.
//   Response 400: { error } — usuario Shipro (empresaId null en el token).
//   Response 403: { error } — rol no autorizado (no cliente).
// ============================================================================

const ROLES_AUTORIZADOS = ["gerente_cliente", "operador_cliente"];

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Guard: usuarios Shipro (empresaId null) NO pueden usar este endpoint.
  // Ellos disparan el install-link via /api/mercadolibre/install/link
  // (operator-gated, pasa empresaId en el body).
  if (token.empresaId === null) {
    return NextResponse.json(
      { error: "Este endpoint no aplica a usuarios Shipro. Usá /api/mercadolibre/install/link." },
      { status: 400 },
    );
  }

  const rol = typeof token.rol === "string" ? token.rol : "";
  if (!ROLES_AUTORIZADOS.includes(rol)) {
    return NextResponse.json(
      { error: "Acceso denegado. Solo gerente_cliente / operador_cliente pueden conectar la cuenta ML de su empresa." },
      { status: 403 },
    );
  }

  // 🚨 empresaId SIEMPRE del JWT firmado. Nunca del body.
  const empresaId = token.empresaId as number;

  try {
    const { url, expira } = await crearInstallLinkMercadoLibre(empresaId);
    return NextResponse.json({ url, expira }, { status: 200 });
  } catch (e) {
    console.error("[/api/empresa/mercadolibre/connect] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500 },
    );
  }
}
