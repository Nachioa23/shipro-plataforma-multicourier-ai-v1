import { NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { crearEnvio, type CrearEnvioInput } from "@/lib/envios/crear";
import { cotizar } from "@/lib/cotizador";
import { armarBultoApilado } from "@/lib/empaquetado/armar-bulto";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";
import { isValidShopDomain } from "@/lib/shopify/oauth-verify";
import {
  obtenerFulfillmentOrders,
  pushFulfillmentShopify,
} from "@/lib/shopify/fulfillment";
import { resolverOpcionElegida } from "@/lib/shopify/resolver-servicio";
import { getShopifyAccessToken } from "@/lib/shopify/tokens";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

// Shopify Fase 3 — Webhook orders/paid.
//
// Endpoint PÚBLICO (registrado en proxy.ts PUBLIC_API_EXACT). Shopify firma
// el request con HMAC-SHA256(rawBody, SHOPIFY_API_SECRET) en el header
// x-shopify-hmac-sha256. Verificación OBLIGATORIA antes de parsear.
//
// FLOW:
//   1. Verify HMAC + shop domain.
//   2. Lookup tienda (incluye empresa + depósito predeterminado + Modo B).
//      Si no está instalada → 200 no-op (no reintentar).
//   3. 200 inmediato + handoff a after() (Shopify corta a 5s; crearEnvio +
//      despacho + push tardan 15-40s).
//   4. En after(): obtener FOs → idempotencia → cotizar → resolver opción →
//      crearEnvio (money-crítico — el motor único cobra/debita) → push
//      fulfillment (solo si tracking real, no SHP-*).
//
// Patrón de async handoff espejo de app/api/tiendanube/labels/generate.
export const runtime = "nodejs";
export const maxDuration = 60;

const PESO_DEFAULT_KG = 2;

interface ShopifyShippingLine {
  code?: string | null;
  price?: string | null; // decimal "1500.00" (NO subunidades en orders webhook)
  title?: string | null;
}

interface ShopifyLineItem {
  grams?: number | null;
  quantity?: number | null;
}

interface ShopifyAddress {
  zip?: string | null;
  province?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone?: string | null;
}

export async function POST(request: Request) {
  // 1. Leer raw body UNA sola vez (necesario para HMAC).
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(raw, hmac)) {
    console.warn("[/api/shopify/webhooks/orders-paid] HMAC inválido");
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }

  // 2. Shop domain (header canónico de Shopify).
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!isValidShopDomain(shop)) {
    console.warn("[/api/shopify/webhooks/orders-paid] shop inválido:", shop);
    return NextResponse.json({ error: "shop inválido" }, { status: 400 });
  }

  // 3. Lookup tienda. Mismo include que /api/shopify/rates (empresa + Modo B
  //    + depósito predeterminado) — necesario para armar el bulto + persistir
  //    CotizacionSnapshot (si quisiéramos — Fase 3 lo omite por simplicidad,
  //    DEUDA 111 se cubre vía rates callback).
  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain: shop! },
    include: {
      empresa: {
        select: {
          empaqueModoBActivo: true,
          empaqueModoBPesoKg: true,
          empaqueModoBLargoCm: true,
          empaqueModoBAnchoCm: true,
          empaqueModoBAltoCm: true,
          depositos: {
            where: { eliminado: false, activo: true, esPredeterminado: true },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!tienda || tienda.estado !== "instalada") {
    // 200 no-op: Shopify no debería reintentar (la tienda no está en Shipro).
    console.warn("[/api/shopify/webhooks/orders-paid] tienda no instalada:", shop);
    return NextResponse.json({ status: "accepted" }, { status: 200 });
  }

  // 4. Parse del body (post-HMAC OK).
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Snapshot de primitives + strings para el closure del after() (evita
  // retener el payload completo + la tienda completa en memoria).
  const empresaId = tienda.empresaId;
  const tiendaShopifyId = tienda.id;
  const shopDomain = shop!;
  const orderIdNumerico = String(payload?.id ?? "");
  const orderGid = orderIdNumerico ? `gid://shopify/Order/${orderIdNumerico}` : "";
  const shippingLines: ShopifyShippingLine[] = Array.isArray(payload?.shipping_lines)
    ? payload.shipping_lines
    : [];
  const shippingLine = shippingLines[0] ?? null;
  const shippingLineCode = typeof shippingLine?.code === "string" ? shippingLine.code : null;
  const shippingLinePrice = Number(shippingLine?.price ?? 0) || 0;
  const direccion: ShopifyAddress = payload?.shipping_address ?? {};
  const lineItems: ShopifyLineItem[] = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const totalPrice = Number(payload?.total_price ?? 0) || 0;

  // Modo B / default params de empresa.
  const empSnap = tienda.empresa;
  const modoBActivo = !!empSnap?.empaqueModoBActivo;
  const empaqueModoB = {
    activo: modoBActivo,
    pesoKg: empSnap?.empaqueModoBPesoKg ?? null,
    largoCm: empSnap?.empaqueModoBLargoCm ?? null,
    anchoCm: empSnap?.empaqueModoBAnchoCm ?? null,
    altoCm: empSnap?.empaqueModoBAltoCm ?? null,
  };

  // Devolver 200 inmediato — Shopify corta a 5s.
  const respuesta = NextResponse.json({ status: "accepted" }, { status: 200 });

  after(async () => {
    try {
      if (!orderGid) {
        console.warn("[/api/shopify/webhooks/orders-paid] order id ausente, skip");
        return;
      }

      // Resolver accessToken PLAINTEXT via getShopifyAccessToken — hace el
      // refresh lazy si expiró (patrón ML tokens.ts). Si falla (tienda sin
      // token, estado != "instalada", refresh muerto) → log + skip; NO
      // rompemos el webhook (mismo espíritu que el skip anterior cuando faltaba
      // el accessToken crudo). Si funciona, reusamos el plaintext para las dos
      // llamadas (obtenerFO + push) — getShopifyAccessToken es idempotente y
      // vuelve a hacer refresh si lo volvieran a llamar.
      let accessTokenPlano: string;
      try {
        accessTokenPlano = await getShopifyAccessToken(shopDomain);
      } catch (e) {
        console.warn(
          "[/api/shopify/webhooks/orders-paid] getShopifyAccessToken falló, skip:",
          { shopDomain, err: e instanceof Error ? e.message : String(e) },
        );
        return;
      }

      // a. FulfillmentOrders con CREATE_FULFILLMENT.
      let fulfillmentOrders;
      try {
        fulfillmentOrders = await obtenerFulfillmentOrders(
          shopDomain,
          accessTokenPlano,
          orderGid,
        );
      } catch (e) {
        console.error(
          "[/api/shopify/webhooks/orders-paid] obtenerFulfillmentOrders falló:",
          e,
        );
        return;
      }
      if (fulfillmentOrders.length === 0) {
        console.warn(
          "[/api/shopify/webhooks/orders-paid] sin FOs con CREATE_FULFILLMENT:",
          orderGid,
        );
        return;
      }
      const foId = fulfillmentOrders[0].id;

      // DEUDA #3 — Multi-FO: si Shopify partió el pedido en varias fulfillment
      // orders (multi-depósito / multi-location), HOY sólo cumplimos la primera.
      // NO construimos el despacho multi-FO completo (edge poco común + semántica
      // ambigua sin un payload real que observar), pero tampoco descartamos las
      // demás en silencio: lo logueamos fuerte + auditoría para que un operador
      // lo maneje a mano. Best-effort: si la auditoría falla, NO corta el flujo
      // del primer FO (el despacho —lo importante— sigue igual).
      if (fulfillmentOrders.length > 1) {
        const foIdsRestantes = fulfillmentOrders.slice(1).map((f) => f.id);
        console.warn(
          `[/api/shopify/webhooks/orders-paid] MULTI-FO: order ${orderGid} tiene ${fulfillmentOrders.length} fulfillment orders; se procesa SOLO la primera (${foId}). FOs sin procesar: ${foIdsRestantes.join(", ")}`,
        );
        try {
          await prisma.auditoriaConfiguracion.create({
            data: {
              empresaId,
              courierId: null,
              campo: "shopify:multi_fulfillment_order",
              valorAnterior: null,
              valorNuevo: `order=${orderGid} fos=${fulfillmentOrders.length} procesado=${foId} sin_procesar=[${foIdsRestantes.join(", ")}]`,
              motivo:
                "Pedido Shopify con múltiples fulfillment orders: se cumplió solo la primera. Revisar y despachar las restantes a mano.",
              usuarioEmail: null,
              rolUsuario: "system",
              ipOrigen: null,
            },
          });
        } catch (e) {
          console.error(
            "[/api/shopify/webhooks/orders-paid] no se pudo registrar auditoría MULTI-FO (no corta el flujo):",
            e,
          );
        }
      }

      // b. Idempotencia: si ya existe Envio con (empresaId, idempotencyKey=foId),
      //    skip. El @@unique([empresaId, idempotencyKey]) ya en schema protege;
      //    el chequeo acá evita entrar al débito antes del throw.
      try {
        const yaExiste = await prisma.envio.findFirst({
          where: { empresaId, idempotencyKey: foId },
          select: { id: true, trackingNumber: true, shopifyFulfillmentPushEstado: true },
        });
        if (yaExiste) {
          console.log(
            `[/api/shopify/webhooks/orders-paid] envío ya existe (idempotencyKey=${foId}, id=${yaExiste.id}), skip`,
          );
          return;
        }
      } catch (e) {
        console.error(
          "[/api/shopify/webhooks/orders-paid] guard idempotencia falló (continúo, el schema @@unique protege):",
          e,
        );
      }

      // c. Armar paquete + cotizar.
      const cpDestino = String(direccion?.zip ?? "").trim();
      const provinciaDestino =
        typeof direccion?.province === "string" ? direccion.province : undefined;
      if (!cpDestino) {
        console.warn(
          "[/api/shopify/webhooks/orders-paid] sin cpDestino en shipping_address, skip",
        );
        return;
      }

      let paquetes;
      if (empaqueModoB.activo) {
        paquetes = [
          {
            pesoKg: empaqueModoB.pesoKg ?? PESO_DEFAULT_KG,
            largoCm: empaqueModoB.largoCm ?? 10,
            anchoCm: empaqueModoB.anchoCm ?? 10,
            altoCm: empaqueModoB.altoCm ?? 10,
            valorDeclarado: totalPrice,
            requiereSeguro: false,
          },
        ];
      } else {
        const itemsParaEmpaquetar = lineItems.map((it) => ({
          grams: Number(it?.grams) || 0,
          quantity: Number(it?.quantity) || 1,
          width: 0,
          height: 0,
          depth: 0,
        }));
        const bulto = armarBultoApilado(itemsParaEmpaquetar);
        paquetes = [
          {
            pesoKg: bulto.pesoKg,
            largoCm: bulto.largoCm,
            anchoCm: bulto.anchoCm,
            altoCm: bulto.altoCm,
            valorDeclarado: totalPrice,
            requiereSeguro: false,
          },
        ];
      }

      let resultado;
      try {
        resultado = await cotizar({
          empresaId,
          cpDestino,
          provinciaDestino,
          paquetes,
          valorCarrito: totalPrice || undefined,
          origen: "checkout",
        });
      } catch (e) {
        console.error("[/api/shopify/webhooks/orders-paid] cotizar falló:", e);
        return;
      }

      // d. Resolver cuál opción eligió el buyer.
      const opcion = resolverOpcionElegida(
        resultado.domicilio ?? [],
        shippingLineCode,
        shippingLinePrice,
      );
      if (!opcion) {
        console.warn(
          `[/api/shopify/webhooks/orders-paid] sin opción resolvible para fo=${foId} code=${shippingLineCode} price=${shippingLinePrice}`,
        );
        return;
      }

      // e. Mapear a CrearEnvioInput.
      const destinatarioNombre =
        direccion?.name?.trim() ||
        [direccion?.first_name, direccion?.last_name].filter(Boolean).join(" ").trim() ||
        "Comprador";
      const calle = direccion?.address1 ?? undefined;
      // Shopify no separa número de calle en line1; mandamos address1 en calle,
      // address2 en piso/dpto como fallback. El motor es tolerante (opcionales).
      const piso = direccion?.address2 ?? undefined;
      const localidad = direccion?.city ?? undefined;
      const telefono = direccion?.phone ?? undefined;

      const bultoPersist = paquetes[0];

      const input: CrearEnvioInput = {
        empresaId,
        destinatarioNombre,
        cpDestino,
        pesoReal: bultoPersist.pesoKg,
        largoCm: bultoPersist.largoCm,
        anchoCm: bultoPersist.anchoCm,
        altoCm: bultoPersist.altoCm,
        nombreCourier: opcion.courier,
        calle,
        piso,
        localidad,
        telefono,
        modalidad: opcion.modalidad,
        valorDeclarado: totalPrice,
        provinciaDestino,
        numeroOrden: payload?.name ?? payload?.order_number?.toString() ?? null,
        idempotencyKey: foId,
        shopifyOrderId: orderGid,
        shopifyFulfillmentOrderId: foId,
        tiendaShopifyId,
        permitirBloqueoPorDeposito: true,
      };

      // f. crearEnvio — MOTOR ÚNICO MONEY-CRÍTICO. Shipro decide rama + cobra.
      let envio;
      try {
        envio = await crearEnvio(input);
      } catch (e) {
        console.error("[/api/shopify/webhooks/orders-paid] crearEnvio falló:", e);
        return;
      }

      // g. Push a Shopify SOLO si hay tracking real. SHP-* = provisorio
      //    (envío bloqueado o sin despacho real); el push se difiere hasta que
      //    el envío se destrabe + obtenga tracking real.
      const trackingNumber = String(envio.trackingNumber ?? "");
      const esProvisoria = !trackingNumber || trackingNumber.startsWith("SHP-");

      if (esProvisoria) {
        try {
          await prisma.envio.update({
            where: { id: envio.id },
            data: { shopifyFulfillmentPushEstado: "PENDING" },
          });
          console.log(
            `[/api/shopify/webhooks/orders-paid] envío ${envio.id} provisorio tracking=${trackingNumber}, push diferido (PENDING)`,
          );
        } catch (e) {
          console.error(
            "[/api/shopify/webhooks/orders-paid] marcar PENDING falló:",
            e,
          );
        }
        return;
      }

      // Tracking real — push.
      const trackingUrl = `${getAppUrlOrThrow()}/s/${trackingNumber}`;
      try {
        const push = await pushFulfillmentShopify({
          shop: shopDomain,
          accessTokenPlano,
          fulfillmentOrderId: foId,
          trackingCompany: opcion.courier,
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
            },
          });
          console.log(
            `[/api/shopify/webhooks/orders-paid] push OK envio=${envio.id} fulfillmentId=${push.fulfillmentId}`,
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
            },
          });
          console.warn(
            `[/api/shopify/webhooks/orders-paid] push FAILED envio=${envio.id} errors=${errorMsg}`,
          );
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
        try {
          await prisma.envio.update({
            where: { id: envio.id },
            data: {
              shopifyFulfillmentPushEstado: "FAILED",
              shopifyFulfillmentPushError: errorMsg,
            },
          });
        } catch (updErr) {
          console.error(
            "[/api/shopify/webhooks/orders-paid] no se pudo marcar FAILED tras throw:",
            updErr,
          );
        }
        console.error(
          `[/api/shopify/webhooks/orders-paid] push threw envio=${envio.id}:`,
          e,
        );
      }
    } catch (e) {
      // Catch de último recurso del after() — no deja crashear el worker.
      console.error("[/api/shopify/webhooks/orders-paid] after() crash:", e);
    }
  });

  return respuesta;
}
