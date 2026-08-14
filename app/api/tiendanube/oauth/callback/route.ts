import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { exchangeCodeForToken } from "@/lib/tiendanube/oauth";
import { encryptSecret } from "@/lib/utils/secret-crypto";
import { enviarMailAlertaCruceTiendanube } from "@/lib/mailer";
import { registrarCarrierParaTienda } from "@/lib/tiendanube/carrier";
import { obtenerDatosTienda } from "@/lib/tiendanube/tienda";

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

    // Enriquecer la tienda con su nombre + dominio (GET /store), best-effort. Capturamos nombre/dominio
    // en variables del scope externo para pasarlos al redirect de la página de éxito. La tienda YA quedó
    // vinculada; un fallo acá NO rompe la instalación (queda sin nombre/dominio, se puede reintentar).
    let nombreTienda: string | null = null;
    let dominioTienda: string | null = null;
    try {
      const datosTienda = await obtenerDatosTienda(storeId, accessToken);
      if (datosTienda && (datosTienda.nombre || datosTienda.dominio)) {
        nombreTienda = datosTienda.nombre;
        dominioTienda = datosTienda.dominio;
        await prisma.tiendaTiendanube.update({
          where: { storeId },
          data: { nombre: datosTienda.nombre, dominio: datosTienda.dominio },
        });
      }
    } catch (e) {
      console.error("[/api/tiendanube/oauth/callback] enriquecer datos de la tienda best-effort falló (la tienda quedó vinculada igual):", e);
    }

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
      // Visibilidad: dejar registrado el fallo del carrier para que el equipo Shipro lo vea y reintente.
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId,
            campo: "tiendanube:carrier_register_failed",
            valorAnterior: JSON.stringify({ storeId, shippingCarrierIdPrevio: tiendaExistente?.shippingCarrierId ?? null }),
            valorNuevo: JSON.stringify({ error: String(e).slice(0, 500) }),
            motivo: "Tienda vinculada pero el registro del carrier en Tiendanube falló. Reintentar desde el panel.",
            ipOrigen: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
          },
        })
        .catch((auditErr) => console.error("[/api/tiendanube/oauth/callback] no se pudo registrar el fallo del carrier:", auditErr));
    }

    // Calcular si la empresa puede OPERAR (para el estado de la página de éxito). Operable = empresa
    // activa + no suspendida + onboarding completo + al menos un courier activo + al menos un depósito
    // activo. Best-effort: ante cualquier error, config=pending (conservador — mejor pedir configurar
    // de más que decir "listo" cuando no lo está).
    let empresaOperativa = false;
    try {
      const emp = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          activo: true,
          onboardingCompletado: true,
          suspendida: true,
          _count: {
            select: {
              credenciales: { where: { activo: true } },
              depositos: { where: { activo: true, eliminado: false } },
            },
          },
        },
      });
      empresaOperativa =
        !!emp &&
        emp.activo === true &&
        emp.suspendida === false &&
        emp.onboardingCompletado === true &&
        emp._count.credenciales >= 1 &&
        emp._count.depositos >= 1;
    } catch (e) {
      console.error("[/api/tiendanube/oauth/callback] no se pudo calcular operabilidad (config=pending):", e);
    }

    // Redirect a la página de éxito, MISMO ORIGEN (request.url) — no depende de APP_URL. nombre/dominio
    // van encodeURIComponent (pueden traer espacios/acentos). carrier ok/fail + config ok/pending pintan
    // el estado de la pantalla.
    const params = new URLSearchParams();
    params.set("store", String(storeId));
    if (nombreTienda) params.set("nombre", nombreTienda);
    if (dominioTienda) params.set("dominio", dominioTienda);
    params.set("carrier", carrierRegistrado ? "ok" : "fail");
    params.set("config", empresaOperativa ? "ok" : "pending");
    return NextResponse.redirect(new URL(`/tiendanube/instalado?${params.toString()}`, request.url));
  } catch (e) {
    console.error("[/api/tiendanube/oauth/callback] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
