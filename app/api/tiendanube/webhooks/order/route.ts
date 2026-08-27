import prisma from "@/lib/prisma";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { dispararGeneracionEtiqueta } from "@/lib/tiendanube/disparar-generacion";

// Ejecutable en Node (prisma + decryptSecret + fetchTiendanube).
export const runtime = "nodejs";

// ============================================================================
// Webhook order/* — automatismo "venta pagada = etiqueta creada" (pieza 3/4).
//
// order/paid es EL disparador del circuito automático de etiquetas. Se emite
// tanto para pagos electrónicos automáticos como para confirmaciones manuales
// de transferencia bancaria por el merchant (verificado en doc Tiendanube).
// La ruta atiende ambos casos con la misma lógica: preguntar por las
// fulfillment-orders del pedido y disparar POST /fulfillment-orders/labels
// contra el ffo que Tiendanube asignó al carrier de Shipro.
//
// El filtro por carrier (¿es este pedido nuestro?) vive DENTRO del helper
// dispararGeneracionEtiqueta — este handler sólo traduce el resultado a
// retry-semantics del webhook:
//   - disparado / no_es_shipro     → 200 (no reintentar).
//   - ffo_ausente                  → throw → 500 → Tiendanube reintenta (caso
//                                     borde documentado por Tiendanube donde
//                                     la fulfillment se crea diferida tras un
//                                     error de procesamiento). Sin cola propia:
//                                     apalancamos el retry del webhook (hasta
//                                     16× en 48h).
//
// Idempotencia: /generate ya dedup por fulfillmentOrderId, así que un order/paid
// duplicado (retry legítimo o accidental) NO crea envíos duplicados. No hace
// falta dedup local acá.
// ============================================================================
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId, event, payload }) => {
    // Guard del evento: sólo actuamos sobre order/paid. Suscribimos únicamente
    // a ese evento, pero mantenemos el guard por defensivo (si en el futuro
    // Tiendanube empieza a rutear otros order/* al mismo endpoint por error).
    if (event !== "order/paid") {
      console.log("[webhook order] evento ignorado:", { event, storeId });
      return;
    }

    const orderId =
      payload?.id != null
        ? String(payload.id)
        : payload?.order_id != null
          ? String(payload.order_id)
          : "";
    if (!orderId) {
      console.warn("[webhook order/paid] payload sin id ni order_id — no-op:", {
        storeId,
      });
      return;
    }

    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
      select: {
        id: true,
        estado: true,
        accessToken: true,
        shippingCarrierId: true,
      },
    });
    if (!tienda) {
      console.warn("[webhook order/paid] store desconocida, no-op:", {
        storeId,
        orderId,
      });
      return;
    }
    if (tienda.estado !== "instalada") {
      console.log("[webhook order/paid] app desinstalada, ignorar:", {
        storeId,
        orderId,
        estado: tienda.estado,
      });
      return;
    }
    if (!tienda.accessToken || !tienda.shippingCarrierId) {
      // Tienda a medio configurar (sin token o sin carrier registrado): reintentar
      // no cambia nada — hace falta acción manual del operador. Cortamos limpio.
      console.warn(
        "[webhook order/paid] tienda incompleta (token/carrier ausentes), no-op:",
        {
          storeId,
          orderId,
          tieneAccessToken: !!tienda.accessToken,
          tieneShippingCarrierId: !!tienda.shippingCarrierId,
        },
      );
      return;
    }

    const accessToken = decryptSecret(tienda.accessToken);
    const r = await dispararGeneracionEtiqueta({
      storeId,
      orderId,
      accessToken,
      shippingCarrierId: tienda.shippingCarrierId,
    });

    if (r.estado === "disparado") {
      console.log("[webhook order/paid] disparado:", {
        storeId,
        orderId,
        ffoId: r.ffoId,
      });
      return;
    }
    if (r.estado === "no_es_shipro") {
      console.log(
        "[webhook order/paid] pedido con otra transportadora, ignorar:",
        { storeId, orderId },
      );
      return;
    }
    // ffo_ausente: la fulfillment todavía no existe. Tiendanube documenta este
    // caso (creación diferida tras un error de procesamiento del lado de ellos).
    // Fuerza 500 → retry del webhook con backoff hasta 48h.
    throw new Error(
      `ffo_ausente para order ${orderId} store ${storeId} — retry`,
    );
  });
}
