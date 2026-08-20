import { after } from "next/server";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";
import { redactCustomer } from "@/lib/tiendanube/lgpd-redact";

export const runtime = "nodejs";
// El redact real puede tocar muchos envíos (queries + updateMany + audit).
// Corre en after() DESPUÉS del 200 — Tiendanube exige 2XX en <3s. maxDuration
// da margen para el background work sin bloquear la respuesta.
export const maxDuration = 60;

// DEUDA 104 — Webhook LGPD Tiendanube: customers/redact.
//
// Path FIJO: /api/tiendanube/webhooks/customers-redact. Registrado en el
// Partners Portal como URL fija. El prefix "/api/tiendanube/webhooks/" ya está
// en proxy.ts PUBLIC_API_PREFIXES.
//
// Payload esperado:
//   { store_id, customer: {id, email, phone, identification}, orders_to_redact: [order_id...] }
//
// FLOW:
//   1. Validar HMAC + envelope (handleTiendanubeWebhook lo hace).
//   2. En process(): extraer customer + orderIds del payload.
//   3. Schedule redactCustomer() en after() — responde 200 rápido; el trabajo
//      pesado (match envíos + anonimizar direcciones + auditar) corre después.
//   4. handleTiendanubeWebhook resuelve process → 200 OK.
//
// La política de anonimización + idempotencia + audit viven en el helper
// lib/tiendanube/lgpd-redact.ts. Ver el header comment de ese archivo para el
// detalle de NULL personal / KEEP postal y el rationale.
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId, payload }) => {
    // Extract minimal — todo lo demás lo hace el helper.
    const customer = payload?.customer ?? {};
    const email = customer?.email ? String(customer.email) : null;
    const documento = customer?.identification ? String(customer.identification) : null;
    const orderIds = Array.isArray(payload?.orders_to_redact)
      ? payload.orders_to_redact
          .filter((v: unknown) => v != null)
          .map((v: unknown) => String(v))
      : [];

    // El trabajo pesado (queries + updateMany + audit) corre después de la
    // response — Tiendanube exige 2XX en <3s.
    after(async () => {
      try {
        await redactCustomer({ storeId, orderIds, email, documento });
      } catch (e) {
        // NO relanzamos — el 200 ya se mandó; un throw acá sólo llenaría logs.
        // Un failure real (BD caída, etc.) queda registrado; el próximo retry
        // legítimo de Tiendanube (16× en 48h) ejecutará el redact — pero la
        // response del retry es 200 porque `process` no re-ejecuta after() ya
        // que la primera respondió OK. Design consideration: si el redact
        // falla silenciosamente en after(), el compliance queda incompleto.
        // Mitigación futura: cron de retry sobre pending LGPD requests.
        console.error("[webhook customers/redact] background error:", {
          storeId,
          err: e instanceof Error ? e.message : String(e).slice(0, 300),
        });
      }
    });
  });
}
