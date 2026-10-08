import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { procesarEnviosBloqueados } from "@/lib/envios/procesar-bloqueados";

// GET: Trae a todas las empresas y sus saldos
export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

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
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { empresaId, monto, referencia, notas } = body;

    if (!empresaId || !monto || isNaN(parseFloat(monto))) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const montoDecimal = new Prisma.Decimal(parseFloat(monto));

    // Transacción segura para evitar desfasajes
    const resultado = await prisma.$transaction(async (tx) => {
      // DEUDA 136 Fase A de [[DEUDA 138]] (2026-10-08): increment ATÓMICO en vez
      // del read-then-write previo (`findUnique` → `nuevoSaldo = saldo.add(monto)`
      // → `update({ saldoActivo: nuevoSaldo })`). Patrón viejo era lost-update
      // bajo concurrencia. Postgres serializa el update sobre la misma fila con
      // `{ increment: montoDecimal }` y devuelve el saldo real post-write vía
      // `select` para alimentar `saldoPosterior` del MovimientoFinanciero.
      // montoDecimal byte-idéntico — solo cambia CÓMO se escribe.
      const empresaActualizada = await tx.empresa.update({
        where: { id: parseInt(empresaId) },
        data: { saldoActivo: { increment: montoDecimal } },
        select: { saldoActivo: true },
      }).catch((e) => {
        // P2025 = empresa no existe (equivalente al throw del findUnique+check previo).
        if ((e as { code?: string }).code === "P2025") {
          throw new Error("Empresa no encontrada");
        }
        throw e;
      });
      const nuevoSaldo = empresaActualizada.saldoActivo;

      // 2. Dejamos el registro en el extracto bancario (Ledger) con el saldo real
      // post-atomic (no un cálculo stale).
      const movimiento = await tx.movimientoFinanciero.create({
        data: {
          empresaId: parseInt(empresaId),
          tipo: montoDecimal.gte(0) ? "INGRESO_MANUAL" : "AJUSTE_ADMIN",
          monto: montoDecimal,
          saldoPosterior: nuevoSaldo,
          referencia: referencia || "S/R",
          descripcion: notas || "Acreditación de saldo / Pago de liquidación",
        }
      });

      return { nuevoSaldo, movimiento };
    });

    // Después de recargar saldo: intentar destrabar envíos en BLOQUEADO_SALDO
    // de esa empresa (DEUDA 16). Procesa máx 10 inline; restantes quedan
    // para próxima recarga o un endpoint manual futuro.
    const recovery = await procesarEnviosBloqueados(parseInt(empresaId));

    return NextResponse.json({ success: true, ...resultado, recovery });

  } catch (error: any) {
    console.error("Error al acreditar pago:", error);
    return NextResponse.json({ error: error.message || "Error al procesar el pago" }, { status: 500 });
  }
}