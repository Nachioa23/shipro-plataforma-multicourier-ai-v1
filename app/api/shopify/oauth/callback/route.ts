import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { exchangeCodeForTokenShopify } from "@/lib/shopify/oauth";
import { isValidShopDomain, verifyShopifyOAuthHmac } from "@/lib/shopify/oauth-verify";
import { encryptSecret } from "@/lib/utils/secret-crypto";
import { hashApiKey } from "@/lib/utils/apikey-hash";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { registrarCarrierServiceShopify } from "@/lib/shopify/carrier-service";
import { registrarWebhooksShopify } from "@/lib/shopify/webhooks-registro";

// Shopify Fase 1 — Callback OAuth (espejo del callback de Tiendanube + deltas Shopify).
//
// Endpoint PÚBLICO (Shopify redirige el NAVEGADOR del merchant acá; no hay
// sesión Shipro). Autoprotección:
//   1. hmac verificado contra SHOPIFY_API_SECRET (Shopify firma el redirect).
//   2. Token de vinculación en `state` — sólo tokens generados por el operador
//      Shipro (POST /api/shopify/install/link) tienen match en la BD.
//   3. shopDomain validado + chequeado contra el shopDomain del token (anti
//      link-hijack: si el token se filtra, sólo sirve para ESE shop).
//
// Flujo (orden consciente — token NO se quema hasta éxito del exchange):
//   1. Params presentes + shopDomain válido + hmac verificado.
//   2. Token de vinculación válido (existe + no usado + no expirado + shop match).
//   3. Exchange code → access_token (try/catch; si falla, 502 + NO quemar).
//   4. Cruce con tiendaShopify existente: si pertenece a otra empresa → 409 +
//      AuditoriaConfiguracion + NO quemar.
//   5. Camino feliz: $transaction atómico (upsert TiendaShopify + quemar token).
//   6. Upsert Conexion best-effort (hub DEUDA 150, SHOPIFY).
//   7. Fase 2: enriquecer nombre/dominio via GET /shop + registrar CarrierService.
//      Fase 4: registrar webhooks. Hoy TODO stub comentado.
//   8. Redirect a /shopify/instalado?shop={shop} via getAppUrlOrThrow (NO
//      request.url: nginx proxya pm.shipro.pro → localhost:3000).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const shop = searchParams.get("shop");
    const state = searchParams.get("state");
    const hmac = searchParams.get("hmac");

    // Sin alguno de los 4: request inválido o merchant canceló el authorize.
    if (!code || !shop || !state || !hmac) {
      return NextResponse.json({ error: "Faltan parámetros de la instalación" }, { status: 400 });
    }

    // Shopify-only check (vs TN): el shop debe matchear el formato esperado
    // ANTES de verificar el HMAC — si no lo matchea, no es un redirect real
    // de Shopify.
    if (!isValidShopDomain(shop)) {
      return NextResponse.json({ error: "shop inválido" }, { status: 400 });
    }

    // Verificar el HMAC con SHOPIFY_API_SECRET. Si no verifica, el redirect
    // fue fabricado o alterado — rechazar.
    if (!verifyShopifyOAuthHmac(searchParams)) {
      return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
    }

    // Validar el token de vinculación: existe + no usado + no expirado + emitido
    // para ESTE shop. El shopDomain-match es la defensa anti-link-hijack que
    // pidió Núcleo: si el token se filtra, sólo sirve para su propio shop.
    const tokenVinc = await prisma.tokenVinculacionShopify.findUnique({
      where: { token: state },
    });
    if (
      !tokenVinc ||
      tokenVinc.usadoEn !== null ||
      tokenVinc.expira < new Date() ||
      tokenVinc.shopDomain !== shop
    ) {
      return NextResponse.json(
        { error: "Link de instalación inválido, vencido, ya usado o emitido para otro shop" },
        { status: 400 },
      );
    }

    const empresaId = tokenVinc.empresaId;

    // Intercambio del code por el access_token offline permanente. Primera
    // llamada real a Shopify. Si falla, NO quemar el token: el link sigue
    // vivo para que el merchant reintente.
    let exchange;
    try {
      exchange = await exchangeCodeForTokenShopify(shop, code);
    } catch (e) {
      console.error("[/api/shopify/oauth/callback] intercambio falló:", e);
      return NextResponse.json(
        { error: "No se pudo completar la instalación con Shopify. Reintentá en unos minutos." },
        { status: 502 },
      );
    }
    const { accessToken } = exchange;

    // Cruce: ¿la tienda ya existe asociada a otra empresa? Rechazar + registrar,
    // NO cambiar nada, NO quemar el link. La reasignación legítima se hace a
    // mano desde el equipo Shipro — nunca mudamos una tienda por nuestra cuenta.
    const tiendaExistente = await prisma.tiendaShopify.findUnique({
      where: { shopDomain: shop },
    });
    if (tiendaExistente && tiendaExistente.empresaId !== empresaId) {
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId: tiendaExistente.empresaId, // la dueña actual (afectada)
            campo: "shopify:cross_install",
            valorAnterior: JSON.stringify({
              shopDomain: shop,
              empresaActual: tiendaExistente.empresaId,
            }),
            valorNuevo: JSON.stringify({ empresaIntentada: empresaId }),
            motivo:
              "Intento de vincular una tienda Shopify ya asociada a otra empresa. Rechazado; requiere resolución manual del equipo Shipro.",
            ipOrigen:
              request.headers.get("x-forwarded-for") ??
              request.headers.get("x-real-ip") ??
              null,
          },
        })
        .catch((e) =>
          console.error("[/api/shopify/oauth/callback] no se pudo registrar el cruce:", e),
        );
      // TODO Fase 2: mail de alerta al equipo Shipro (patrón enviarMailAlertaCruceTiendanube).
      return NextResponse.json(
        {
          error:
            "Esta tienda ya está vinculada a otra cuenta de Shipro. Nuestro equipo fue notificado y se contactará con vos.",
        },
        { status: 409 },
      );
    }

    // Camino feliz: guardar la tienda + quemar el link, atómico (ambos o
    // ninguno). El token se cifra con secret-crypto antes de persistirse.
    const accessTokenEnc = encryptSecret(accessToken);
    await prisma.$transaction([
      prisma.tiendaShopify.upsert({
        where: { shopDomain: shop },
        update: {
          empresaId,
          accessToken: accessTokenEnc,
          estado: "instalada",
          desinstaladaEn: null,
        },
        create: {
          shopDomain: shop,
          empresaId,
          accessToken: accessTokenEnc,
          estado: "instalada",
        },
      }),
      prisma.tokenVinculacionShopify.update({
        where: { id: tokenVinc.id },
        data: { usadoEn: new Date() },
      }),
    ]);

    // HUB DEUDA 150: registrar la Conexion SHOPIFY. BEST-EFFORT — si falla, la
    // instalación de la tienda NO se rompe (ya commiteó arriba). Mismo patrón
    // que TN. referenciaExterna = shopDomain (análogo a storeId en TN).
    try {
      await prisma.conexion.upsert({
        where: { empresaId_plataforma: { empresaId, plataforma: "SHOPIFY" } },
        update: {
          estado: "ACTIVA",
          referenciaExterna: shop,
          mecanismo: "OAUTH",
        },
        create: {
          empresaId,
          plataforma: "SHOPIFY",
          mecanismo: "OAUTH",
          estado: "ACTIVA",
          referenciaExterna: shop,
        },
      });
    } catch (err) {
      console.error(
        "[shopify/oauth/callback] Conexion upsert best-effort falló (la tienda ya se instaló, no se rompe):",
        err,
      );
    }

    // TODO Fase 2: enriquecer nombre + dominio via GET /shop (best-effort,
    // mismo patrón que obtenerDatosTienda de TN).

    // Shopify Fase 2 — Registrar/update CarrierService (rates callback).
    // Best-effort: NUNCA debe romper el install. En reinstall siempre se regenera
    // el token (el hash viejo se pisa) + se re-registra el CarrierService con la
    // nueva callbackUrl. Si falla por plan insuficiente u otro error, la tienda
    // queda vinculada igual; el fallo va a AuditoriaConfiguracion para que el
    // equipo Shipro lo vea y acompañe al merchant con el upgrade de plan.
    try {
      const rateCallbackTokenPlano =
        "shipro_shopify_rates_" + randomBytes(24).toString("base64url");
      const rateCallbackTokenHash = hashApiKey(rateCallbackTokenPlano);

      // Persistir SOLO el hash antes de llamar a Shopify. Si el registro del
      // CarrierService fallara, el hash viejo queda pisado — el merchant tendrá
      // que reintentar (regenerar). Alternativa: persistir después → riesgo de
      // dejar el CarrierService en Shopify apuntando a un token que no
      // podemos validar. Mejor "token huérfano del lado nuestro" que "callback
      // activo sin side-match".
      await prisma.tiendaShopify.update({
        where: { shopDomain: shop },
        data: { rateCallbackTokenHash },
      });

      const resultadoCarrier = await registrarCarrierServiceShopify({
        shop,
        accessTokenCifrado: accessTokenEnc,
        rateCallbackTokenPlano,
        carrierServiceIdPrevio: tiendaExistente?.carrierServiceId ?? null,
      });

      if (resultadoCarrier.ok) {
        await prisma.tiendaShopify.update({
          where: { shopDomain: shop },
          data: { carrierServiceId: resultadoCarrier.carrierServiceId },
        });
        console.log(
          `[/api/shopify/oauth/callback] carrier OK shop=${shop} creado=${resultadoCarrier.creado} id=${resultadoCarrier.carrierServiceId}`,
        );
      } else {
        // motivo: "plan" — la tienda está en Basic / Starter y no puede activar
        // CarrierService. No es un bug nuestro — queda registrado para que el
        // equipo Shipro acompañe al merchant con el upgrade.
        console.warn(
          `[/api/shopify/oauth/callback] carrier NO disponible (plan) shop=${shop}: ${resultadoCarrier.detalle}`,
        );
        await prisma.auditoriaConfiguracion
          .create({
            data: {
              empresaId,
              campo: "shopify:carrier_register_failed",
              valorAnterior: JSON.stringify({ shop, motivo: "plan" }),
              valorNuevo: JSON.stringify({ detalle: resultadoCarrier.detalle.slice(0, 500) }),
              motivo:
                "Tienda vinculada pero el CarrierService no se pudo registrar (plan Shopify Basic/Starter no soporta CarrierService). El merchant debe upgradear a Advanced/Plus.",
              ipOrigen:
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                null,
            },
          })
          .catch((auditErr) =>
            console.error(
              "[/api/shopify/oauth/callback] no se pudo registrar el fallo del carrier (plan):",
              auditErr,
            ),
          );
      }
    } catch (e) {
      console.error(
        "[/api/shopify/oauth/callback] registro CarrierService best-effort falló (la tienda quedó vinculada igual):",
        e,
      );
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId,
            campo: "shopify:carrier_register_failed",
            valorAnterior: JSON.stringify({ shop }),
            valorNuevo: JSON.stringify({ error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500) }),
            motivo:
              "Tienda vinculada pero el registro del CarrierService en Shopify falló. Reintentar desde el panel.",
            ipOrigen:
              request.headers.get("x-forwarded-for") ??
              request.headers.get("x-real-ip") ??
              null,
          },
        })
        .catch((auditErr) =>
          console.error(
            "[/api/shopify/oauth/callback] no se pudo registrar el fallo del carrier:",
            auditErr,
          ),
        );
    }

    // Shopify Fase 3 — Registrar webhooks (ORDERS_PAID por ahora; APP_UNINSTALLED
    // y otros vendrán en fases posteriores). Best-effort: NUNCA debe romper el
    // install. Patrón idéntico al carrier register de arriba.
    try {
      const resultadoWebhooks = await registrarWebhooksShopify({
        shop,
        accessTokenCifrado: accessTokenEnc,
      });
      if (resultadoWebhooks.ok) {
        console.log(
          `[/api/shopify/oauth/callback] webhooks OK shop=${shop} registrados=[${resultadoWebhooks.registrados.join(",")}] duplicados=[${resultadoWebhooks.duplicados.join(",")}]`,
        );
      } else {
        console.warn(
          `[/api/shopify/oauth/callback] webhooks fallaron shop=${shop}: ${resultadoWebhooks.detalle}`,
        );
        await prisma.auditoriaConfiguracion
          .create({
            data: {
              empresaId,
              campo: "shopify:webhook_register_failed",
              valorAnterior: JSON.stringify({ shop }),
              valorNuevo: JSON.stringify({
                detalle: resultadoWebhooks.detalle.slice(0, 500),
              }),
              motivo:
                "Tienda vinculada pero el registro de webhooks en Shopify falló. Reintentar desde el panel.",
              ipOrigen:
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                null,
            },
          })
          .catch((auditErr) =>
            console.error(
              "[/api/shopify/oauth/callback] no se pudo registrar el fallo de webhooks:",
              auditErr,
            ),
          );
      }
    } catch (e) {
      console.error(
        "[/api/shopify/oauth/callback] registro webhooks best-effort falló (la tienda quedó vinculada igual):",
        e,
      );
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId,
            campo: "shopify:webhook_register_failed",
            valorAnterior: JSON.stringify({ shop }),
            valorNuevo: JSON.stringify({
              error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
            }),
            motivo:
              "Tienda vinculada pero el registro de webhooks en Shopify falló (throw). Reintentar desde el panel.",
            ipOrigen:
              request.headers.get("x-forwarded-for") ??
              request.headers.get("x-real-ip") ??
              null,
          },
        })
        .catch((auditErr) =>
          console.error(
            "[/api/shopify/oauth/callback] no se pudo registrar el fallo de webhooks (throw):",
            auditErr,
          ),
        );
    }

    // TODO Fase 4+: APP_UNINSTALLED webhook + orders/cancelled + fulfillments/update.

    // Redirect a la página de éxito. Usar getAppUrlOrThrow(), NO request.url:
    // detrás de nginx el host de request.url es localhost:3000.
    const params = new URLSearchParams();
    params.set("shop", shop);
    return NextResponse.redirect(
      new URL(`/shopify/instalado?${params.toString()}`, getAppUrlOrThrow()),
    );
  } catch (e) {
    console.error("[/api/shopify/oauth/callback] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
