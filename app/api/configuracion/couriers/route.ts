import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError,
  type CampoAuditable
} from "@/lib/auditoria-configuracion";
import { puedeEditarCampo, esModeloBCredenciales } from "@/lib/permisos";

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

    // DEUDA 21 (2026-06-18): defense-in-depth via matriz de permisos.
    // lib/permisos.ts es single source of truth. El backend NUNCA confia en
    // el frontend — cualquier mutacion pasa por puedeEditarCampo(rol, campo).
    // tipoCuenta (DEUDA 16) sigue siendo solo admin_shipro per la matriz.
    const rol = request.headers.get("x-rol") || "";

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
      const nuevoTipoCuenta = courier.tipoCuenta ? courier.tipoCuenta : null;
      const nuevoAjuste = parseFloat(courier.markupClientePorcentaje) || 0;
      const nuevoMarkup = parseFloat(courier.markupClienteFijo) || 0;
      const nuevoSeguro = courier.seguroActivado || false;

      // DEUDA 21: build per-field patches usando matriz de permisos.
      // credencialesJson distingue Modelo A (Shipro, restricted) vs Modelo B
      // (cliente, libre): contextual gating via esModeloBCredenciales.
      const esModeloB = esModeloBCredenciales(nuevoUsaPropias);
      const campoCredencialesJson = esModeloB
        ? "credencialesJsonPropias"
        : "credencialesJsonShipro";

      const activoPatch = puedeEditarCampo(rol, "activo")
        ? { activo: nuevoActivo }
        : {};
      const usaPropiasPatch = puedeEditarCampo(rol, "usaCredencialesPropias")
        ? { usaCredencialesPropias: nuevoUsaPropias }
        : {};
      const credencialesJsonPatch = puedeEditarCampo(rol, campoCredencialesJson)
        ? { credencialesJson: credencialesJson }
        : {};
      const serviciosPatch = puedeEditarCampo(rol, "serviciosActivos")
        ? { serviciosActivos: serviciosActivos }
        : {};
      const ajustePatch = puedeEditarCampo(rol, "ajusteTarifaPorcentaje")
        ? { ajusteTarifaPorcentaje: nuevoAjuste }
        : {};
      const markupPatch = puedeEditarCampo(rol, "markupFijo")
        ? { markupFijo: nuevoMarkup }
        : {};
      const seguroPatch = puedeEditarCampo(rol, "requiereSeguro")
        ? { requiereSeguro: nuevoSeguro }
        : {};
      const tipoCuentaPatch = puedeEditarCampo(rol, "tipoCuenta")
        ? { tipoCuenta: nuevoTipoCuenta }
        : {};

      // DEUDA 21: si el rol no puede editar NINGUN campo de este item, retornar
      // 403 (deny by default). Evita upsert no-op + senal clara para el cliente.
      const tieneAlgunPermiso =
        Object.keys(activoPatch).length > 0 ||
        Object.keys(usaPropiasPatch).length > 0 ||
        Object.keys(credencialesJsonPatch).length > 0 ||
        Object.keys(serviciosPatch).length > 0 ||
        Object.keys(ajustePatch).length > 0 ||
        Object.keys(markupPatch).length > 0 ||
        Object.keys(seguroPatch).length > 0 ||
        Object.keys(tipoCuentaPatch).length > 0;

      if (!tieneAlgunPermiso) {
        return NextResponse.json(
          {
            error: "Sin permisos para editar configuracion",
            code: "FORBIDDEN_NO_PERMISSIONS",
            detail: `Tu rol "${rol}" no tiene permisos para modificar ningun campo de configuracion. Contactate con el gerente de tu cuenta.`,
          },
          { status: 403 }
        );
      }

      await prisma.credencialCourier.upsert({
        where: {
          empresaId_nombreCourier: {
            empresaId: empresaIdNum,
            nombreCourier: courier.id,
          }
        },
        update: {
          ...activoPatch,
          ...usaPropiasPatch,
          ...credencialesJsonPatch,
          ...serviciosPatch,
          ...ajustePatch,
          ...markupPatch,
          ...seguroPatch,
          ...tipoCuentaPatch,
        },
        create: {
          empresaId: empresaIdNum,
          nombreCourier: courier.id,
          ...activoPatch,
          ...usaPropiasPatch,
          ...credencialesJsonPatch,
          ...serviciosPatch,
          ...ajustePatch,
          ...markupPatch,
          ...seguroPatch,
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

        // DEUDA 21: audit log per-field gated por matriz de permisos.
        // Solo se registra el cambio si el rol pudo editarlo (sino seria ruido).
        if (puedeEditarCampo(rol, "activo")) {
          await auditarCampo("activo", credAntes.activo, nuevoActivo);
        }
        if (puedeEditarCampo(rol, "usaCredencialesPropias")) {
          await auditarCampo("usaCredencialesPropias", credAntes.usaCredencialesPropias, nuevoUsaPropias);
        }
        if (puedeEditarCampo(rol, campoCredencialesJson)) {
          await auditarCampo("credencialesJson", credAntes.credencialesJson, credencialesJson);
        }
        if (puedeEditarCampo(rol, "serviciosActivos")) {
          // serviciosActivos NO esta en CAMPOS_AUDITABLES — skip audit (gating efectivo solo en upsert).
        }
        if (puedeEditarCampo(rol, "ajusteTarifaPorcentaje")) {
          await auditarCampo("ajusteTarifaPorcentaje", credAntes.ajusteTarifaPorcentaje, nuevoAjuste);
        }
        if (puedeEditarCampo(rol, "markupFijo")) {
          await auditarCampo("markupFijo", credAntes.markupFijo, nuevoMarkup);
        }
        if (puedeEditarCampo(rol, "requiereSeguro")) {
          await auditarCampo("requiereSeguro", credAntes.requiereSeguro, nuevoSeguro);
        }
        if (puedeEditarCampo(rol, "tipoCuenta")) {
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