import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError,
  type CampoAuditable
} from "@/lib/auditoria-configuracion";

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
    const { empresaId, configsGenerales, couriers, motivoAuditoria } = body;
    const empresaIdNum = parseInt(empresaId);

    // tipoCuenta (DEUDA 16) solo lo modifica admin_shipro. Para otros roles
    // se ignora silenciosamente — el frontend tampoco lo muestra/edita.
    // Defense-in-depth: aunque el frontend filtre, el backend valida también.
    const rol = request.headers.get("x-rol") || "";
    const puedeEditarTipoCuenta = rol === "admin_shipro";

    // 1. Guardamos reglas globales (ordenamientoDefault NO es auditable — low priority).
    await prisma.empresa.update({
      where: { id: empresaIdNum },
      data: { ordenamientoDefault: configsGenerales.ordenamiento }
    });

    // 2. Guardamos la config de cada courier + audit log de cambios sensibles (DEUDA 19).
    for (const courier of couriers) {
      const credencialesJson = courier.usaPropias ? JSON.stringify(courier.credenciales) : null;
      const serviciosActivos = JSON.stringify(courier.servicios || []);

      // DEUDA 29 Sub-fase 6.D.6: la modalidad de First-Mile (modoFirstMile +
      // courierRecolectorId) fue eliminada de CredencialCourier. Se resuelve
      // ahora a nivel par (depósito x courier) vía DepositoCourierConfig y
      // Deposito.courierRecolectorId. Este endpoint ya no escribe esos campos;
      // si el body los trae (TransportesTab legacy), se ignoran silenciosamente.

      // tipoCuenta: solo se incluye en update/create si el rol lo permite.
      // Valor "" (default empresa) → null en BD.
      const nuevoTipoCuenta = courier.tipoCuenta ? courier.tipoCuenta : null;
      const tipoCuentaPatch = puedeEditarTipoCuenta
        ? { tipoCuenta: nuevoTipoCuenta }
        : {};

      // DEUDA 19: read-before-write para diff. credAntes === null → creación inicial,
      // NO se audita (decisión: solo updates de configuración establecida).
      const credAntes = await prisma.credencialCourier.findUnique({
        where: {
          empresaId_nombreCourier: {
            empresaId: empresaIdNum,
            nombreCourier: courier.id,
          }
        }
      });

      // Find courier.id en BD para obtener courierId numerico (audit FK).
      const courierBD = await prisma.courier.findUnique({
        where: { nombre: courier.id },
        select: { id: true }
      });

      const nuevoActivo = courier.activo;
      const nuevoUsaPropias = courier.usaPropias;
      const nuevoAjuste = parseFloat(courier.markupClientePorcentaje) || 0;
      const nuevoMarkup = parseFloat(courier.markupClienteFijo) || 0;
      const nuevoSeguro = courier.seguroActivado || false;

      await prisma.credencialCourier.upsert({
        where: {
          empresaId_nombreCourier: {
            empresaId: empresaIdNum,
            nombreCourier: courier.id,
          }
        },
        update: {
          activo: nuevoActivo,
          usaCredencialesPropias: nuevoUsaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          ajusteTarifaPorcentaje: nuevoAjuste,
          markupFijo: nuevoMarkup,
          requiereSeguro: nuevoSeguro,
          ...tipoCuentaPatch,
        },
        create: {
          empresaId: empresaIdNum,
          nombreCourier: courier.id,
          activo: nuevoActivo,
          usaCredencialesPropias: nuevoUsaPropias,
          credencialesJson: credencialesJson,
          serviciosActivos: serviciosActivos,
          ajusteTarifaPorcentaje: nuevoAjuste,
          markupFijo: nuevoMarkup,
          requiereSeguro: nuevoSeguro,
          ...tipoCuentaPatch,
        }
      });

      // DEUDA 19: audit diff per-field SOLO si credAntes existia (update real).
      // Creacion inicial NO se audita (decision director D-19-10).
      if (credAntes && courierBD) {
        const courierId = courierBD.id;

        // Helper local: registra un campo si cambio.
        const auditarCampo = async (
          campo: CampoAuditable,
          valorAnterior: any,
          valorNuevo: any
        ) => {
          await registrarCambioConfiguracion({
            request,
            empresaId: empresaIdNum,
            courierId,
            campo,
            valorAnterior,
            valorNuevo,
            motivo: motivoAuditoria,
          });
        };

        await auditarCampo("activo", credAntes.activo, nuevoActivo);
        await auditarCampo("usaCredencialesPropias", credAntes.usaCredencialesPropias, nuevoUsaPropias);
        await auditarCampo("credencialesJson", credAntes.credencialesJson, credencialesJson);
        await auditarCampo("ajusteTarifaPorcentaje", credAntes.ajusteTarifaPorcentaje, nuevoAjuste);
        await auditarCampo("markupFijo", credAntes.markupFijo, nuevoMarkup);
        await auditarCampo("requiereSeguro", credAntes.requiereSeguro, nuevoSeguro);

        if (puedeEditarTipoCuenta) {
          await auditarCampo("tipoCuenta", credAntes.tipoCuenta, nuevoTipoCuenta);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    // DEUDA 19: motivo obligatorio faltante para campo sensible.
    if (error instanceof MotivoRequeridoError) {
      return NextResponse.json(
        { error: error.message, code: "MOTIVO_AUDITORIA_REQUERIDO" },
        { status: 400 }
      );
    }
    console.error("Error guardando:", error);
    return NextResponse.json({ error: "Falla al guardar en la base de datos" }, { status: 500 });
  }
}