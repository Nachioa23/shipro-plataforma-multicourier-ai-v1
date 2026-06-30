import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
// IMPORTAMOS LA NUEVA FUNCIÓN DEL MAILER
import { enviarMailBienvenida } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError
} from "@/lib/auditoria-configuracion";
import {
  validarCUIT,
  validarWhatsApp,
  generarPasswordTemporal,
} from "@/lib/utils/validaciones-onboarding";

export async function GET() {
  try {
    const empresas = await prisma.empresa.findMany({
      include: {
        usuarios: true 
      },
      orderBy: { createdAt: 'desc' } 
    });
    return NextResponse.json(empresas);
  } catch (error) {
    return NextResponse.json({ error: "Error al cargar clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      razonSocial,
      cuit,
      direccionFiscalCalle,
      direccionFiscalAltura,
      direccionFiscalCP,
      direccionFiscalLocalidad,
      direccionFiscalProvincia,
      modalidadPago,
      limiteDescubierto,
      modeloAHabilitado,
      gerente,
      notasInternas,
      tarifaPlanaRespaldo,
      operacionFeeTipo,
      operacionFeeValor,
    } = body;

    // DEUDA 17: validacion de campos obligatorios Fase A.
    if (!razonSocial || !cuit) {
      return NextResponse.json({ error: "Razon social y CUIT son obligatorios" }, { status: 400 });
    }

    const cuitLimpio = validarCUIT(cuit);
    if (!cuitLimpio) {
      return NextResponse.json(
        { error: "CUIT invalido. Debe tener 11 digitos." },
        { status: 400 }
      );
    }

    if (!direccionFiscalCalle || !direccionFiscalAltura || !direccionFiscalCP ||
        !direccionFiscalLocalidad || !direccionFiscalProvincia) {
      return NextResponse.json(
        { error: "Direccion fiscal incompleta (calle, altura, CP, localidad, provincia obligatorios)" },
        { status: 400 }
      );
    }

    if (!gerente || !gerente.nombre || !gerente.email || !gerente.telefono) {
      return NextResponse.json(
        { error: "Datos del gerente incompletos (nombre, email, telefono obligatorios)" },
        { status: 400 }
      );
    }

    if (!validarWhatsApp(gerente.telefono)) {
      return NextResponse.json(
        { error: "Telefono del gerente debe ser WhatsApp internacional estricto (+5491134567890)" },
        { status: 400 }
      );
    }

    const modalidadFinal = modalidadPago === "POSTPAGO" ? "POSTPAGO" : "PREPAGO";

    // DEUDA 10 Paso 5a (D-10-ONBOARDING-DESCUBIERTO): descubierto minimo estandar
    // para PREPAGO ($50.000, colchon de fin de semana mientras se verifica la
    // recarga manual — ver DEUDA 78). POSTPAGO usa el valor que ingresa el admin.
    const MIN_DESCUBIERTO_PREPAGO = 50000;
    const limiteIngresado = parseFloat(limiteDescubierto) || 0;
    const limiteFinal = modalidadFinal === "POSTPAGO"
      ? limiteIngresado
      : Math.max(limiteIngresado, MIN_DESCUBIERTO_PREPAGO);

    if (modalidadFinal === "POSTPAGO" && limiteFinal <= 0) {
      return NextResponse.json(
        { error: "POSTPAGO requiere limite descubierto > 0" },
        { status: 400 }
      );
    }

    // DEUDA 10 Paso 5a (D-10-ONBOARDING-RESPALDO): tarifaPlanaRespaldo OBLIGATORIA.
    // Es el ultimo recurso de precio del fallback (la venta nunca se cae). Nullable
    // en BD por compat, pero obligatoria aca (mismo patron que direccion fiscal).
    const tarifaRespaldoNum = parseFloat(tarifaPlanaRespaldo);
    if (!tarifaRespaldoNum || tarifaRespaldoNum <= 0) {
      return NextResponse.json(
        { error: "Tarifa plana de respaldo obligatoria (mayor a cero). Es el precio de ultimo recurso si el courier falla." },
        { status: 400 }
      );
    }

    // DEUDA 10 Paso 5a (D-10-ONBOARDING-FEE): OperacionFee del cliente.
    // tipo FIJO (default) o PORCENTAJE. valor PRE-IVA (el sistema suma 21% al debitar).
    // Default 1600 (estandar); el admin lo baja a 800 por convenio de descuento.
    // El motor de actualizacion global y descuentos con vencimiento son DEUDA 72.
    const FEE_OPERACION_DEFAULT = 1600;
    const feeTipoFinal = operacionFeeTipo === "PORCENTAJE" ? "PORCENTAJE" : "FIJO";
    const feeValorNum = operacionFeeValor != null && operacionFeeValor !== ""
      ? parseFloat(operacionFeeValor)
      : FEE_OPERACION_DEFAULT;
    if (!feeValorNum || feeValorNum <= 0) {
      return NextResponse.json(
        { error: "Fee de operacion invalido (sin IVA, mayor a cero)." },
        { status: 400 }
      );
    }

    // DEUDA 17 B1: password temporal random (cada cliente recibe uno unico).
    const passwordTemporalPlain = generarPasswordTemporal();
    const passwordHasheado = await bcrypt.hash(passwordTemporalPlain, 10);

    const nuevaEmpresa = await prisma.empresa.create({
      data: {
        nombre: razonSocial,
        cuit: cuitLimpio,
        direccionFiscalCalle,
        direccionFiscalAltura,
        direccionFiscalCP,
        direccionFiscalLocalidad,
        direccionFiscalProvincia,
        modalidadPago: modalidadFinal,
        limiteDescubierto: limiteFinal,
        modeloAHabilitado: modeloAHabilitado === true,
        notasInternas: notasInternas || null,
        tarifaPlanaRespaldo: tarifaRespaldoNum,
        usuarios: {
          create: {
            nombre: gerente.nombre,
            email: gerente.email,
            telefono: gerente.telefono,
            password: passwordHasheado,
            passwordTemporal: true,
            rol: "gerente_cliente"
          }
        },
        operacionFees: {
          create: {
            tipo: feeTipoFinal,
            valor: feeValorNum,
            activo: true
          }
        }
      },
      include: { usuarios: true }
    });

    // ¡DISPARAMOS EL NUEVO EMAIL DE ONBOARDING AUTOMÁTICO!
    // DEUDA 14: si APP_URL no esta configurada, skip el mail con warn.
    // La empresa ya esta creada — no rompemos el onboarding por config faltante.
    try {
      const baseUrl = getAppUrl();
      if (baseUrl) {
        const urlLogin = `${baseUrl}/login`;
        await enviarMailBienvenida(gerente.email, razonSocial, passwordTemporalPlain, urlLogin);
        console.log(`[Shipro] Mail de bienvenida enviado a ${gerente.email}`);
      }
    } catch (e) {
      console.warn("El correo de bienvenida no se pudo enviar, pero la empresa se creó.", e);
    }

    return NextResponse.json({ ...nuevaEmpresa, passwordTemporal: passwordTemporalPlain });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "El CUIT o el Email ya están registrados en el sistema." }, { status: 400 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    if (body.accion === 'toggle_activo') {
      const empresaIdNum = parseInt(body.empresaId);

      // DEUDA 19: read-before-write para audit log.
      const empresaAntes = await prisma.empresa.findUnique({
        where: { id: empresaIdNum },
        select: { activo: true }
      });

      try {
        // DEUDA 19: audit ANTES del update (throw temprano si motivo missing).
        if (empresaAntes) {
          await registrarCambioConfiguracion({
            request,
            empresaId: empresaIdNum,
            campo: "activo",
            valorAnterior: empresaAntes.activo,
            valorNuevo: body.activo,
            motivo: body.motivoAuditoria,
          });
        }

        const empresa = await prisma.empresa.update({
          where: { id: empresaIdNum },
          data: { activo: body.activo }
        });
        return NextResponse.json(empresa);
      } catch (error: any) {
        if (error instanceof MotivoRequeridoError) {
          return NextResponse.json(
            { error: error.message, code: "MOTIVO_AUDITORIA_REQUERIDO" },
            { status: 400 }
          );
        }
        throw error;
      }
    }

    if (body.accion === 'crear_usuario') {
      const { empresaId, nombre, email, rol } = body;
      if (!empresaId || !nombre || !email || !rol) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

      const passwordTemporal = "ShiproUser123!";
      // QW (2026-06-18): hashear password antes de almacenar (login usa bcrypt.compare).
      const passwordHasheado = await bcrypt.hash(passwordTemporal, 10);
      const nuevoUsuario = await prisma.usuario.create({
        data: {
          nombre, email, password: passwordHasheado, rol,
          empresaId: parseInt(empresaId)
        }
      });

      // ¡DISPARAMOS EL EMAIL AUTOMÁTICO PARA USUARIOS NUEVOS!
      // DEUDA 14: si APP_URL no esta configurada, skip el mail con warn.
      // El usuario ya esta creado — no rompemos el alta por config faltante.
      try {
        const baseUrl = getAppUrl();
        if (baseUrl) {
          const urlLogin = `${baseUrl}/login`;
          await enviarMailBienvenida(email, nombre, passwordTemporal, urlLogin);
          console.log(`[Shipro] Mail de nuevo acceso enviado a ${email}`);
        }
      } catch (e) {
        console.warn("El correo de nuevo usuario no se pudo enviar.", e);
      }

      return NextResponse.json({ ...nuevoUsuario, passwordTemporal });
    }

    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: "Ese correo ya existe en el sistema." }, { status: 400 });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "Falta ID del usuario" }, { status: 400 });

    await prisma.usuario.delete({
      where: { id: parseInt(id) }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 });
  }
}