import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyMercadoLibreWebhookSignature } from "@/lib/mercadolibre/webhook-verify";
import { checkMlWebhookIpAllowlist } from "@/lib/mercadolibre/webhook-ip";
import { mlFetch } from "@/lib/mercadolibre/client";
import {
  ESTADOS_NOTIFICACION_FLEX,
  type EstadoNotificacionFlexKey,
} from "@/lib/utils/estados";

// ============================================================================
// MEF Fase 1 step 4 (fix seguridad 2026-09-21) — Receiver de webhooks ML.
//
// HALLAZGO CRÍTICO 2026-09-21: el marketplace de ML NO firma sus webhooks. El
// x-signature/HMAC es de Mercado Pago. El receiver original validaba SOLO por
// firma → rechazaría 401 los webhooks reales de ML. Fix (política Chat D):
//
//   1. NO exigir x-signature — sacamos el 401 por firma ausente. Si viene,
//      verificamos log-only.
//   2. IP allowlist FAIL-OPEN-BUT-LOUD (env override + enforce flag):
//      ML_WEBHOOK_IPS (default: 14 IPs precargadas), ML_WEBHOOK_IP_ENFORCE
//      (default false).
//   3. SIEMPRE persistir el aviso (dedup por notificacionId). NUNCA descartar
//      — un aviso perdido = un cambio de estado del envío perdido.
//   4. estado EVOLUCIONA (no fijo al insert):
//      * create con "recibida" (o "huerfana" si seller no gestionado).
//      * Post-persist: si cuenta OK + shipmentId + topic="shipments", disparar
//        GET autenticado /shipments/{id} con header x-format-new: true (ML lo
//        requiere para shape moderno) → update estado según resultado:
//        - 200 → "valido" (shipment existe en la cuenta del seller: auténtico).
//        - 404 → "get_shipment_no_existe" (race con ML: webhook llegó antes
//               de que el shipment esté visible; reintentable, NO spoof).
//        - error/5xx → "get_fallido_reintentable" (Fase 3 worker retry).
//      * El GET no gatea la persistencia ni el 200. La fila ya está —
//        el GET solo clasifica.
//   5. Rich logging para el primer webhook real (nos ayuda a endurecer la
//      allowlist de IPs cuando ML publique cambios).
//
// STAGING ONLY: cero envío create, cero downstream (Fase 3 worker acciona a
// partir de estado="valido"). Preservado: dedup idempotente + 200 dentro del
// SLA de ML (22s).
//
// Locks superpuestos:
//   Lock A — seller resolution (CuentaMercadoLibre.findUnique by mlUserId BigInt).
//   Lock B — GET autenticado /shipments/{id} con x-format-new.
// La IP allowlist es defense-in-depth (spoofable si nginx no está bien
// configurado); los 2 locks reales son A + B.
// ============================================================================

export const runtime = "nodejs";

type EstadoFlex = EstadoNotificacionFlexKey;

async function clasificarShipment(
  empresaId: number,
  shipmentId: string,
): Promise<EstadoFlex> {
  // GET autenticado con x-format-new: true (REQUIRED por ML per Chat D — sin
  // este header, ML devuelve shape legacy pobre para el endpoint moderno).
  try {
    const res = await mlFetch(empresaId, `/shipments/${shipmentId}`, {
      headers: { "x-format-new": "true" },
    });
    if (res.ok) return "valido";
    if (res.status === 404) return "get_shipment_no_existe";
    // 401/403/5xx u otros → reintentable transitorio.
    console.warn(
      `[ml-webhook-recv] GET /shipments/${shipmentId} → HTTP ${res.status} — clasificado get_fallido_reintentable`,
    );
    return "get_fallido_reintentable";
  } catch (e) {
    console.warn(
      `[ml-webhook-recv] GET /shipments/${shipmentId} threw:`,
      e instanceof Error ? e.message : String(e).slice(0, 200),
    );
    return "get_fallido_reintentable";
  }
}

export async function POST(request: Request) {
  try {
    // 1. RAW body FIRST — leer antes de cualquier parse.
    const raw = await request.text();

    // 2. JSON.parse. Fallo → 400 (body roto; retry no ayuda).
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new NextResponse("Bad JSON", { status: 400 });
    }

    // 3. IP allowlist check — fail-open-loud (log si no matchea; procesa igual).
    //    Enforce flag opcional (ML_WEBHOOK_IP_ENFORCE=true → 401 en no-match).
    const ipCheck = checkMlWebhookIpAllowlist(request);
    if (!ipCheck.allowed) {
      console.warn(
        `[ml-webhook-recv] IP no matchea allowlist: ${ipCheck.ip ?? "null"} (allowlistSize=${ipCheck.allowlistSize}, enforce=${ipCheck.enforce})`,
      );
      if (ipCheck.enforce) {
        return new NextResponse("IP not allowed", { status: 401 });
      }
      // fail-open: continuamos, queda en el log para forense.
    }

    // 4. x-signature OPCIONAL — verificamos SOLO si viene, log-only. Nunca
    //    rechazamos por firma ausente/inválida (marketplace ML no firma).
    const xSig = request.headers.get("x-signature");
    if (xSig) {
      const okSig = verifyMercadoLibreWebhookSignature({
        payload,
        xSignature: xSig,
        xRequestId: request.headers.get("x-request-id"),
      });
      if (!okSig) {
        console.warn(
          `[ml-webhook-recv] x-signature vino pero inválida: ${xSig.slice(0, 24)}...`,
        );
      }
    }

    // 5. Extraer campos del payload. Nombres sin ambigüedad:
    //    `notificacionMlId` = top-level id (dedup key); `data.id` = resource id
    //    (usado en HMAC + el shipmentId sale del `resource`, no de `data.id`).
    const notificacionMlId =
      payload?.id != null ? String(payload.id) : null;
    const topic = typeof payload?.topic === "string" ? payload.topic : null;
    const resource =
      typeof payload?.resource === "string" ? payload.resource : null;
    const mlUserIdRaw = payload?.user_id;
    const mlUserId =
      typeof mlUserIdRaw === "number" ? mlUserIdRaw : Number(mlUserIdRaw);

    if (!notificacionMlId || !topic || !resource || !Number.isInteger(mlUserId)) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // BigInt(mlUserId): schema mlUserId es BigInt. Aplica LOOKUP + WRITE.
    const mlUserIdBig = BigInt(mlUserId);

    // 6. shipmentId: extraer del resource si topic incluye shipments.
    let shipmentId: string | null = null;
    if (topic.startsWith("shipments")) {
      const m = resource.match(/\/shipments\/(\d+)/);
      shipmentId = m ? m[1] : null;
    }

    // 7. attempts/sent/received — opcionales.
    const attempts =
      typeof payload?.attempts === "number" ? payload.attempts : null;
    const sent =
      typeof payload?.sent === "string" ? parseIsoOrNull(payload.sent) : null;
    const received =
      typeof payload?.received === "string"
        ? parseIsoOrNull(payload.received)
        : null;

    // 8. Lock A — seller resolution vía CuentaMercadoLibre.
    const cuenta = await prisma.cuentaMercadoLibre.findUnique({
      where: { mlUserId: mlUserIdBig },
      select: { empresaId: true },
    });
    const empresaId = cuenta?.empresaId ?? null;
    const estadoInicial: EstadoFlex = cuenta
      ? ESTADOS_NOTIFICACION_FLEX.recibida.key
      : ESTADOS_NOTIFICACION_FLEX.huerfana.key;

    // 9. Rich logging — para hardening de la IP allowlist con webhooks reales.
    console.log(
      "[ml-webhook-recv]",
      JSON.stringify({
        ts: new Date().toISOString(),
        ip: ipCheck.ip,
        ipAllowed: ipCheck.allowed,
        ipEnforce: ipCheck.enforce,
        headers: Object.fromEntries([...request.headers.entries()]),
        notificacionMlId,
        topic,
        resource,
        mlUserId,
        shipmentId,
        estadoInicial,
        cuentaResuelta: cuenta !== null,
      }),
    );

    // 10. Persist idempotente (dedup por notificacionId @unique). Never discard.
    let filaCreada = true;
    try {
      await prisma.notificacionFlex.create({
        data: {
          notificacionId: notificacionMlId,
          mlUserId: mlUserIdBig,
          topic,
          resource,
          shipmentId,
          empresaId,
          attempts,
          sent,
          received,
          payloadRaw: payload,
          estado: estadoInicial,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        // Retry legítimo del mismo notificacionMlId → 200 idempotente.
        return NextResponse.json(
          { ok: true, duplicated: true },
          { status: 200 },
        );
      }
      // Cualquier otro error DB → 500 para que ML retry (transitorio).
      console.error(
        "[ml-webhook-recv] persistencia falló (no P2002):",
        e instanceof Error ? e.message : String(e).slice(0, 300),
      );
      return new NextResponse("Persistence error", { status: 500 });
    }

    // 11. Lock B — GET autenticado del shipment (post-persist, no gatea).
    //     Si aplica (cuenta OK + shipments topic + shipmentId presente),
    //     clasificamos estado. Errores del GET → estado reintentable +
    //     seguimos igual al 200. Never discard.
    if (
      cuenta &&
      empresaId !== null &&
      shipmentId &&
      topic.startsWith("shipments") &&
      filaCreada
    ) {
      const estadoClasificado = await clasificarShipment(empresaId, shipmentId);
      // Si sigue "recibida", no update-eamos (evita write innecesaria).
      if (estadoClasificado !== "recibida") {
        try {
          await prisma.notificacionFlex.update({
            where: { notificacionId: notificacionMlId },
            data: { estado: estadoClasificado },
          });
        } catch (e) {
          // Log + continuamos — la fila existe con estado="recibida", Fase 3
          // worker puede clasificar después. Never fail el 200.
          console.warn(
            "[ml-webhook-recv] update estado post-GET falló (fila persistida ok):",
            e instanceof Error ? e.message : String(e).slice(0, 200),
          );
        }
      }
    }

    // 12. Ack SIEMPRE 200 (SLA ML: 22s). La fila ya existe; estado
    //     evolucionará con el worker de Fase 3 si es reintentable.
    return NextResponse.json({ ok: true, huerfana: !cuenta }, { status: 200 });
  } catch (e) {
    // Fallback: throw no manejado. 500 para que ML retry.
    console.error(
      "[ml-webhook-recv] error inesperado:",
      e instanceof Error ? e.message : String(e).slice(0, 300),
    );
    return new NextResponse("Internal error", { status: 500 });
  }
}

function parseIsoOrNull(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}
