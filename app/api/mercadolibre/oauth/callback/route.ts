import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import {
  exchangeCodeForToken,
  ML_API_BASE,
  ML_OAUTH_CALLBACK_PATH,
} from "@/lib/mercadolibre/tokens";

// MEF Fase 1 step 3 — Callback OAuth de Mercado Libre (Momento 1). Mirror
// simplificado del twin Tiendanube (app/api/tiendanube/oauth/callback/route.ts):
// misma disciplina de validación de state, exchange, cross-install guard, tx
// atómica upsert+burn, y best-effort Conexion. Sin registro de carrier ni de
// webhooks — esos son Fase 3+ (a coordinar con Chat D).
//
// Endpoint PÚBLICO (Mercado Libre redirige el NAVEGADOR del seller acá tras
// el authorize; no hay sesión Shipro). Se auto-protege via el token de
// vinculación que viaja en el parámetro `state` — sólo tokens generados por
// el operador Shipro (POST /api/mercadolibre/install/link) tienen match en la BD.
//
// STEP 2b: valida el token de vinculación → intercambia el code por el par
// access+refresh (llamada real a ML) → decide entre CREAR (cuenta ML nueva) /
// REINSTALAR (mismo cliente) / RECHAZAR (cruce = otra empresa intenta vincular
// un seller ya vinculado a un cliente distinto). Camino feliz: upsert de la
// cuenta + marca del token como usado, atómico ($transaction). Cruce:
// registra en AuditoriaConfiguracion, deja audit, NO cambia nada, NO quema
// el link.
//
// TOKENS ENCRYPTED: accessToken + refreshToken pasan por encryptSecret ANTES
// de persist. Nunca en plaintext en la BD.
//
// NO se marca el token como usado hasta que la instalación se completa con
// éxito: si el intercambio fallara, el link seguiría vivo para reintento.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    // Sin code o state: request inválido o el seller canceló la autorización.
    if (!code || !state) {
      return NextResponse.json(
        { error: "Faltan parámetros de la instalación" },
        { status: 400 },
      );
    }

    // Validar el token de vinculación (state): existe + no expiró + no se usó.
    // NO lo marcamos usado acá — eso pasa recién cuando la instalación se
    // completa con éxito (paso posterior); si lo quemáramos ahora, un fallo
    // del intercambio dejaría el link inservible.
    const tokenVinc = await prisma.tokenVinculacionMercadoLibre.findUnique({
      where: { token: state },
    });
    if (!tokenVinc || tokenVinc.usadoEn !== null || tokenVinc.expira < new Date()) {
      return NextResponse.json(
        { error: "Link de instalación inválido, vencido o ya usado" },
        { status: 400 },
      );
    }

    const empresaId = tokenVinc.empresaId;

    // Redirect URI: byte-idéntico al que se armó en install-link. ML rechaza
    // el intercambio si el redirect_uri difiere del que consintió el seller.
    const appUrl = getAppUrlOrThrow();
    const redirectUri = `${appUrl}${ML_OAUTH_CALLBACK_PATH}`;

    // 2. Intercambio del code por el par access+refresh permanentes.
    let exchange;
    try {
      exchange = await exchangeCodeForToken(code, redirectUri);
    } catch (e) {
      console.error("[/api/mercadolibre/oauth/callback] intercambio falló:", e);
      // NO marcamos el token usado: el link sigue vivo, el seller puede
      // reintentar tras un fallo transitorio.
      return NextResponse.json(
        {
          error:
            "No se pudo completar la instalación con Mercado Libre. Reintentá en unos minutos.",
        },
        { status: 502 },
      );
    }
    const { accessToken, refreshToken, expiresIn, userId, scope } = exchange;

    // 3. Best-effort GET /users/me para poblar nickname. Usamos `fetch`
    // directo con el accessToken RECIÉN obtenido (la cuenta todavía no está
    // persistida — mlFetch no sirve acá). Si falla, nickname queda null;
    // NUNCA rompe la instalación.
    let nickname: string | null = null;
    try {
      const meRes = await fetch(`${ML_API_BASE}/users/me`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (meRes.ok) {
        const meData: any = await meRes.json().catch(() => ({}));
        if (typeof meData?.nickname === "string" && meData.nickname.length > 0) {
          nickname = meData.nickname;
        }
      }
    } catch (e) {
      console.error(
        "[/api/mercadolibre/oauth/callback] GET /users/me best-effort falló (nickname queda null):",
        e,
      );
    }

    // 4. ¿La cuenta ML ya existe? Decide entre crear / reinstalar / rechazar cruce.
    // BigInt(userId): schema mlUserId es BigInt (fix 2026-09-17). userId viene
    // de la ML response como number JS regular (3.6B < 2^53, safe); Prisma
    // exige bigint en el where. Chat D flag: sin este BigInt() en el LOOKUP
    // (no solo en la escritura), el cross-install guard nunca matchearía
    // seller reales — 3er bug latente.
    const cuentaExistente = await prisma.cuentaMercadoLibre.findUnique({
      where: { mlUserId: BigInt(userId) },
    });

    // CRUCE: el seller ya pertenece a OTRA empresa. Rechazar, registrar en
    // AuditoriaConfiguracion, NO cambiar nada, NO quemar el link. La
    // reasignación legítima (si de verdad el seller cambió de dueño) se hace
    // manualmente desde el equipo Shipro — el sistema nunca muda una cuenta
    // ML de empresa por su cuenta.
    if (cuentaExistente && cuentaExistente.empresaId !== empresaId) {
      await prisma.auditoriaConfiguracion
        .create({
          data: {
            empresaId: cuentaExistente.empresaId, // la dueña actual (la afectada)
            campo: "mercadolibre:cross_install",
            valorAnterior: JSON.stringify({
              mlUserId: userId,
              empresaActual: cuentaExistente.empresaId,
            }),
            valorNuevo: JSON.stringify({ empresaIntentada: empresaId }),
            motivo:
              "Intento de vincular una cuenta Mercado Libre ya asociada a otra empresa. Rechazado; requiere resolución manual del equipo Shipro.",
            ipOrigen:
              request.headers.get("x-forwarded-for") ??
              request.headers.get("x-real-ip") ??
              null,
          },
        })
        .catch((e) =>
          console.error(
            "[/api/mercadolibre/oauth/callback] no se pudo registrar el cruce:",
            e,
          ),
        );

      // TODO Fase 1 follow-up: enviarMailAlertaCruceMercadoLibre helper en
      // lib/mailer.ts (mirror de enviarMailAlertaCruceTiendanube L667). Fuera
      // del scope de step 3 estricto — se agrega en un commit separado.
      // Mientras tanto, console.error da visibilidad al equipo Shipro.
      console.error(
        `[/api/mercadolibre/oauth/callback] CROSS-INSTALL cruce detectado: mlUserId=${userId} pertenece a empresaId=${cuentaExistente.empresaId}, empresaIntentada=${empresaId}. Requiere resolución manual.`,
      );

      return NextResponse.json(
        {
          error:
            "Esta cuenta de Mercado Libre ya está vinculada a otra cuenta de Shipro. Nuestro equipo fue notificado y se contactará con vos.",
        },
        { status: 409 },
      );
    }

    // 5. Camino feliz (cuenta nueva o reinstalación del mismo cliente):
    // guardar + quemar el link, atómico (o las dos cosas, o ninguna). Los
    // tokens se guardan ENCRIPTADOS con encryptSecret (AES-256-GCM). El
    // refresh_token es SINGLE-USE + ROTA en cada refresh — la lib
    // (getMercadoLibreAccessToken) mantiene la persistencia atómica de
    // access+refresh nuevos en cada rotación.
    const accessTokenEnc = encryptSecret(accessToken);
    const refreshTokenEnc = encryptSecret(refreshToken);
    const tokenExpiraEn = new Date(Date.now() + expiresIn * 1000);

    // BigInt(userId): schema mlUserId es BigInt (fix 2026-09-17). Aplica al
    // `where.mlUserId` (lookup) y al `create.mlUserId` (escritura). userId JS
    // number regular; Prisma exige bigint en la columna BigInt.
    const mlUserIdBig = BigInt(userId);
    await prisma.$transaction([
      prisma.cuentaMercadoLibre.upsert({
        where: { mlUserId: mlUserIdBig },
        update: {
          empresaId,
          accessToken: accessTokenEnc,
          refreshToken: refreshTokenEnc,
          tokenExpiraEn,
          scope,
          nickname,
          estado: "activa",
          desvinculadaEn: null,
        },
        create: {
          empresaId,
          mlUserId: mlUserIdBig,
          accessToken: accessTokenEnc,
          refreshToken: refreshTokenEnc,
          tokenExpiraEn,
          scope,
          nickname,
          estado: "activa",
        },
      }),
      prisma.tokenVinculacionMercadoLibre.update({
        where: { id: tokenVinc.id },
        data: { usadoEn: new Date() },
      }),
    ]);

    // HUB DEUDA 150 Pieza 2 — registra la conexión ML en el modelo Conexion.
    // BEST-EFFORT: si falla, la instalación de la cuenta NO se rompe (ya
    // commiteó arriba). Additive — enums MERCADOLIBRE + OAUTH ya existen.
    // Mapeo estado: el callback OAuth solo entra por el camino feliz del
    // install (arriba dejó estado="activa" unconditional), así que la Conexion
    // arranca ACTIVA. Estados suspendida/revocada los aplicarán los webhooks
    // lifecycle (Fase 3+) en su propia pasada.
    try {
      await prisma.conexion.upsert({
        where: { empresaId_plataforma: { empresaId, plataforma: "MERCADOLIBRE" } },
        update: {
          estado: "ACTIVA",
          referenciaExterna: String(userId),
          mecanismo: "OAUTH",
        },
        create: {
          empresaId,
          plataforma: "MERCADOLIBRE",
          mecanismo: "OAUTH",
          estado: "ACTIVA",
          referenciaExterna: String(userId),
        },
      });
    } catch (err) {
      console.error(
        "[/api/mercadolibre/oauth/callback] Conexion upsert best-effort falló (la cuenta ya se vinculó, no se rompe):",
        err,
      );
    }

    // Redirect a la página de éxito usando APP_URL como base. Página futura;
    // por ahora el URL es un target estable — cuando exista la página, este
    // redirect funciona automáticamente sin tocar el callback. Mientras tanto
    // el seller ve la página 404 default del app (menos ideal pero aceptable
    // para MEF Fase 1 — la página de éxito se crea en pieza posterior).
    const params = new URLSearchParams();
    params.set("mlUserId", String(userId));
    if (nickname) params.set("nickname", nickname);
    return NextResponse.redirect(
      new URL(`/mercadolibre/instalado?${params.toString()}`, appUrl),
    );
  } catch (e) {
    console.error("[/api/mercadolibre/oauth/callback] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
