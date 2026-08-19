import prisma from "@/lib/prisma";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";

export const runtime = "nodejs";

// DEUDA 104 — Webhook LGPD Tiendanube: store/redact.
//
// Path FIJO: /api/tiendanube/webhooks/store-redact. Se registra en el Partners
// Portal (no via POST /webhooks), por lo que el URL debe ser conocido y estable.
// El prefix "/api/tiendanube/webhooks/" ya está en proxy.ts PUBLIC_API_PREFIXES.
//
// Payload esperado: { store_id }  — nada más (el evento LGPD es minimal).
//
// DECISIÓN DE PRODUCTO (Nacho, LGPD Argentina + relación comercial):
//   La cuenta Shipro del cliente (Empresa + Usuarios + saldo + CUIT + facturación
//   + historial de envíos + notas internas) NO se toca. La relación con Shipro
//   es SEPARADA de la relación con Tiendanube — el merchant puede estar
//   migrando a Shopify, cambiando de plataforma, etc. Borrar la cuenta sería
//   absurdo y rompería la operación.
//
//   Lo ÚNICO que se purga es el `accessToken` de esta TiendaTiendanube — la
//   credencial OAuth ya está muerta porque Tiendanube desconectó la app;
//   nulificarla remueve el último residuo del vínculo. El `storeId`, `nombre`,
//   `dominio` y `estado` se preservan como registro histórico (útil para audit,
//   analytics, y por si el mismo storeId vuelve).
//
// IDEMPOTENCIA:
//   Tiendanube reintenta cualquier no-2xx hasta 16 veces en 48h. Este handler
//   se protege contra retries de dos maneras:
//     - Store desconocida (nunca registrada) → no-op silencioso.
//     - accessToken ya nulo (purga previa exitosa) → skip update + skip audit
//       row (evita pilar filas idénticas). Log de confirmación y OK.
//   Solo cuando efectivamente hay algo que purgar se hace UPDATE + AUDIT.
//
// AUDIT (compliance proof):
//   Se registra en AuditoriaConfiguracion con campo "lgpd:store_redact" —
//   mismo pattern que "tiendanube:cross_install", "tiendanube:carrier_register_failed".
//   NO se persiste el token en el audit (obviamente); sólo el hecho de que el
//   purge ocurrió + storeId + fecha.
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId }) => {
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
      select: { id: true, empresaId: true, accessToken: true, nombre: true },
    });

    if (!tienda) {
      // Store desconocida — nunca se registró en Shipro vía OAuth. No-op
      // silencioso para que Tiendanube no reintente 48h contra nada.
      console.warn("[webhook store/redact] store desconocida, no-op:", { storeId });
      return;
    }

    // Idempotencia por-retry: si ya lo purgamos, no volvemos a escribir ni a
    // auditar. Deja el resultado observable en logs para debugging.
    if (tienda.accessToken == null) {
      console.log("[webhook store/redact] accessToken ya nulo (retry) — skip:", {
        storeId,
        tiendaId: tienda.id,
      });
      return;
    }

    // Purga mínima: SÓLO el accessToken. NO tocar nombre, dominio, storeId,
    // estado, empresaId, shippingCarrierId, ni ninguna FK. La Empresa/Usuarios/
    // financials/history quedan intactas por decisión de producto.
    await prisma.tiendaTiendanube.update({
      where: { storeId },
      data: { accessToken: null },
    });

    // Registro compliance en AuditoriaConfiguracion. Mismo pattern que
    // "tiendanube:cross_install" en el OAuth callback. NO poner PII/token en
    // los campos de valorAnterior/valorNuevo — sólo el hecho.
    await prisma.auditoriaConfiguracion
      .create({
        data: {
          empresaId: tienda.empresaId,
          campo: "lgpd:store_redact",
          valorAnterior: "accessToken presente",
          valorNuevo:
            "accessToken purgado (vínculo Tiendanube cortado); cuenta + historial conservados",
          motivo: `LGPD store/redact de Tiendanube (storeId=${storeId})`,
        },
      })
      .catch((auditErr) =>
        // Que el audit falle NO revierte el purge — el purge es lo que importa
        // para compliance. Loguear para investigación posterior.
        console.error("[webhook store/redact] audit no persistió:", {
          storeId,
          err: String(auditErr).slice(0, 300),
        }),
      );

    console.log("[webhook store/redact] accessToken purgado:", {
      storeId,
      tiendaId: tienda.id,
    });
  });
}
