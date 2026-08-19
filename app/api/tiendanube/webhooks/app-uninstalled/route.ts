import prisma from "@/lib/prisma";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";

// pdf-lib no involved, pero seguimos con nodejs runtime para consistencia con
// los otros callbacks Tiendanube y para que `prisma` corra en Node (no edge).
export const runtime = "nodejs";

// DEUDA 104 — Webhook Tiendanube: app/uninstalled.
//
// Path: /api/tiendanube/webhooks/app-uninstalled  (registrado en proxy.ts
// PUBLIC_API_PREFIXES vía prefix "/api/tiendanube/webhooks/"). Self-auth vía
// HMAC en el handler compartido.
//
// Payload esperado (per contrato Tiendanube): { store_id, event: "app/uninstalled", id }
// donde `id` es el app_id (no lo usamos — nuestro pivot es storeId).
//
// SEMÁNTICA: la tienda se marca como "desinstalada" + timestamp. Idempotente:
// - Ejecutar múltiples veces sobre el mismo storeId da el mismo resultado
//   (estado ya en "desinstalada" + desinstaladaEn tal vez actualizado — vale).
// - Si la tienda no existe en BD (raro pero posible: el operador nunca la
//   registró vía OAuth), no-op silencioso — retornamos limpio para que
//   Tiendanube no reintente 48h por nada.
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId }) => {
    const tienda = await prisma.tiendaTiendanube.findUnique({ where: { storeId } });
    if (!tienda) {
      console.warn("[webhook app/uninstalled] store desconocida, no-op:", { storeId });
      return;
    }
    await prisma.tiendaTiendanube.update({
      where: { storeId },
      data: { estado: "desinstalada", desinstaladaEn: new Date() },
    });
    console.log("[webhook app/uninstalled] tienda marcada desinstalada:", {
      storeId,
      tiendaId: tienda.id,
    });
  });
}
