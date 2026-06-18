import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError
} from "@/lib/auditoria-configuracion";
import { generateApiKey } from "@/lib/utils/apikey-hash";

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

  // TECH 1: apiKey plain ya no se almacena. Usamos apiKeyHash (existence check)
  // + apiKeyUltimos4 (display) directamente desde BD.
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      apiKeyHash: true,
      apiKeyUltimos4: true,
      apiKeyActiva: true,
      apiKeyCreadaEn: true,
    }
  });

  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  if (!empresa.apiKeyHash) {
    return NextResponse.json({
      existe: false,
      apiKeyActiva: empresa.apiKeyActiva,
      apiKeyCreadaEn: null
    });
  }

  return NextResponse.json({
    existe: true,
    apiKeyUltimos4: empresa.apiKeyUltimos4,
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

  // TECH 1: read-before-write para audit log (DEUDA 19).
  // Solo necesitamos apiKeyHash para detectar si habia key previa (audit non-op skip).
  const empresaAntes = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { apiKeyHash: true }
  });

  // TECH 1: generar nueva apiKey + hash + ultimos4.
  // El plain solo se devuelve UNA VEZ al cliente, nunca se almacena.
  const { plain: nuevaKey, hash: nuevoHash, ultimos4 } = generateApiKey();

  try {
    // DEUDA 19: auditar ANTES del update (si motivo falta, throw temprano, no se rota).
    // valorAnterior y valorNuevo son los hashes (helper los redacta a "***XXXX").
    if (empresaAntes) {
      await registrarCambioConfiguracion({
        request,
        empresaId,
        campo: "apiKey",
        valorAnterior: empresaAntes.apiKeyHash,
        valorNuevo: nuevoHash,
        motivo: motivoAuditoria,
      });
    }

    const empresa = await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        apiKeyHash: nuevoHash,
        apiKeyUltimos4: ultimos4,
        apiKeyCreadaEn: new Date(),
        apiKeyActiva: true
      },
      select: { apiKeyUltimos4: true, apiKeyCreadaEn: true, apiKeyActiva: true }
    });

    // ESTA ES LA ÚNICA VEZ QUE LA KEY COMPLETA SE EXPONE.
    // GET solo devuelve los últimos 4 chars desde BD. Si el cliente la pierde,
    // debe regenerar (la nueva invalida esta porque el hash cambia).
    return NextResponse.json({
      apiKey: nuevaKey,
      apiKeyUltimos4: empresa.apiKeyUltimos4,
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
