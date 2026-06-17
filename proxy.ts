import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";

const PUBLIC_API_PREFIXES = ["/api/auth/"];
const PUBLIC_API_EXACT = [
  "/api/nps",
  "/api/nps/comentario",
  "/api/nps-empresa",
  "/api/envios/rastreo-manual",
  "/api/envios/corregir",
  "/api/geografia/buscar",
];
const API_KEY_EXACT = [
  "/api/checkouts",
];
const DUAL_EXACT = [
  "/api/cotizar",
  "/api/envios/sucursales",
  "/api/envios/cancelar",
  "/api/envios/inversa",
  "/api/envios/buscar",
  "/api/checkouts/evaluar",
];
const CRON_PREFIX = "/api/cron/";

type Kind = "public" | "cron" | "apiKey" | "session" | "dual";

function classify(path: string, method: string): Kind {
  if (PUBLIC_API_PREFIXES.some(p => path.startsWith(p))) return "public";
  if (PUBLIC_API_EXACT.includes(path)) return "public";
  if (path.startsWith(CRON_PREFIX)) return "cron";
  // /api/envios: GET y PUT son sesión (dashboard listing/manifiestos);
  // POST es API Key (e-commerces). El dashboard usa /api/envios/manual.
  if (path === "/api/envios") return method === "POST" ? "apiKey" : "session";
  if (path === "/api/envios/manual") return "session";
  if (DUAL_EXACT.includes(path)) return "dual";
  if (API_KEY_EXACT.includes(path)) return "apiKey";
  return "session";
}

type AuthResult =
  | { ok: true; empresaId: number | null; mode: "apiKey" | "session"; rol?: string; email?: string }
  | { ok: false; response: NextResponse };

async function authByApiKey(authHeader: string): Promise<AuthResult> {
  const match = authHeader.match(/^Bearer\s+(shipro_live_\S+)$/);
  if (!match) {
    return { ok: false, response: NextResponse.json({ error: "API Key requerida" }, { status: 401 }) };
  }
  const empresa = await prisma.empresa.findUnique({
    where: { apiKey: match[1] },
    select: { id: true, activo: true, apiKeyActiva: true }
  });
  if (!empresa || !empresa.apiKeyActiva || !empresa.activo) {
    return { ok: false, response: NextResponse.json({ error: "API Key inválida o empresa inactiva" }, { status: 401 }) };
  }
  // DEUDA 19: rol="apikey" para distinguir audit logs de origen API vs sesion UI.
  // email queda undefined intencionalmente (apiKey es a nivel empresa, no usuario).
  return { ok: true, empresaId: empresa.id, mode: "apiKey", rol: "apikey" };
}

async function authBySession(request: NextRequest): Promise<AuthResult> {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  if (token.empresaId === null) {
    // Usuario shipro (Modo Dios). No pertenece a empresa, no aplica check de empresa activa.
    // DEUDA 19: email preservado por NextAuth default JWT (viene del authorize() en lib/auth.ts).
    return { ok: true, empresaId: null, mode: "session", rol: token.rol, email: token.email ?? undefined };
  }
  const empresa = await prisma.empresa.findUnique({
    where: { id: token.empresaId },
    select: { activo: true }
  });
  if (!empresa?.activo) {
    return { ok: false, response: NextResponse.json({ error: "Empresa deshabilitada" }, { status: 401 }) };
  }
  return { ok: true, empresaId: token.empresaId, mode: "session", rol: token.rol, email: token.email ?? undefined };
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const method = request.method;
  const auth = request.headers.get("authorization") || "";
  const kind = classify(path, method);

  if (kind === "public") return NextResponse.next();

  if (kind === "cron") {
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    if (!process.env.CRON_SECRET || auth !== expected) {
      return NextResponse.json({ error: "Cron secret inválido" }, { status: 401 });
    }
    return NextResponse.next();
  }

  let authResult: AuthResult;

  if (kind === "apiKey") {
    authResult = await authByApiKey(auth);
  } else if (kind === "session") {
    authResult = await authBySession(request);
  } else {
    // kind === "dual": si vino Bearer shipro_live_..., probamos api key; sino, session.
    // Un Bearer mal formado o con otro prefijo NO sirve como api key, cae a session
    // (que pedirá cookie de NextAuth y fallará si no la hay).
    const looksLikeApiKey = /^Bearer\s+shipro_live_/.test(auth);
    authResult = looksLikeApiKey
      ? await authByApiKey(auth)
      : await authBySession(request);
  }

  if (!authResult.ok) return authResult.response;

  const headers = new Headers(request.headers);
  headers.set("x-empresa-id", authResult.empresaId === null ? "SHIPRO" : String(authResult.empresaId));
  headers.set("x-auth-mode", authResult.mode);
  if (authResult.rol) headers.set("x-rol", authResult.rol);

  // DEUDA 19: inyectar x-usuario-email para audit log (solo en session — apiKey va sin email).
  if (authResult.email) headers.set("x-usuario-email", authResult.email);

  // DEUDA 19: inyectar x-ip-origen canonico (split por coma para tomar primer IP de la chain).
  const ipRaw = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
  if (ipRaw) {
    const ipFirst = ipRaw.split(",")[0].trim();
    if (ipFirst) headers.set("x-ip-origen", ipFirst);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
