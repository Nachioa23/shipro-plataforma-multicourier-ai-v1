import { NextResponse } from "next/server";
import { crearEnvio } from "@/lib/envios/crear";

// POST: creación de envío desde el dashboard (sesión NextAuth).
// El proxy.ts inyecta x-empresa-id resuelto desde el JWT.
// /api/envios POST queda reservado para e-commerces (API Key).
export async function POST(request: Request) {
  const empresaIdHeader = request.headers.get("x-empresa-id");
  if (!empresaIdHeader) {
    return NextResponse.json({ error: "Falta empresaId en el contexto de auth" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Para shipro: header trae "SHIPRO" (Modo Dios). La empresa específica
    // viene en body.filtroEmpresa (dropdown del frontend).
    // Para cliente: header trae empresaId numérico de su sesión.
    let empresaId: number;
    if (empresaIdHeader === "SHIPRO") {
      if (!body.filtroEmpresa) {
        return NextResponse.json(
          { error: 'Seleccioná una empresa para crear el envío', code: 'EMPRESA_REQUERIDA' },
          { status: 400 }
        );
      }
      empresaId = parseInt(body.filtroEmpresa);
    } else {
      empresaId = parseInt(empresaIdHeader);
    }

    if (isNaN(empresaId)) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }

    const result = await crearEnvio({
      empresaId,
      destinatarioNombre: body.destinatarioNombre,
      cpDestino: body.cpDestino,
      pesoReal: body.pesoReal,
      nombreCourier: body.nombreCourier,
      calle: body.calle,
      altura: body.altura,
      piso: body.piso,
      dpto: body.dpto,
      dni: body.dni,
      email: body.email,
      telefono: body.telefono,
      localidad: body.localidad,
      modalidad: body.modalidad,
      valorDeclarado: body.valorDeclarado,
      costoEnvio: body.costoEnvio,
      costoProveedor: body.costoProveedor,
      provinciaDestino: body.provinciaDestino,
      numeroOrden: body.numeroOrden
    });

    if (result.bloqueadoPorSaldo) {
      return NextResponse.json({
        ...result,
        status: "BLOQUEADO_SALDO",
        warning: "Envío creado pero pendiente por carga de saldo. Cargá saldo en /facturacion para destrabarlo."
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message?.startsWith('EmpresaRequerida')) {
      return NextResponse.json(
        { error: 'Seleccioná una empresa para crear el envío', code: 'EMPRESA_REQUERIDA' },
        { status: 400 }
      );
    }
    console.error("Error en POST /api/envios/manual:", error);
    return NextResponse.json({ error: "Error interno al crear el envío o debitar el saldo." }, { status: 500 });
  }
}
