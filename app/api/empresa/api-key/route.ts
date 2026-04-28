import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import crypto from "crypto";
import prisma from "@/lib/prisma";

const API_KEY_PREFIX = "shipro_live_";
const ROLES_AUTORIZADOS_ROTACION = ["gerente_cliente", "admin_shipro"];

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
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

  const empresaId = token.empresaId;
  const nuevaKey = API_KEY_PREFIX + crypto.randomBytes(16).toString("hex");

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
}
