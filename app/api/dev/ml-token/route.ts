import { NextResponse, type NextRequest } from "next/server";
import { getMercadoLibreAccessToken } from "@/lib/mercadolibre/tokens";

// ============================================================================
// 🚨 THROWAWAY dev-only — DELETE post-test.
//
// Endpoint temporal para exponer el access_token plaintext del seller ML
// vinculado a `empresaId`, usado por Nacho (admin_shipro) para la prueba
// real del webhook (PUT /items con el token del seller → dispara webhook
// "items" genuino de ML al receiver `/api/mercadolibre/webhooks`).
//
// GATE: `admin_shipro` (via el `x-rol` que inyecta el proxy tras validar la
// sesión NextAuth). Cualquier otro rol → 403. Sin sesión → el proxy retorna
// 401 ANTES de que este handler corra.
//
// Contract:
//   GET /api/dev/ml-token?empresaId=1
//   Headers: cookie NextAuth de sesión admin_shipro.
//   Response 200: { empresaId, accessToken }
//   Response 400: { error } — empresaId inválido.
//   Response 403: { error } — no admin_shipro.
//   Response 500: { error } — refresh falló, seller expirado, etc.
//
// USO (DevTools console autenticado como admin_shipro):
//   fetch("/api/dev/ml-token?empresaId=1")
//     .then(r => r.json())
//     .then(d => console.log(d.accessToken));
//
// CLEANUP post-test: rm este archivo + commit + push + deploy.
// ============================================================================

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Solo admin_shipro" },
      { status: 403 },
    );
  }

  const empresaIdRaw = request.nextUrl.searchParams.get("empresaId");
  const empresaId = Number(empresaIdRaw);
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    return NextResponse.json(
      { error: "empresaId inválido (query param requerido, entero > 0)" },
      { status: 400 },
    );
  }

  try {
    const accessToken = await getMercadoLibreAccessToken(empresaId);
    return NextResponse.json({ empresaId, accessToken });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Error interno" },
      { status: 500 },
    );
  }
}
