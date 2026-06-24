// ============================================================================
// PATCH /api/onboarding/confirmar-datos — paso 2 del wizard
//
// DEUDA 17.E.2 (2026-06-23): permite al gerente_cliente confirmar o
// corregir los datos cargados por admin Shipro en Fase A.
//
// Campos editables (D-17-E-2):
// - Empresa: razonSocial, direccionFiscalCalle/Altura/CP/Localidad/Provincia
// - Usuario: nombre, telefono (WhatsApp)
//
// Campos NO editables (protegidos):
// - CUIT (identificador fiscal único)
// - modalidadPago, limiteDescubierto, modeloAHabilitado (decisiones Shipro)
// - email (identidad de login)
// - notasInternas (privadas Shipro)
//
// Audit log (DEUDA 19): cada campo modificado genera un registro.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validarWhatsApp } from "@/lib/utils/validaciones-onboarding";
import {
  registrarCambioConfiguracion,
  type CampoAuditable,
} from "@/lib/auditoria-configuracion";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      razonSocial,
      direccionFiscalCalle,
      direccionFiscalAltura,
      direccionFiscalCP,
      direccionFiscalLocalidad,
      direccionFiscalProvincia,
      usuarioNombre,
      usuarioTelefono,
    } = body;

    // Validaciones de input.
    if (usuarioTelefono && !validarWhatsApp(usuarioTelefono)) {
      return NextResponse.json(
        { error: "Telefono debe ser WhatsApp formato +5491134567890." },
        { status: 400 }
      );
    }

    // Headers inyectados por proxy.ts (post-auth).
    const emailUsuario = request.headers.get("x-usuario-email");
    const empresaIdHeader = request.headers.get("x-empresa-id");

    if (!emailUsuario || !empresaIdHeader) {
      return NextResponse.json(
        { error: "No autenticado o sin empresa." },
        { status: 401 }
      );
    }

    const empresaId = parseInt(empresaIdHeader);

    const usuario = await prisma.usuario.findUnique({
      where: { email: emailUsuario },
    });

    const empresaAntes = await prisma.empresa.findUnique({
      where: { id: empresaId },
    });

    if (!usuario || !empresaAntes) {
      return NextResponse.json(
        { error: "Usuario o empresa no encontrados." },
        { status: 404 }
      );
    }

    // Helper local para auditar cambios usando signature existente del helper DEUDA 19.
    const auditarCampo = async (
      campo: CampoAuditable,
      valorAnterior: any,
      valorNuevo: any
    ) => {
      if (valorAnterior === valorNuevo || valorNuevo === undefined) return;
      try {
        await registrarCambioConfiguracion({
          request,
          empresaId,
          campo,
          valorAnterior: valorAnterior ?? null,
          valorNuevo,
          motivo: "Confirmacion de datos onboarding (wizard paso 2).",
        });
      } catch (e) {
        // El audit log no debe romper la operacion.
        console.warn(`[onboarding/confirmar-datos] Audit log fallo para ${campo}:`, e);
      }
    };

    // Aplicar updates Empresa (solo campos que llegaron).
    const empresaPatch: any = {};
    if (razonSocial !== undefined && razonSocial !== empresaAntes.nombre) {
      empresaPatch.nombre = razonSocial;
      await auditarCampo("razonSocial", empresaAntes.nombre, razonSocial);
    }
    if (direccionFiscalCalle !== undefined && direccionFiscalCalle !== empresaAntes.direccionFiscalCalle) {
      empresaPatch.direccionFiscalCalle = direccionFiscalCalle;
      await auditarCampo("direccionFiscalCalle", empresaAntes.direccionFiscalCalle, direccionFiscalCalle);
    }
    if (direccionFiscalAltura !== undefined && direccionFiscalAltura !== empresaAntes.direccionFiscalAltura) {
      empresaPatch.direccionFiscalAltura = direccionFiscalAltura;
      await auditarCampo("direccionFiscalAltura", empresaAntes.direccionFiscalAltura, direccionFiscalAltura);
    }
    if (direccionFiscalCP !== undefined && direccionFiscalCP !== empresaAntes.direccionFiscalCP) {
      empresaPatch.direccionFiscalCP = direccionFiscalCP;
      await auditarCampo("direccionFiscalCP", empresaAntes.direccionFiscalCP, direccionFiscalCP);
    }
    if (direccionFiscalLocalidad !== undefined && direccionFiscalLocalidad !== empresaAntes.direccionFiscalLocalidad) {
      empresaPatch.direccionFiscalLocalidad = direccionFiscalLocalidad;
      await auditarCampo("direccionFiscalLocalidad", empresaAntes.direccionFiscalLocalidad, direccionFiscalLocalidad);
    }
    if (direccionFiscalProvincia !== undefined && direccionFiscalProvincia !== empresaAntes.direccionFiscalProvincia) {
      empresaPatch.direccionFiscalProvincia = direccionFiscalProvincia;
      await auditarCampo("direccionFiscalProvincia", empresaAntes.direccionFiscalProvincia, direccionFiscalProvincia);
    }

    if (Object.keys(empresaPatch).length > 0) {
      await prisma.empresa.update({
        where: { id: empresaId },
        data: empresaPatch,
      });
    }

    // Aplicar updates Usuario (solo campos que llegaron).
    const usuarioPatch: any = {};
    if (usuarioNombre !== undefined && usuarioNombre !== usuario.nombre) {
      usuarioPatch.nombre = usuarioNombre;
      await auditarCampo("usuarioNombre", usuario.nombre, usuarioNombre);
    }
    if (usuarioTelefono !== undefined && usuarioTelefono !== usuario.telefono) {
      usuarioPatch.telefono = usuarioTelefono;
      await auditarCampo("usuarioTelefono", usuario.telefono, usuarioTelefono);
    }

    if (Object.keys(usuarioPatch).length > 0) {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: usuarioPatch,
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Datos actualizados correctamente.",
      cambiosEmpresa: Object.keys(empresaPatch),
      cambiosUsuario: Object.keys(usuarioPatch),
    });
  } catch (error: any) {
    console.error("[/api/onboarding/confirmar-datos] Error:", error);
    return NextResponse.json(
      { error: "Error interno al confirmar los datos." },
      { status: 500 }
    );
  }
}
