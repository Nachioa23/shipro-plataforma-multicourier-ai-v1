// ============================================================================
// /api/mi-equipo — endpoints para que el gerente_cliente maneje su equipo
//
// DEUDA 17.F.2 (2026-06-23):
//   GET  → lista operadores de la empresa del gerente.
//   POST → crear nuevo operador en la empresa del gerente.
//
// Auth: solo gerente_cliente. Empresa scope: cada gerente solo ve/maneja su
// propia empresa (filtro automatico por x-empresa-id del proxy.ts).
//
// Password temporal random (igual que /api/clientes), mail bienvenida igual.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validarWhatsApp, generarPasswordTemporal } from "@/lib/utils/validaciones-onboarding";

// Helper: extraer y validar headers de autenticacion.
function obtenerAuth(request: Request) {
  const emailUsuario = request.headers.get("x-usuario-email");
  const empresaIdHeader = request.headers.get("x-empresa-id");
  const rol = request.headers.get("x-rol");

  if (!emailUsuario || !empresaIdHeader) return null;
  return {
    email: emailUsuario,
    empresaId: parseInt(empresaIdHeader),
    rol: rol || "",
  };
}

// ============================================================================
// GET — lista operadores de la empresa del gerente
// ============================================================================
export async function GET(request: Request) {
  try {
    const auth = obtenerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (auth.rol !== "gerente_cliente") {
      return NextResponse.json({ error: "Solo el gerente puede acceder a su equipo." }, { status: 403 });
    }

    const operadores = await prisma.usuario.findMany({
      where: {
        empresaId: auth.empresaId,
        rol: "operador_cliente",
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        activo: true,
        passwordTemporal: true,
      },
      orderBy: [
        { activo: "desc" },  // activos primero
        { id: "desc" },      // mas nuevos primero dentro de cada grupo
      ],
    });

    return NextResponse.json({ operadores });
  } catch (error: any) {
    console.error("[GET /api/mi-equipo] Error:", error);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}

// ============================================================================
// POST — crear nuevo operador en la empresa del gerente
// ============================================================================
export async function POST(request: Request) {
  try {
    const auth = obtenerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (auth.rol !== "gerente_cliente") {
      return NextResponse.json({ error: "Solo el gerente puede agregar operadores." }, { status: 403 });
    }

    const body = await request.json();
    const { nombre, email, telefono } = body;

    // Validaciones.
    if (!nombre || !email || !telefono) {
      return NextResponse.json({ error: "Nombre, email y telefono son obligatorios." }, { status: 400 });
    }
    if (!validarWhatsApp(telefono)) {
      return NextResponse.json({ error: "Telefono debe ser WhatsApp formato +5491134567890." }, { status: 400 });
    }
    if (!email.includes("@")) {
      return NextResponse.json({ error: "Email invalido." }, { status: 400 });
    }

    // Email unico (no puede repetirse en TODA la plataforma).
    const existente = await prisma.usuario.findUnique({ where: { email } });
    if (existente) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email." }, { status: 409 });
    }

    // Generar password random + hashear.
    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await bcrypt.hash(passwordTemporal, 10);

    const operador = await prisma.usuario.create({
      data: {
        nombre,
        email,
        telefono,
        password: passwordHash,
        rol: "operador_cliente",
        empresaId: auth.empresaId,
        passwordTemporal: true,
        activo: true,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        activo: true,
      },
    });

    return NextResponse.json({
      operador,
      passwordTemporal,  // Devolver al gerente para que comparta con el operador via WhatsApp.
    });
  } catch (error: any) {
    console.error("[POST /api/mi-equipo] Error:", error);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
