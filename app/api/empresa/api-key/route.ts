import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError
} from "@/lib/auditoria-configuracion";

const API_KEY_PREFIX = "shipro_live_";
const ROLES_AUTORIZADOS_ROTACION = ["gerente_cliente", "admin_shipro"];

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (token.empresaId === null) {
    return NextResponse.json({ error: "API Key no aplica para usuarios Shipro" }, { status: 400 });
  }

  const empresaId = token.empresaId;

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { apiKey: true, apiKeyActiva: true, apiKeyCreadaEn: true }
  });

  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  if (!empresa.apiKey) {
    return NextResponse.json({
      existe: false,
      apiKeyActiva: empresa.apiKeyActiva,
      apiKeyCreadaEn: null
    });
  }

  return NextResponse.json({
    existe: true,
    apiKeyUltimos4: empresa.apiKey.slice(-4),
    apiKeyActiva: empresa.apiKeyActiva,
    apiKeyCreadaEn: empresa.apiKeyCreadaEn
  });
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const rol = token.rol;
  if (!ROLES_AUTORIZADOS_ROTACION.includes(rol)) {
    return NextResponse.json({ error: "Rol no autorizado para rotar la API Key" }, { status: 403 });
  }

  if (token.empresaId === null) {
    return NextResponse.json({ error: "API Key no aplica para usuarios Shipro" }, { status: 400 });
  }

  const empresaId = token.empresaId;

  // DEUDA 19: motivoAuditoria opcional desde body (apiKey es sensible → motivo obligatorio).
  // Si no viene, registrarCambioConfiguracion lanzara MotivoRequeridoError → 400.
  let motivoAuditoria: string | undefined;
  try {
    const body = await request.json();
    motivoAuditoria = body?.motivoAuditoria;
  } catch {
    // Body opcional / vacio (POST tradicional sin body). Helper validara.
  }

  // DEUDA 19: read-before-write para audit log.
  const empresaAntes = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { apiKey: true }
  });

  const nuevaKey = API_KEY_PREFIX + crypto.randomBytes(16).toString("hex");

  try {
    // DEUDA 19: auditar ANTES del update (si motivo falta, throw temprano, no se rota).
    if (empresaAntes) {
      await registrarCambioConfiguracion({
        request,
        empresaId,
        campo: "apiKey",
        valorAnterior: empresaAntes.apiKey,
        valorNuevo: nuevaKey,
        motivo: motivoAuditoria,
      });
    }

    const empresa = await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        apiKey: nuevaKey,
        apiKeyCreadaEn: new Date(),
        apiKeyActiva: true
      },
      select: { apiKey: true, apiKeyCreadaEn: true, apiKeyActiva: true }
    });

    // ESTA ES LA ÚNICA VEZ QUE LA KEY COMPLETA SE EXPONE.
    // GET solo devuelve los últimos 4 chars. Si el cliente la pierde, debe regenerar (la nueva invalida esta).
    return NextResponse.json({
      apiKey: empresa.apiKey,
      apiKeyCreadaEn: empresa.apiKeyCreadaEn,
      apiKeyActiva: empresa.apiKeyActiva
    });
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
