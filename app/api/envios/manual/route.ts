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
  const empresaId = parseInt(empresaIdHeader);

  try {
    const body = await request.json();
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
