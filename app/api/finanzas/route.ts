import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresaId");
    
    if (!empresaId) return NextResponse.json({ error: "Falta empresaId" }, { status: 400 });

    const empresa = await prisma.empresa.findUnique({
      where: { id: parseInt(empresaId) },
      include: {
        movimientos: {
          orderBy: { fecha: 'desc' },
          take: 100,
          include: { envio: true } 
        },
        // NUEVO: Traemos sus liquidaciones históricas
        liquidaciones: {
          orderBy: { fechaCreacion: 'desc' }
        }
      }
    });

    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      saldo: empresa.saldoActivo,
      modalidadPago: empresa.modalidadPago,
      limiteDescubierto: empresa.limiteDescubierto,
      movimientos: empresa.movimientos,
      liquidaciones: empresa.liquidaciones // NUEVO: Lo mandamos al frontend
    });

  } catch (error) {
    console.error("Error en API Finanzas Interna:", error);
    return NextResponse.json({ error: "Error interno al cargar la billetera" }, { status: 500 });
  }
}