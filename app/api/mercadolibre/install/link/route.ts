import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { crearInstallLinkMercadoLibre } from "@/lib/mercadolibre/install-link";

// MEF Fase 1 step 3 — Momento 1 (Instalación OAuth): genera el link de
// instalación para Mercado Libre. Mirror byte-a-byte del twin Tiendanube
// (app/api/tiendanube/install/link/route.ts).
//
// Endpoint SESSION-AUTHED (NO está en PUBLIC_API_EXACT). El proxy valida el
// JWT de NextAuth antes de que este handler corra: si no hay sesión → 401 en
// el proxy. Acá adentro sólo chequeamos rol: admin_shipro / operador_shipro.
// Cliente no puede generar su propio link.
//
// QUÉ HACE:
// 1. Genera un token de vinculación aleatorio (192 bits) para la empresa.
// 2. Lo persiste en TokenVinculacionMercadoLibre con expiración a 7 días.
// 3. Arma la URL de authorize de ML con:
//    - response_type=code
//    - client_id=MERCADOLIBRE_CLIENT_ID
//    - redirect_uri=<APP_URL>/api/mercadolibre/oauth/callback  (byte-idéntico al que
//      va a usar el callback en el intercambio del code — ML requiere match exacto)
//    - state=<token>  (nuestro token de vinculación, para resolver empresaId en el callback)
//    - scope=offline_access read write  (offline_access habilita el refresh_token; sin él
//      el server-to-server refresh no funciona)
// 4. Devuelve { url, expira } — mismo shape que el twin Tiendanube.
//
// QUÉ NO HACE:
// - No llama a Mercado Libre (la URL solo se construye; el seller hace clic).
// - No mueve plata, no crea envíos, no toca depósitos.
// - No devuelve el token suelto (ya viaja dentro de la URL en `state`).
//
// El callback (GET /api/mercadolibre/oauth/callback) valida este token cuando
// ML redirige de vuelta con ?code&state=<token>, hace el intercambio, y sólo
// entonces (en el happy path atómico) marca usadoEn.
export async function POST(request: Request) {
  try {
    // Solo equipo Shipro (mirror del twin Tiendanube). El proxy ya inyectó
    // x-rol tras validar la sesión; si no hay sesión, el proxy devolvió 401
    // antes de llegar acá.
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return NextResponse.json(
        { error: "Acceso denegado. Solo equipo Shipro." },
        { status: 403 },
      );
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

    // Core: token + URL de authorize. Delegado al helper compartido con
    // el endpoint self-service `/api/empresa/mercadolibre/connect`. El gate
    // operador de arriba queda intacto — el helper NO valida auth, solo hace
    // el core (env guards + token + URL).
    const { url, expira } = await crearInstallLinkMercadoLibre(empresaId);

    // NO devolvemos el token suelto — ya viaja dentro de la url. El operador
    // copia la url (o la manda por mail en piezas posteriores).
    return NextResponse.json({ url, expira }, { status: 200 });
  } catch (e) {
    console.error("[/api/mercadolibre/install/link] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
