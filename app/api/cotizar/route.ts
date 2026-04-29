import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { cotizar } from "@/lib/cotizador";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = resolverContext(request, body.filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const result = await cotizar({
      empresaId: ctx.empresaId,
      cpOrigen: body.cpOrigen,
      cpDestino: body.cpDestino,
      provinciaDestino: body.provinciaDestino,
      paquetes: body.paquetes,
      valorCarrito: body.valorCarrito,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message?.startsWith('EmpresaRequerida')) {
      return NextResponse.json(
        { error: 'Seleccioná una empresa para cotizar', code: 'EMPRESA_REQUERIDA' },
        { status: 400 }
      );
    }
    console.error("Error en POST /api/cotizar:", error);
    return NextResponse.json({ error: "Falla interna" }, { status: 500 });
  }
}
