import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET: Trae a todas las empresas y sus saldos
export async function GET(request: Request) {
  try {
    const empresas = await prisma.empresa.findMany({
      select: {
        id: true,
        nombre: true,
        cuit: true,
        saldoActivo: true,
        modalidadPago: true,
        limiteDescubierto: true,
      },
      orderBy: {
        saldoActivo: 'asc' // Ordenamos de los que más nos deben a los que más saldo tienen
      }
    });

    return NextResponse.json(empresas);
  } catch (error) {
    console.error("Error cargando finanzas admin:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST: Acreditar un pago manual o recarga de saldo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { empresaId, monto, referencia, notas } = body;

    if (!empresaId || !monto || isNaN(parseFloat(monto))) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const montoFloat = parseFloat(monto);

    // Transacción segura para evitar desfasajes
    const resultado = await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.findUnique({
        where: { id: parseInt(empresaId) }
      });

      if (!empresa) throw new Error("Empresa no encontrada");

      // Sumamos el pago al saldo actual (Si debía -5000 y paga 5000, queda en 0)
      const nuevoSaldo = empresa.saldoActivo + montoFloat;

      // 1. Actualizamos el saldo de la empresa
      await tx.empresa.update({
        where: { id: parseInt(empresaId) },
        data: { saldoActivo: nuevoSaldo }
      });

      // 2. Dejamos el registro en el extracto bancario (Ledger)
      const movimiento = await tx.movimientoFinanciero.create({
        data: {
          empresaId: parseInt(empresaId),
          tipo: montoFloat >= 0 ? "INGRESO_MANUAL" : "AJUSTE_ADMIN",
          monto: montoFloat,
          saldoPosterior: nuevoSaldo,
          referencia: referencia || "S/R",
          descripcion: notas || "Acreditación de saldo / Pago de liquidación",
        }
      });

      return { nuevoSaldo, movimiento };
    });

    return NextResponse.json({ success: true, ...resultado });

  } catch (error: any) {
    console.error("Error al acreditar pago:", error);
    return NextResponse.json({ error: error.message || "Error al procesar el pago" }, { status: 500 });
  }
}