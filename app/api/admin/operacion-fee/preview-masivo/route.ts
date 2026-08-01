import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// FASE 2 sub 4 parte B PASO 1 (2026-08-01): VISTA PREVIA del ajuste masivo
// de Fee. READ-ONLY. Compute puro sobre las filas activas de OperacionFee —
// esta ruta NO escribe absolutamente NADA (ni create, ni update, ni upsert,
// ni transaction). El paso 2 (apply real: close+create por empresa dentro de
// una transacción + evento AjusteMasivoFee) es un prompt aparte.
//
// FÓRMULA (decisión Nacho): mismo escalado sobre TIPO=FIJO y TIPO=PORCENTAJE,
// cada Fee escalado sobre su PROPIO valor:
//   nuevoValor = valorActual * (1 + porcentaje/100)
// Un FIJO 1600 con +10% → 1760. Un PORCENTAJE 3 con +10% → 3.3.
//
// EMPRESAS SIN FEE: se saltean (no existe row → $0; un ajuste proporcional
// de 0 es 0, no vale crear una vigencia inicial en un ajuste masivo). Se
// reportan como salteadas en la respuesta para transparencia. Ver DEUDA 122
// sobre distinguir promo-0 de legacy-0 en el futuro.
//
// REDONDEO: 2 decimales half-up (Prisma.Decimal default ROUND_HALF_UP,
// consistente con el redondeo del precioFinal en cotizador.ts:191 y con la
// política del engine "Decimal(12,2) redondea half-away-from-zero al write").

const MIN_PORCENTAJE_EXCL = -100; // exclusivo: > -100 (nunca a 0/negativo)
const MAX_PORCENTAJE = 1000;      // sano superior

export async function POST(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const raw = body?.porcentaje;
    const porcentaje = typeof raw === "number" ? raw : Number(raw);

    if (
      !Number.isFinite(porcentaje) ||
      porcentaje <= MIN_PORCENTAJE_EXCL ||
      porcentaje > MAX_PORCENTAJE
    ) {
      return NextResponse.json(
        {
          error: `porcentaje debe ser un número finito estrictamente mayor a ${MIN_PORCENTAJE_EXCL} y menor o igual a ${MAX_PORCENTAJE} (${MIN_PORCENTAJE_EXCL} llevaría el Fee a cero o negativo).`,
        },
        { status: 400 }
      );
    }

    const factor = new Prisma.Decimal(1).add(
      new Prisma.Decimal(porcentaje.toString()).div(100)
    );

    // READ-ONLY: sólo SELECT — nada más.
    const feesActivos = await prisma.operacionFee.findMany({
      where: { activo: true },
      include: {
        empresa: { select: { id: true, nombre: true, cuit: true, activo: true } },
      },
      orderBy: { empresa: { nombre: "asc" } },
    });

    // Filtrar sólo empresas activas (defensa-en-profundidad: rows huérfanas
    // de empresas desactivadas quedan fuera del ajuste masivo).
    const afectados = feesActivos
      .filter((f) => f.empresa.activo)
      .map((f) => {
        const valorActual = f.valor;
        const valorNuevo = valorActual.mul(factor).toDecimalPlaces(2);
        const delta = valorNuevo.sub(valorActual);
        return {
          empresaId: f.empresa.id,
          nombre: f.empresa.nombre,
          cuit: f.empresa.cuit,
          tipo: f.tipo,
          valorActual: valorActual.toString(),
          valorNuevo: valorNuevo.toString(),
          delta: delta.toString(),
          feeId: f.id,
        };
      });

    // Empresas activas SIN OperacionFee activa (salteadas — ver header).
    const empresasConFee = new Set(afectados.map((a) => a.empresaId));
    const empresasActivas = await prisma.empresa.findMany({
      where: { activo: true },
      select: { id: true, nombre: true },
    });
    const salteadas = empresasActivas
      .filter((e) => !empresasConFee.has(e.id))
      .map((e) => ({ empresaId: e.id, nombre: e.nombre }));

    return NextResponse.json({
      porcentaje,
      factor: factor.toString(),
      afectadas: afectados,
      cantidadAfectadas: afectados.length,
      salteadas,
      cantidadSalteadas: salteadas.length,
      simulacion: true,
    });
  } catch (error: any) {
    console.error("Error calculando vista previa de ajuste masivo:", error);
    return NextResponse.json(
      { error: error?.message || "Error al calcular vista previa" },
      { status: 500 }
    );
  }
}
