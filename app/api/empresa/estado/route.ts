import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/empresa/estado
 *
 * Retorna el estado actual de la empresa del usuario logueado para mostrar
 * en UI (banner suspension DEUDA 22, futuras alertas operativas).
 *
 * Auth: proxy.ts inyecta x-empresa-id desde session JWT o apiKey.
 * Si el usuario no tiene empresa asociada (rol Shipro o sin empresa),
 * retorna estado neutro.
 *
 * Response:
 * {
 *   suspendida: boolean,
 *   fechaSuspension: string | null,
 *   saldoActivo: number,
 *   limiteDescubierto: number
 * }
 */
export async function GET(request: NextRequest) {
  const empresaIdHeader = request.headers.get("x-empresa-id");

  if (!empresaIdHeader) {
    // Sin empresa (admin_shipro o sin contexto) — estado neutro.
    return NextResponse.json({
      suspendida: false,
      fechaSuspension: null,
      saldoActivo: 0,
      limiteDescubierto: 0,
    });
  }

  const empresaId = parseInt(empresaIdHeader);
  if (isNaN(empresaId)) {
    return NextResponse.json({ error: "x-empresa-id invalido" }, { status: 400 });
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      suspendida: true,
      fechaSuspension: true,
      saldoActivo: true,
      limiteDescubierto: true,
    },
  });

  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  return NextResponse.json(empresa);
}
