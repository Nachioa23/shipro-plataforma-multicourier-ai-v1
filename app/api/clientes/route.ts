import { NextResponse } from "next/server";
import prisma from "@/lib/prisma"; 
// IMPORTAMOS LA NUEVA FUNCIÓN DEL MAILER
import { enviarMailBienvenida } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";

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
    const { razonSocial, cuit, email } = body;

    if (!razonSocial || !cuit || !email) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    const passwordTemporal = "Shipro2026!";

    const nuevaEmpresa = await prisma.empresa.create({
      data: {
        nombre: razonSocial,
        cuit: cuit,
        usuarios: {
          create: {
            nombre: "Gerente",
            email: email,
            password: passwordTemporal, 
            rol: "gerente_cliente"
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
        await enviarMailBienvenida(email, razonSocial, passwordTemporal, urlLogin);
        console.log(`[Shipro] Mail de bienvenida enviado a ${email}`);
      }
    } catch (e) {
      console.warn("El correo de bienvenida no se pudo enviar, pero la empresa se creó.", e);
    }

    return NextResponse.json({ ...nuevaEmpresa, passwordTemporal });
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
      const empresa = await prisma.empresa.update({
        where: { id: parseInt(body.empresaId) },
        data: { activo: body.activo }
      });
      return NextResponse.json(empresa);
    }

    if (body.accion === 'crear_usuario') {
      const { empresaId, nombre, email, rol } = body;
      if (!empresaId || !nombre || !email || !rol) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

      const passwordTemporal = "ShiproUser123!";
      const nuevoUsuario = await prisma.usuario.create({
        data: {
          nombre, email, password: passwordTemporal, rol,
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