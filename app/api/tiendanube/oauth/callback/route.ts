import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 144 — Callback OAuth de Tiendanube (Momento 1).
//
// Endpoint PÚBLICO (Tiendanube redirige el NAVEGADOR del cliente acá tras el
// authorize; no hay sesión Shipro). Se auto-protege via el token de vinculación
// que viaja en el parámetro `state` — sólo tokens generados por el operador
// Shipro (POST /api/tiendanube/install/link) tienen match en la BD.
//
// STEP 1 (esqueleto): sólo VALIDA el token de vinculación. El intercambio del
// code por el access_token, la persistencia de TiendaTiendanube, el registro
// del carrier (POST /shipping_carriers) y el redirect a la página de éxito
// vienen en los pasos siguientes. Devolvemos JSON de debug por ahora.
//
// NO marcamos el token como usado acá — eso pasa recién cuando la instalación
// se completa con éxito (paso posterior). Si lo quemáramos ahora y el
// intercambio fallara, el link quedaría inservible sin haber vinculado nada.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    // Sin code o state: request inválido o el cliente canceló la autorización en Tiendanube.
    if (!code || !state) {
      return NextResponse.json({ error: "Faltan parámetros de la instalación" }, { status: 400 });
    }

    // Validar el token de vinculación (state): existe + no expiró + no se usó.
    // Mismo espíritu que el correccionToken de Envio (compound check). NO lo marcamos usado
    // acá — eso pasa recién cuando la instalación se completa con éxito (paso posterior);
    // si lo quemáramos ahora, un fallo del intercambio dejaría el link inservible.
    const tokenVinc = await prisma.tokenVinculacionTiendanube.findUnique({
      where: { token: state },
    });
    if (!tokenVinc || tokenVinc.usadoEn !== null || tokenVinc.expira < new Date()) {
      return NextResponse.json(
        { error: "Link de instalación inválido, vencido o ya usado" },
        { status: 400 },
      );
    }

    const empresaId = tokenVinc.empresaId;

    // STEP 1 (esqueleto): hasta acá validamos el link. El intercambio del code por el
    // access_token, la persistencia de la tienda, y el registro del carrier vienen en los
    // pasos siguientes. Por ahora devolvemos un JSON de debug (se reemplaza por el flujo real
    // + redirect a la página de éxito).
    return NextResponse.json(
      {
        ok: true,
        debug: "STEP 1: token de vinculación válido",
        empresaId,
        // No exponemos el code completo en la respuesta (es un secreto de corta vida).
        codePreview: code.slice(0, 6) + "…",
      },
      { status: 200 },
    );
  } catch (e) {
    console.error("[/api/tiendanube/oauth/callback] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
