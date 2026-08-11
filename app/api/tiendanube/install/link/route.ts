import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { getTiendanubeAppIdOrThrow } from "@/lib/utils/tiendanube-config";

// DEUDA 144 — Momento 1 (Instalación OAuth): genera el link de instalación.
//
// Endpoint SESSION-AUTHED (NO está en PUBLIC_API_EXACT). El proxy valida el
// JWT de NextAuth antes de que este handler corra: si no hay sesión → 401 en
// el proxy. Acá adentro sólo chequeamos rol (mirror app/api/clientes/route.ts):
// admin_shipro / operador_shipro. Cliente no puede generar su propio link.
//
// QUÉ HACE:
// 1. Genera un token de vinculación aleatorio (192 bits) para la empresa.
// 2. Lo persiste en TokenVinculacionTiendanube con expiración a 7 días.
// 3. Arma la URL de authorize de Tiendanube con el token en `state`.
// 4. Devuelve `{ url, expira }` para que el operador copie la URL.
//
// QUÉ NO HACE:
// - No llama a Tiendanube (la URL solo se construye; el cliente hace clic).
// - No mueve plata, no crea envíos, no toca depósitos.
// - No devuelve el token suelto (ya viaja dentro de la URL en `state`).
//
// El callback (endpoint separado, futuro) valida este token cuando Tiendanube
// redirige de vuelta con ?code&state=<token>.
export async function POST(request: Request) {
  try {
    // Solo equipo Shipro (mirror app/api/clientes/route.ts). El proxy ya inyectó
    // x-rol tras validar la sesión; si no hay sesión, el proxy devolvió 401 antes
    // de llegar acá.
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
    }

    const body: any = await request.json().catch(() => null);
    const empresaId = Number(body?.empresaId);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, activo: true },
    });
    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }
    if (!empresa.activo) {
      return NextResponse.json({ error: "Empresa inactiva" }, { status: 409 });
    }

    // app_id de la app de Shipro en Tiendanube (fail-fast si falta).
    const appId = getTiendanubeAppIdOrThrow();

    // Token de vinculación: 192 bits, base64url (32 chars URL-safe). Expira en 7 días (diseño).
    const token = randomBytes(24).toString("base64url");
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.tokenVinculacionTiendanube.create({
      data: { empresaId, token, expira },
    });

    // URL de instalación. En Tiendanube, client_id / redirect / scopes están preconfigurados en la
    // app (bajo el app_id); el único parámetro dinámico es state (nuestro token).
    const url = `https://www.tiendanube.com/apps/${appId}/authorize?state=${encodeURIComponent(token)}`;

    // NO devolvemos el token suelto — ya viaja dentro de la url. El operador copia la url.
    return NextResponse.json({ url, expira }, { status: 200 });
  } catch (e) {
    console.error("[/api/tiendanube/install/link] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
