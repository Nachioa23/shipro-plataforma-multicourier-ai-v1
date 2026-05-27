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

    // === DEUDA 35: validacion de tipoOrigen ===
    // Si el body manda tipoOrigen, tiene que ser uno de los 2 valores validos.
    // Si no manda nada, se respeta el default de crearEnvio ("recoleccion_courier").
    if (body.tipoOrigen !== undefined && body.tipoOrigen !== "recoleccion_courier" && body.tipoOrigen !== "drop_off_cliente") {
      return NextResponse.json(
        { error: "tipoOrigen invalido. Valores aceptados: 'recoleccion_courier' o 'drop_off_cliente'" },
        { status: 400 }
      );
    }

    const result = await crearEnvio({
      empresaId,
      depositoId: body.depositoId,
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
      numeroOrden: body.numeroOrden,
      tipoOrigen: body.tipoOrigen
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
    if (error?.message?.startsWith('DepositoRequerido')) {
      return NextResponse.json(
        { error: 'Configurá un depósito predeterminado en /configuracion/depositos antes de crear envíos.', code: 'DEPOSITO_REQUERIDO' },
        { status: 400 }
      );
    }
    if (error?.message?.startsWith('DepositoNoEncontrado')) {
      return NextResponse.json(
        { error: 'Depósito no encontrado.', code: 'DEPOSITO_NO_ENCONTRADO' },
        { status: 400 }
      );
    }
    if (error?.message?.startsWith('DepositoInactivo')) {
      return NextResponse.json(
        { error: 'El depósito está inactivo o eliminado y no puede usarse para crear envíos.', code: 'DEPOSITO_INACTIVO' },
        { status: 400 }
      );
    }
    if (error?.message?.startsWith('OperatividadInvalida')) {
      return NextResponse.json(
        { error: error.message, code: 'OPERATIVIDAD_INVALIDA' },
        { status: 400 }
      );
    }
    console.error("Error en POST /api/envios/manual:", error);
    return NextResponse.json({ error: "Error interno al crear el envío o debitar el saldo." }, { status: 500 });
  }
}
