import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";

// ============================================================================
// MEF Fase 1 pieza self-service — read del estado de la conexión ML del
// cliente autenticado.
//
// Session-scoped: `empresaId = token.empresaId` (JWT firmado). El cliente
// solo puede leer el estado de SU PROPIA cuenta ML — nunca de otra empresa.
//
// Contract:
//   GET /api/empresa/mercadolibre/conexion
//   Headers: cookie NextAuth.
//   Response 200:
//     { conectada: true, mlUserId, nickname, estado, tokenExpiraEn, vinculadaEn }
//   ó
//     { conectada: false }
//   Response 401: no autenticado.
//   Response 400: usuario Shipro (empresaId null).
// ============================================================================

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (token.empresaId === null) {
    return NextResponse.json(
      { error: "Este endpoint no aplica a usuarios Shipro." },
      { status: 400 },
    );
  }

  const empresaId = token.empresaId as number;

  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: {
      mlUserId: true,
      nickname: true,
      estado: true,
      tokenExpiraEn: true,
      vinculadaEn: true,
    },
  });

  if (!cuenta || cuenta.estado !== "activa") {
    return NextResponse.json({
      conectada: false,
      ...(cuenta ? { estado: cuenta.estado } : {}), // "revocada" | "expirada" si aplica
    });
  }

  // Number(cuenta.mlUserId): Prisma devuelve bigint (schema BigInt, fix
  // 2026-09-17), y NextResponse.json → JSON.stringify TIRA con bigint
  // ("Do not know how to serialize a BigInt"). Los ML user_id caben safely
  // en JS Number (< 2^53), así que Number() es reversible + type-safe para
  // el cliente. Sin este cast, el endpoint devuelve 500 apenas hay UNA cuenta
  // conectada — bug crítico silencioso post-migration.
  return NextResponse.json({
    conectada: true,
    mlUserId: Number(cuenta.mlUserId),
    nickname: cuenta.nickname,
    estado: cuenta.estado,
    tokenExpiraEn: cuenta.tokenExpiraEn,
    vinculadaEn: cuenta.vinculadaEn,
  });
}
