import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { exchangeCodeForToken } from "@/lib/tiendanube/oauth";
import { encryptSecret } from "@/lib/utils/secret-crypto";
import { enviarMailAlertaCruceTiendanube } from "@/lib/mailer";
import { registrarCarrierParaTienda } from "@/lib/tiendanube/carrier";

// DEUDA 144 — Callback OAuth de Tiendanube (Momento 1).
//
// Endpoint PÚBLICO (Tiendanube redirige el NAVEGADOR del cliente acá tras el
// authorize; no hay sesión Shipro). Se auto-protege via el token de vinculación
// que viaja en el parámetro `state` — sólo tokens generados por el operador
// Shipro (POST /api/tiendanube/install/link) tienen match en la BD.
//
// STEP 2b: valida el token de vinculación → intercambia el code por el
// access_token permanente (llamada real a Tiendanube) → decide entre CREAR
// (tienda nueva) / REINSTALAR (mismo cliente) / RECHAZAR (cruce = otra empresa
// intenta vincular una tienda ya vinculada). Camino feliz: upsert de la tienda
// + marca del token como usado, atómico ($transaction). Cruce: registra en
// AuditoriaConfiguracion y NO cambia nada (ni siquiera quema el link).
//
// El registro del carrier (POST /shipping_carriers), el mail al equipo Shipro
// en cruces, y el redirect a la página de éxito son pasos posteriores.
//
// NO marcamos el token como usado hasta que la instalación se completa con
// éxito: si el intercambio fallara, el link seguiría vivo para reintento.
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

    // 2. Intercambio del code por el access_token permanente (primera llamada real a Tiendanube).
    let exchange;
    try {
      exchange = await exchangeCodeForToken(code);
    } catch (e) {
      console.error("[/api/tiendanube/oauth/callback] intercambio falló:", e);
      // NO marcamos el token usado: el link sigue vivo, el cliente puede reintentar.
      return NextResponse.json(
        { error: "No se pudo completar la instalación con Tiendanube. Reintentá en unos minutos." },
        { status: 502 },
      );
    }
    const { accessToken, storeId } = exchange;

    // 3. ¿La tienda ya existe? Decide entre crear / reinstalar / rechazar cruce.
    const tiendaExistente = await prisma.tiendaTiendanube.findUnique({ where: { storeId } });

    // CRUCE: la tienda ya pertenece a OTRA empresa. Rechazar, registrar, NO cambiar nada, NO quemar el
    // link. La reasignación legítima (si de verdad la tienda cambió de dueño) se hace manualmente desde
    // el equipo Shipro — el sistema nunca muda una tienda de empresa por su cuenta.
    if (tiendaExistente && tiendaExistente.empresaId !== empresaId) {
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId: tiendaExistente.empresaId, // la dueña actual (la afectada)
            campo: "tiendanube:cross_install",
            valorAnterior: JSON.stringify({ storeId, empresaActual: tiendaExistente.empresaId }),
            valorNuevo: JSON.stringify({ empresaIntentada: empresaId }),
            motivo:
              "Intento de vincular una tienda ya asociada a otra empresa. Rechazado; requiere resolución manual del equipo Shipro.",
            ipOrigen: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
          },
        })
        .catch((e) => console.error("[/api/tiendanube/oauth/callback] no se pudo registrar el cruce:", e));

      // Aviso al equipo Shipro (best-effort — no rompe la respuesta al cliente). Consultamos los
      // nombres de las empresas para que el mail sea legible.
      try {
        const [empActual, empIntentada] = await Promise.all([
          prisma.empresa.findUnique({ where: { id: tiendaExistente.empresaId }, select: { nombre: true } }),
          prisma.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true } }),
        ]);
        await enviarMailAlertaCruceTiendanube({
          storeId,
          empresaActual: { id: tiendaExistente.empresaId, nombre: empActual?.nombre ?? null },
          empresaIntentada: { id: empresaId, nombre: empIntentada?.nombre ?? null },
        });
      } catch (e) {
        console.error("[/api/tiendanube/oauth/callback] no se pudo avisar al equipo del cruce:", e);
      }

      return NextResponse.json(
        { error: "Esta tienda ya está vinculada a otra cuenta de Shipro. Nuestro equipo fue notificado y se contactará con vos." },
        { status: 409 },
      );
    }

    // 4. Camino feliz (tienda nueva o reinstalación del mismo cliente): guardar + quemar el link,
    // atómico (o las dos cosas, o ninguna). El token se guarda ENCRIPTADO.
    const accessTokenEnc = encryptSecret(accessToken);
    await prisma.$transaction([
      prisma.tiendaTiendanube.upsert({
        where: { storeId },
        update: { empresaId, accessToken: accessTokenEnc, estado: "instalada", desinstaladaEn: null },
        create: { storeId, empresaId, accessToken: accessTokenEnc, estado: "instalada" },
      }),
      prisma.tokenVinculacionTiendanube.update({
        where: { id: tokenVinc.id },
        data: { usadoEn: new Date() },
      }),
    ]);

    // STEP 2b — Registrar el Shipping Carrier + sus options (best-effort). La tienda YA quedó
    // vinculada y el link consumido (arriba, atómico); esto es un paso posterior que NUNCA debe
    // romper la instalación. Si falla (Tiendanube caído, APP_URL sin setear, etc.) la tienda sigue
    // instalada y el carrier se puede reintentar más tarde. Idempotente: en reinstall reusa el
    // shippingCarrierId previo y no duplica options.
    let carrierRegistrado = false;
    try {
      const resultadoCarrier = await registrarCarrierParaTienda({
        storeId,
        empresaId,
        accessTokenCifrado: accessTokenEnc,
        shippingCarrierId: tiendaExistente?.shippingCarrierId ?? null,
      });
      // Persistir el carrierId SOLO si se creó uno nuevo (fresh install). En reinstall ya está.
      if (resultadoCarrier.carrierCreado) {
        await prisma.tiendaTiendanube.update({
          where: { storeId },
          data: { shippingCarrierId: resultadoCarrier.carrierId },
        });
      }
      carrierRegistrado = true;
      console.log(
        `[/api/tiendanube/oauth/callback] carrier OK store=${storeId} creado=${resultadoCarrier.carrierCreado} optionsNuevas=${resultadoCarrier.optionsNuevas.length}`,
      );
    } catch (e) {
      console.error("[/api/tiendanube/oauth/callback] registro del carrier best-effort falló (la tienda quedó vinculada igual):", e);
    }

    return NextResponse.json(
      { ok: true, storeId, empresaId, carrierRegistrado, debug: "STEP 2b: tienda vinculada + carrier best-effort" },
      { status: 200 },
    );
  } catch (e) {
    console.error("[/api/tiendanube/oauth/callback] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
