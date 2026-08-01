import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// FASE 2 sub 4 parte B PASO 2 (2026-08-01): APPLY del ajuste masivo del Fee.
// La única operación que escribe el Fee de TODA la cartera de una vez.
// Confirma el cálculo del PASO 1 (preview, commit da27bcf) y lo persiste.
//
// GUARDRAILS:
//   - admin_shipro only.
//   - motivo OBLIGATORIO (persistido en AjusteMasivoFee.notas).
//   - vigenteDesde SIEMPRE server-side: `new Date()`. Jamás del body.
//   - RE-COMPUTE server-side. No se confía en un preview client-side.
//   - Todo en UNA sola $transaction — all-or-nothing. Si una empresa falla,
//     rollback total: nada de cartera parcial (mitad-vieja / mitad-nueva).
//   - Idempotency: no hay clave de idempotencia formal. La UI deshabilita
//     el botón mientras el request está en vuelo; el $transaction garantiza
//     que un retry no pueda quedar en un estado intermedio. Un retry
//     completo después del commit SÍ crearía otro AjusteMasivoFee con
//     nuevas vigencias — es responsabilidad del operador no re-clickear.
//     Ver comentario abajo si querés escalar esto en el futuro.
//
// AUDIT DEL EVENTO:
//   - El propio row `AjusteMasivoFee` es el audit log durable (schema pieza 1,
//     commit 3a0ce72): porcentaje + fechaAplicacion + aplicadoPorId + notas
//     (=motivo) + cantidadEmpresasAfectadas.
//   - NO se emiten filas per-empresa en `AuditoriaConfiguracion` para esta
//     operación masiva — sería ruido (N filas duplicando la misma info que
//     ya vive en el evento). Cada cambio individual de Fee (sub-piece 4 parte
//     A, editor per-empresa) sigue emitiendo audit rows normales.

const MIN_PORCENTAJE_EXCL = -100;
const MAX_PORCENTAJE = 1000;

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
    const motivoRaw = body?.motivo;

    const motivo =
      typeof motivoRaw === "string" && motivoRaw.trim().length > 0
        ? motivoRaw.trim()
        : null;
    if (!motivo) {
      return NextResponse.json(
        {
          error:
            "El motivo es obligatorio para aplicar un ajuste masivo de Fee (mueve plata en vivo a TODA la cartera).",
        },
        { status: 400 }
      );
    }

    const porcentaje = typeof raw === "number" ? raw : Number(raw);
    if (
      !Number.isFinite(porcentaje) ||
      porcentaje <= MIN_PORCENTAJE_EXCL ||
      porcentaje > MAX_PORCENTAJE
    ) {
      return NextResponse.json(
        {
          error: `porcentaje debe ser un número finito estrictamente mayor a ${MIN_PORCENTAJE_EXCL} y menor o igual a ${MAX_PORCENTAJE}.`,
        },
        { status: 400 }
      );
    }

    // Autor del cambio: mismo camino que registrarCambioConfiguracion — el
    // proxy inyecta x-usuario-email. aplicadoPorId es Int? (SetNull en FK),
    // así que si el email no matchea usuario, queda null.
    const usuarioEmail = request.headers.get("x-usuario-email") || null;
    let aplicadoPorId: number | null = null;
    if (usuarioEmail) {
      const usuario = await prisma.usuario.findUnique({
        where: { email: usuarioEmail },
        select: { id: true },
      });
      aplicadoPorId = usuario?.id ?? null;
    }

    // vigenteDesde SIEMPRE server-side.
    const ahora = new Date();
    const factor = new Prisma.Decimal(1).add(
      new Prisma.Decimal(porcentaje.toString()).div(100)
    );

    const resultado = await prisma.$transaction(async (tx) => {
      // (a) RE-COMPUTE server-side. No se lee ningún preview del body.
      const feesActivos = await tx.operacionFee.findMany({
        where: { activo: true, empresa: { activo: true } },
        orderBy: { empresa: { nombre: "asc" } },
      });

      // (b) computar + filtrar los que cambian (skip no-op).
      const cambios = feesActivos
        .map((fee) => {
          const nuevoValor = fee.valor.mul(factor).toDecimalPlaces(2);
          return { fee, nuevoValor };
        })
        .filter(({ fee, nuevoValor }) => !fee.valor.equals(nuevoValor));

      // (c) cerrar viejas + crear nuevas, in-loop, mismo tx.
      for (const { fee, nuevoValor } of cambios) {
        await tx.operacionFee.update({
          where: { id: fee.id },
          data: { activo: false, vigenteHasta: ahora },
        });
        await tx.operacionFee.create({
          data: {
            empresaId: fee.empresaId,
            tipo: fee.tipo,
            valor: nuevoValor,
            activo: true,
            vigenteDesde: ahora,
          },
        });
      }

      // (d) UN row en AjusteMasivoFee: el evento auditable de esta corrida.
      // notas = motivo (persistido acá; motivo es OBLIGATORIO — el evento
      // siempre tiene "por qué"). porcentaje va en su columna dedicada
      // Decimal(12,4). cantidadEmpresasAfectadas = las que realmente cambiaron
      // (empresas sin Fee: skipped; empresas cuyo nuevo valor === actual: skipped).
      const evento = await tx.ajusteMasivoFee.create({
        data: {
          porcentaje: new Prisma.Decimal(porcentaje.toString()).toDecimalPlaces(4),
          fechaAplicacion: ahora,
          aplicadoPorId,
          cantidadEmpresasAfectadas: cambios.length,
          notas: motivo,
        },
      });

      return {
        cantidadAfectadas: cambios.length,
        cantidadSalteadas: feesActivos.length - cambios.length,
        ajusteMasivoFeeId: evento.id,
      };
    });

    console.log(
      "[AUDIT operacionFeeAjusteMasivo]",
      JSON.stringify({
        usuarioEmail,
        rolUsuario: rol,
        aplicadoPorId,
        porcentaje,
        factor: factor.toString(),
        cantidadAfectadas: resultado.cantidadAfectadas,
        cantidadSalteadas: resultado.cantidadSalteadas,
        ajusteMasivoFeeId: resultado.ajusteMasivoFeeId,
        motivo,
        timestamp: ahora.toISOString(),
      })
    );

    return NextResponse.json({
      success: true,
      porcentaje,
      cantidadAfectadas: resultado.cantidadAfectadas,
      cantidadSalteadas: resultado.cantidadSalteadas,
      ajusteMasivoFeeId: resultado.ajusteMasivoFeeId,
    });
  } catch (error: any) {
    console.error("Error aplicando ajuste masivo de Fee:", error);
    return NextResponse.json(
      { error: error?.message || "Error al aplicar ajuste masivo" },
      { status: 500 }
    );
  }
}
