import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { cotizar } from "@/lib/cotizador";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = resolverContext(request, body.filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    // DEUDA 32+37 (Fase J): origen del registro de cobertura vacia. El proxy
    // inyecta x-auth-mode con "session" (dashboard) o "apiKey" (e-commerce).
    // Default "dashboard" defensivo si por algun motivo el header falta.
    const authMode = request.headers.get("x-auth-mode");
    const origen = authMode === "apiKey" ? "api" : "dashboard";

    const result = await cotizar({
      empresaId: ctx.empresaId,
      cpOrigen: body.cpOrigen,
      cpDestino: body.cpDestino,
      provinciaDestino: body.provinciaDestino,
      paquetes: body.paquetes,
      valorCarrito: body.valorCarrito,
      origen,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message?.startsWith('EmpresaRequerida')) {
      return NextResponse.json(
        { error: 'Seleccioná una empresa para cotizar', code: 'EMPRESA_REQUERIDA' },
        { status: 400 }
      );
    }
    if (error?.message?.startsWith('DepositoRequerido')) {
      return NextResponse.json(
        { error: 'Configurá al menos un depósito predeterminado para cotizar.', code: 'DEPOSITO_REQUERIDO' },
        { status: 400 }
      );
    }
    console.error("Error en POST /api/cotizar:", error);
    return NextResponse.json({ error: "Falla interna" }, { status: 500 });
  }
}
