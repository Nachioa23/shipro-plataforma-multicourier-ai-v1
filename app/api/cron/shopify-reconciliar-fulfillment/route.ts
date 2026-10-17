// ============================================================================
// CRON — Reconciliador de Fulfillment Shopify (Shopify Fase 3, 2026-10-17).
//
// Empuja a Shopify el tracking REAL de envíos cuyo push quedó PENDIENTE o
// FALLÓ. Dos casos cubiertos:
//
//   1. PENDING: el webhook orders/paid creó el envío pero nació BLOQUEADO
//      (SHP-* provisorio) → se difirió el push. Cuando los procesar-bloqueados-*
//      del NÚCLEO destraban el envío + obtienen tracking real del courier,
//      este cron agarra el envío + empuja el tracking real a Shopify.
//
//   2. FAILED: el push desde el webhook (o un retry previo) erroró — reintenta.
//
// NO toca núcleo. NO llama a crearEnvio. NO debita. Solo lee tracking ya real
// del Envio + pushea a Shopify via helpers de lib/shopify/fulfillment.
//
// AUTH: proxy.ts:/api/cron/* valida Authorization: Bearer CRON_SECRET. Este
// handler no re-verifica. No está wireado en el crontab del server todavía;
// el agendado se hace cuando Chat B/Nacho decidan (sugerido: cada 10-15 min
// durante horario operativo, análogo a reintentar-despachos y rastreo).
//
// CONCURRENCIA: claim atómico con updateMany + where en estado PENDING/FAILED
// → RETRYING. Si dos workers solapan, Postgres serializa; solo uno gana el
// claim por envío. Los demás ven `count !== 1` y skipean sin side effects.
//
// BATCH CAP: LOTE_MAXIMO=50 para acotar latencia (~50 llamadas a Shopify
// serializadas; ~15-30s total). Corrida futura levanta lo restante por
// paginación FIFO (pushedAt asc nulls primero + id asc).
//
// FIFO con nulls primero: pushedAt null = NUNCA se intentó push (PENDING desde
// el webhook) → van al frente, se procesan antes que los FAILED que ya tuvieron
// un intento previo. Fairness razonable para no privilegiar reintentos sobre
// first-time pushes.
// ============================================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  obtenerFulfillmentOrders,
  pushFulfillmentShopify,
} from "@/lib/shopify/fulfillment";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

export const runtime = "nodejs";
export const maxDuration = 60;

const LOTE_MAXIMO = 50;

export async function GET() {
  const summary = {
    ok: true as boolean,
    procesados: 0,
    pusheados: 0,
    fallidos: 0,
    cancelados: 0,
    errores: [] as Array<{ envioId: number; error: string }>,
  };

  try {
    // 1. Candidatos — Prisma where sin startsWith (lo filtramos in-memory para
    // evitar depender del operador en el PK varchar; mismo patrón que
    // reintentar-despachos filtra el campo semántico in-memory). Igual la query
    // apunta por índice en empresaId/estadoActual, no es full-scan.
    const candidatosRaw = await prisma.envio.findMany({
      where: {
        shopifyFulfillmentOrderId: { not: null },
        shopifyFulfillmentPushEstado: { in: ["PENDING", "FAILED"] },
        estadoActual: { not: "CANCELADO" },
      },
      include: {
        courier: { select: { nombre: true } },
      },
      orderBy: [
        // nulls first con Prisma Postgres: usar sort explícito.
        { shopifyFulfillmentPushedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: LOTE_MAXIMO,
    });

    // Filtro in-memory del tracking SHP-* (envíos provisorios/bloqueados sin
    // tracking real del courier — no empujar).
    const candidatos = candidatosRaw.filter(
      (e) => !!e.trackingNumber && !String(e.trackingNumber).startsWith("SHP-"),
    );

    for (const envio of candidatos) {
      summary.procesados++;
      try {
        // 2. Claim atómico. Only one worker wins per envío.
        const claim = await prisma.envio.updateMany({
          where: {
            id: envio.id,
            shopifyFulfillmentPushEstado: { in: ["PENDING", "FAILED"] },
          },
          data: { shopifyFulfillmentPushEstado: "RETRYING" },
        });
        if (claim.count !== 1) {
          console.log(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id} ya claimed por otro worker, skip`,
          );
          continue;
        }

        // 3. Cargar TiendaShopify. Si no existe o fue desinstalada, cancelar
        // el push: ya no tenemos cómo empujar.
        const tiendaShopifyId = envio.tiendaShopifyId;
        if (tiendaShopifyId == null) {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "CANCELED",
              shopifyFulfillmentPushError: "tiendaShopifyId null (vínculo incompleto)",
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
          summary.cancelados++;
          console.warn(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id}: tiendaShopifyId null, CANCELED`,
          );
          continue;
        }
        const tienda = await prisma.tiendaShopify.findUnique({
          where: { id: tiendaShopifyId },
          select: {
            shopDomain: true,
            accessToken: true,
            estado: true,
          },
        });
        if (!tienda || tienda.estado !== "instalada" || !tienda.accessToken) {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "CANCELED",
              shopifyFulfillmentPushError: "tienda no instalada",
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
          summary.cancelados++;
          console.warn(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id}: tienda no instalada, CANCELED`,
          );
          continue;
        }

        // 4. Re-consultar el FO vigente — robusto ante foIds viejos (si Shopify
        // dividió / reemplazó el FO original, el id guardado puede estar stale).
        // obtenerFulfillmentOrders ya filtra por CREATE_FULFILLMENT.
        const orderGid = envio.shopifyOrderId;
        if (!orderGid) {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "CANCELED",
              shopifyFulfillmentPushError: "shopifyOrderId null (vínculo incompleto)",
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
          summary.cancelados++;
          console.warn(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id}: shopifyOrderId null, CANCELED`,
          );
          continue;
        }
        const accessTokenPlano = decryptSecret(tienda.accessToken);
        const fos = await obtenerFulfillmentOrders(
          tienda.shopDomain,
          accessTokenPlano,
          orderGid,
        );
        if (fos.length === 0) {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "CANCELED",
              shopifyFulfillmentPushError: "sin FO con CREATE_FULFILLMENT",
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
          summary.cancelados++;
          console.warn(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id}: sin FO con CREATE_FULFILLMENT (orderGid=${orderGid}), CANCELED`,
          );
          continue;
        }
        const foIdVigente = fos[0].id;

        // 5. Push a Shopify.
        const trackingNumber = envio.trackingNumber as string;
        const trackingUrl = `${getAppUrlOrThrow()}/s/${trackingNumber}`;
        const push = await pushFulfillmentShopify({
          shop: tienda.shopDomain,
          accessTokenCifrado: tienda.accessToken,
          fulfillmentOrderId: foIdVigente,
          trackingCompany: envio.courier?.nombre ?? "Shipro",
          trackingNumber,
          trackingUrl,
          notifyCustomer: true,
        });

        if (push.ok && push.fulfillmentId) {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "PUSHED",
              shopifyFulfillmentId: push.fulfillmentId,
              shopifyFulfillmentPushedAt: new Date(),
              shopifyFulfillmentPushError: null,
            },
          });
          summary.pusheados++;
          console.log(
            `[cron/shopify-reconciliar-fulfillment] push OK envio=${envio.id} fulfillmentId=${push.fulfillmentId} tracking=${trackingNumber}`,
          );
        } else {
          const errorMsg = (push.userErrors ?? [])
            .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
            .join(" | ")
            .slice(0, 500);
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "FAILED",
              shopifyFulfillmentPushError: errorMsg || "userErrors sin detalle",
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
          summary.fallidos++;
          console.warn(
            `[cron/shopify-reconciliar-fulfillment] push FAILED envio=${envio.id} errors=${errorMsg}`,
          );
        }
      } catch (e) {
        const errorMsg =
          e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
        summary.fallidos++;
        summary.errores.push({ envioId: envio.id, error: errorMsg });
        try {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "FAILED",
              shopifyFulfillmentPushError: errorMsg,
              shopifyFulfillmentPushedAt: new Date(),
            },
          });
        } catch (updErr) {
          console.error(
            `[cron/shopify-reconciliar-fulfillment] envío ${envio.id}: no se pudo marcar FAILED tras throw:`,
            updErr,
          );
        }
        console.error(
          `[cron/shopify-reconciliar-fulfillment] envío ${envio.id} threw:`,
          e,
        );
      }
    }

    console.log(
      `[cron/shopify-reconciliar-fulfillment] run completo procesados=${summary.procesados} pusheados=${summary.pusheados} fallidos=${summary.fallidos} cancelados=${summary.cancelados}`,
    );
    return NextResponse.json(summary, { status: 200 });
  } catch (e) {
    console.error("[cron/shopify-reconciliar-fulfillment] Error interno:", e);
    summary.ok = false;
    summary.errores.push({
      envioId: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(summary, { status: 500 });
  }
}
