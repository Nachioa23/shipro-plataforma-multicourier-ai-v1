import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = parseInt(searchParams.get("empresaId") || "1");

    // 1. Buscamos la lista maestra de Couriers que el Super Admin dio de alta
    const couriersMaestros = await prisma.courier.findMany({
      where: { activo: true }
    });

    // 2. Buscamos qué configuraciones específicas guardó esta Empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { credenciales: true }
    });

    if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    return NextResponse.json({ 
      empresa: { ordenamientoDefault: empresa.ordenamientoDefault },
      credencialesCliente: empresa.credenciales,
      couriersGlobales: couriersMaestros // <--- Enviamos la lista maestra al Frontend
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Falla al leer la base de datos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { empresaId, configsGenerales, couriers } = body;

    // tipoCuenta (DEUDA 16) solo lo modifica admin_shipro. Para otros roles
    // se ignora silenciosamente — el frontend tampoco lo muestra/edita.
    // Defense-in-depth: aunque el frontend filtre, el backend valida también.
    const rol = request.headers.get("x-rol") || "";
    const puedeEditarTipoCuenta = rol === "admin_shipro";

    // 1. Guardamos reglas globales
    await prisma.empresa.update({
      where: { id: parseInt(empresaId) },
      data: { ordenamientoDefault: configsGenerales.ordenamiento }
    });

    // 2. Guardamos la config de cada courier
    for (const courier of couriers) {
      const credencialesJson = courier.usaPropias ? JSON.stringify(courier.credenciales) : null;
      const serviciosActivos = JSON.stringify(courier.servicios || []);

      // DEUDA 29 Sub-fase 1.C.3: TransportesTab manda modoFirstMile + courierRecolectorId
      // directamente. Mantenemos el whitelist defensivo y el soporte legacy de `recolector`
      // string por compatibilidad con clientes viejos (defense in depth).
      const VALORES_FIRST_MILE = ['mismo_courier', 'consolidador', 'drop_off_cliente'];
      const modoFirstMileInput = courier.modoFirstMile ?? courier.recolector;
      const modoFirstMile = VALORES_FIRST_MILE.includes(modoFirstMileInput)
        ? modoFirstMileInput
        : 'mismo_courier';

      // courierRecolectorId solo aplica cuando modoFirstMile === "consolidador".
      // Si no es consolidador → forzar null para preservar consistencia.
      // Si es consolidador pero no llega ID válido → null (frontend ya validó pre-submit;
      // este fallback evita crashear si llega un body malformado).
      const courierRecolectorId = modoFirstMile === 'consolidador'
        ? (typeof courier.courierRecolectorId === 'number' ? courier.courierRecolectorId : null)
        : null;

      // tipoCuenta: solo se incluye en update/create si el rol lo permite.
      // Valor "" (default empresa) → null en BD.
      const tipoCuentaPatch = puedeEditarTipoCuenta
        ? { tipoCuenta: courier.tipoCuenta ? courier.tipoCuenta : null }
        : {};

      await prisma.credencialCourier.upsert({
        where: {
          empresaId_nombreCourier: {
            empresaId: parseInt(empresaId),
            nombreCourier: courier.id,
          }
        },
        update: {
          activo: courier.activo,
          usaCredencialesPropias: courier.usaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          ajusteTarifaPorcentaje: parseFloat(courier.markupClientePorcentaje) || 0,
          markupFijo: parseFloat(courier.markupClienteFijo) || 0,
          modoFirstMile: modoFirstMile,
          courierRecolectorId: courierRecolectorId,
          requiereSeguro: courier.seguroActivado || false,
          ...tipoCuentaPatch,
        },
        create: {
          empresaId: parseInt(empresaId),
          nombreCourier: courier.id,
          activo: courier.activo,
          usaCredencialesPropias: courier.usaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          ajusteTarifaPorcentaje: parseFloat(courier.markupClientePorcentaje) || 0,
          markupFijo: parseFloat(courier.markupClienteFijo) || 0,
          modoFirstMile: modoFirstMile,
          courierRecolectorId: courierRecolectorId,
          requiereSeguro: courier.seguroActivado || false,
          ...tipoCuentaPatch,
        }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error guardando:", error);
    return NextResponse.json({ error: "Falla al guardar en la base de datos" }, { status: 500 });
  }
}