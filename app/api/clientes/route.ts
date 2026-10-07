import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
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

export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3: operador solo alta (POST); resto admin.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

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
  // DEUDA 87 FAMILIA 3: operador solo alta (POST); resto admin.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

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

    // DEUDA 132 Paso 5a (2026-08-25): la tarifa plana de respaldo YA NO se carga
    // en el onboarding de la empresa. Ahora es per-courier y se configura al dar
    // de alta cada CredencialCourier (CredencialCourier.tarifaPlanaRespaldoCourier).
    // El bloque legacy D-10-ONBOARDING-RESPALDO se removió con el drop del campo
    // per-empresa. Una empresa nueva empieza sin rescate configurado;
    // el rescate se completa por courier al armar el mix de couriers.

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
        usuarios: {
          create: {
            nombre: gerente.nombre,
            email: gerente.email,
            telefono: gerente.telefono,
            password: passwordHasheado,
            passwordTemporal: true,
            // DEUDA 96 Pieza 2: baseline del passwordChangedAt al crear.
            passwordChangedAt: new Date(),
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
  // DEUDA 87 FAMILIA 3: operador solo alta (POST); resto admin. Reject before parse.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo admin_shipro puede editar, dar de baja o gestionar usuarios." }, { status: 403 });
  }
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

    if (body.accion === 'actualizar_credito') {
      // DEUDA 176 (2026-09-29): editor post-onboarding de modalidadPago +
      // limiteDescubierto. Ambos campos son sensibles en CAMPOS_AUDITABLES
      // (motivo obligatorio). El helper `registrarCambioConfiguracion` es
      // no-op si valorAnterior === valorNuevo (skip silencioso).
      //
      // Convención "PREPAGO ⟹ límite 0" RELAJADA post-DEUDA 175 (2026-09-29):
      // el colchón funciona en PREPAGO igual que en POSTPAGO, así que un
      // PREPAGO puede tener límite > 0 como buffer de emergencia (Nacho).
      // Validación mínima:
      //   - modalidadPago: si viene, debe ser PREPAGO o POSTPAGO literales.
      //   - limiteDescubierto: si viene, debe ser número ≥ 0.
      //   - modalidad FINAL POSTPAGO exige límite > 0 (mirror del onboarding L109-114).
      const empresaIdNum = parseInt(body.empresaId);
      if (!Number.isInteger(empresaIdNum) || empresaIdNum <= 0) {
        return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
      }

      const empresaAntes = await prisma.empresa.findUnique({
        where: { id: empresaIdNum },
        select: { modalidadPago: true, limiteDescubierto: true },
      });
      if (!empresaAntes) {
        return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
      }

      // Parse defensivo — sólo se actualiza el campo que llegó.
      let modalidadNueva: string | null = null;
      if (body.modalidadPago != null) {
        if (body.modalidadPago !== "PREPAGO" && body.modalidadPago !== "POSTPAGO") {
          return NextResponse.json(
            { error: "modalidadPago debe ser PREPAGO o POSTPAGO" },
            { status: 400 }
          );
        }
        modalidadNueva = body.modalidadPago;
      }
      let limiteNuevo: number | null = null;
      if (body.limiteDescubierto != null) {
        const n = parseFloat(body.limiteDescubierto);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "limiteDescubierto debe ser número ≥ 0" },
            { status: 400 }
          );
        }
        limiteNuevo = n;
      }

      // Modalidad FINAL (nueva si vino, sino la actual).
      const modalidadFinal = modalidadNueva ?? empresaAntes.modalidadPago;
      // Límite FINAL (nuevo si vino, sino el actual — como número).
      const limiteFinal = limiteNuevo != null
        ? limiteNuevo
        : parseFloat(empresaAntes.limiteDescubierto.toString());

      if (modalidadFinal === "POSTPAGO" && limiteFinal <= 0) {
        return NextResponse.json(
          { error: "POSTPAGO requiere limite descubierto > 0" },
          { status: 400 }
        );
      }

      try {
        // Audit BEFORE update (helper throw temprano si motivo missing sobre
        // sensible). Registra sólo si el valor cambió (no-op idempotente).
        if (modalidadNueva !== null) {
          await registrarCambioConfiguracion({
            request,
            empresaId: empresaIdNum,
            campo: "modalidadPago",
            valorAnterior: empresaAntes.modalidadPago,
            valorNuevo: modalidadNueva,
            motivo: body.motivoAuditoria,
          });
        }
        if (limiteNuevo !== null) {
          await registrarCambioConfiguracion({
            request,
            empresaId: empresaIdNum,
            campo: "limiteDescubierto",
            valorAnterior: empresaAntes.limiteDescubierto.toString(),
            valorNuevo: limiteNuevo.toString(),
            motivo: body.motivoAuditoria,
          });
        }

        const dataUpdate: { modalidadPago?: string; limiteDescubierto?: Prisma.Decimal } = {};
        if (modalidadNueva !== null) dataUpdate.modalidadPago = modalidadNueva;
        if (limiteNuevo !== null) dataUpdate.limiteDescubierto = new Prisma.Decimal(limiteNuevo);

        const empresa = await prisma.empresa.update({
          where: { id: empresaIdNum },
          data: dataUpdate,
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
          empresaId: parseInt(empresaId),
          // DEUDA 96 Pieza 2: baseline del passwordChangedAt al crear.
          passwordChangedAt: new Date(),
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
  // DEUDA 87 FAMILIA 3: operador solo alta (POST); resto admin.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo admin_shipro puede editar, dar de baja o gestionar usuarios." }, { status: 403 });
  }

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