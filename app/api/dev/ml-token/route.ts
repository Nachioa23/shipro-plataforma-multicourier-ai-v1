import { NextResponse, type NextRequest } from "next/server";
import { getMercadoLibreAccessToken } from "@/lib/mercadolibre/tokens";

// THROWAWAY dev-only — BORRAR post-prueba. Devuelve el access_token del
// seller ML vinculado a empresaId. Gate admin_shipro. Reusa la lógica real.
export async function GET(request: NextRequest) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json({ error: "Solo admin_shipro" }, { status: 403 });
  }
  const empresaId = Number(request.nextUrl.searchParams.get("empresaId"));
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    return NextResponse.json({ error: "empresaId invalido" }, { status: 400 });
  }
  try {
    const accessToken = await getMercadoLibreAccessToken(empresaId);
    return NextResponse.json({ empresaId, accessToken });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
