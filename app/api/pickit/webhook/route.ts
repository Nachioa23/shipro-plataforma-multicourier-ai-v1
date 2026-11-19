import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { aplicarEstadoCourier, type EnvioParaAplicarEstado } from "@/lib/envios/aplicar-estado-courier";
import { FUENTE_EVENTO } from "@/lib/constants/fuente-evento";
import { resolverEstadoPickitDesdePayload } from "@/lib/couriers/pickit-estados";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

// =============================================================================
// Receptor de webhook de tracking de Pickit — doc oficial developers.pickit.net.
// Pickit NO firma los webhooks: la ÚNICA defensa es el campo `token` del payload
// (retailer token, mismo que usamos en creds.token). Comparación timing-safe
// contra PICKIT_WEBHOOK_TOKEN. Dormido hasta que el env esté cargado.
//
// Payload relevante:
//   { token, pickitCode, state: { tag, subState: { tag } }, workflow: { tag }, ... }
//
// Flujo:
//   1) Parse JSON (nunca 5xx por payload malo → 200 ignored).
//   2) Gate dormido si falta PICKIT_WEBHOOK_TOKEN.
//   3) Verificación token timing-safe.
//   4) Lookup Envio por pickitCode (= Envio.trackingNumber @unique).
//   5) Guard courier = pickit (defense-in-depth por colisión improbable).
//   6) Resolver canónico (subState.tag ?? state.tag → MAPA) + aplicarEstadoCourier.
//
// Read-path: NO toca débito ni crearEnvio. Idempotencia la da aplicarEstadoCourier
// (update condicional por estadoCambio + EventoTracking solo si repetible/cambio).
// =============================================================================

export const runtime = "nodejs";

function tokensMatch(received: unknown, expected: string): boolean {
  const r = String(received ?? "");
  if (!r || !expected) return false;
  const rb = Buffer.from(r);
  const eb = Buffer.from(expected);
  if (rb.length !== eb.length) return false;
  return crypto.timingSafeEqual(rb, eb);
}

export async function POST(request: Request) {
  // 1. Parse JSON tolerante — webhook mal formado NO tira 5xx (Pickit reintentaría en bucle).
  let payload: any;
  try {
    payload = await request.json();
  } catch (e) {
    console.warn("[pickit-webhook] payload JSON inválido — ignored:", {
      err: e instanceof Error ? e.message : String(e).slice(0, 200),
    });
    return NextResponse.json({ ok: true, ignored: "payload inválido" });
  }
  if (!payload || typeof payload !== "object") {
    console.warn("[pickit-webhook] payload no-objeto — ignored");
    return NextResponse.json({ ok: true, ignored: "payload inválido" });
  }

  // 2. Receptor dormido — sin env no validamos token y no procesamos (pero sí 200 para no loopear retries).
  const tokenEsperado = process.env.PICKIT_WEBHOOK_TOKEN;
  if (!tokenEsperado) {
    console.warn("[pickit-webhook] receptor dormido: falta PICKIT_WEBHOOK_TOKEN");
    return NextResponse.json({ ok: true, dormant: true });
  }

  // 3. Verificación token timing-safe. Mismatch = 401 (pickit reintenta ante 5xx, no ante 401).
  if (!tokensMatch(payload.token, tokenEsperado)) {
    console.error("[pickit-webhook] token inválido — 401");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 4. pickitCode = llave pública de tracking (Envio.trackingNumber @unique).
  const pickitCode = String(payload.pickitCode ?? "").trim();
  if (!pickitCode) {
    console.warn("[pickit-webhook] payload sin pickitCode — ignored");
    return NextResponse.json({ ok: true, ignored: "sin pickitCode" });
  }

  const estadoCanonico = resolverEstadoPickitDesdePayload(payload.state);

  const envio = await prisma.envio.findUnique({
    where: { trackingNumber: pickitCode },
    include: {
      destino: true,
      courier: true,
      tickets: { where: { estado: "ABIERTO" } },
      eventos: { orderBy: { fecha: "desc" }, take: 1 },
    },
  });

  if (!envio) {
    // 200 ack silencioso: un 404 loopea retries de Pickit indefinidamente si el envío
    // aún no persistió. La próxima notificación va a encontrarlo.
    console.warn("[pickit-webhook] envío no encontrado por pickitCode — ignored:", {
      pickitCode,
      estadoCanonico,
      workflowTag: payload?.workflow?.tag ?? null,
    });
    return NextResponse.json({ ok: true, ignored: "envío no encontrado" });
  }

  // 5. Defense-in-depth: si Envio.trackingNumber colisionara con otro courier, no aplicamos.
  if (normalizarParaComparacion(envio.courier.nombre) !== "pickit") {
    console.error("[pickit-webhook] courier mismatch — ignored:", {
      pickitCode,
      courierBD: envio.courier.nombre,
    });
    return NextResponse.json({ ok: true, ignored: "courier mismatch" });
  }

  // 6. Aplicar vía helper compartido con el cron.
  try {
    const r = await aplicarEstadoCourier({
      envio: envio as unknown as EnvioParaAplicarEstado,
      estadoCrudo: estadoCanonico,
      fuente: FUENTE_EVENTO.COURIER,
      baseUrl: getAppUrlOrThrow(),
    });
    console.log("[pickit-webhook] aplicado:", {
      pickitCode,
      estadoCanonico,
      workflowTag: payload?.workflow?.tag ?? null,
      actualizado: r.actualizado,
      eventoCreado: r.eventoCreado,
      ticketCreado: r.ticketCreado,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    // Transitorio (DB, mail, push TN): 503 para que Pickit reintente si lo soporta.
    console.error("[pickit-webhook] aplicarEstadoCourier falló:", {
      pickitCode,
      estadoCanonico,
      err: e instanceof Error ? e.message : String(e).slice(0, 200),
    });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

// Ping de verificación de URL al registrar el webhook en Pickit.
export async function GET(_request: Request) {
  return NextResponse.json({ ok: true });
}
