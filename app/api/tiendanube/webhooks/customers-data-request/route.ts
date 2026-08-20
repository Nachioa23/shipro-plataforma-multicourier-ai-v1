import { after } from "next/server";
import prisma from "@/lib/prisma";
import { handleTiendanubeWebhook } from "@/lib/tiendanube/webhook-handler";
import { generarReporteDatosComprador } from "@/lib/tiendanube/lgpd-data-report";
import { enviarMailGenerico } from "@/lib/mailer";

export const runtime = "nodejs";
// El reporte real toca N envíos + build de un workbook Excel + envío de mail
// con attachment. Corre en after() DESPUÉS del 200 — Tiendanube exige 2XX en
// <3s. maxDuration da margen para el background work.
export const maxDuration = 60;

// DEUDA 104 — Webhook LGPD Tiendanube: customers/data_request.
//
// Path FIJO: /api/tiendanube/webhooks/customers-data-request. Registrado en el
// Partners Portal como URL fija. El prefix "/api/tiendanube/webhooks/" ya está
// en proxy.ts PUBLIC_API_PREFIXES.
//
// Payload esperado:
//   { store_id,
//     customer: {id, email, phone, identification},
//     orders_requested: [order_id...],
//     checkouts_requested: [...], drafts_orders_requested: [...],
//     data_request: { id } }
//
// FLOW:
//   1. Validar HMAC + envelope (handleTiendanubeWebhook lo hace).
//   2. En process(): extraer customer + orderIds + data_request.id.
//   3. Schedule el trabajo en after() — responde 200 rápido; el background
//      hace: idempotency check → resolver contact del merchant → compilar el
//      reporte Excel → mandar mail con attachment → auditar.
//
// DECISIONES CLAVE:
//   - REPORTE = COMPLETO (todos los datos del comprador). READ-ONLY: cero
//     mutaciones. Este webhook nunca borra ni anonimiza — sólo compila y
//     entrega. La anonimización real vive en customers/redact.
//   - DELIVERY = Excel adjunto al mail al merchant (no UI, automático). El
//     merchant reenvía al comprador para responder la solicitud LGPD.
//   - CONTACT: cascade gerente_cliente activo → operador_cliente activo → sin
//     contacto (audit "sin contacto", no send). Multiple gerentes = mail a todos.
//   - IDEMPOTENCY: `data_request.id` en el `motivo` del audit sirve como key.
//     Un retry con el mismo id lo detecta y hace skip (no duplica mail).
//
// AUDIT (compliance proof):
//   Fila en AuditoriaConfiguracion con campo="lgpd:customers_data_request",
//   counts + destinatarios + data_request_id en el motivo. NO PII del buyer en
//   el audit.
export async function POST(request: Request) {
  return handleTiendanubeWebhook(request, async ({ storeId, payload }) => {
    // Extract minimal — el helper hace todo el trabajo pesado.
    const customer = payload?.customer ?? {};
    const email = customer?.email ? String(customer.email) : null;
    const documento = customer?.identification ? String(customer.identification) : null;
    const orderIds = Array.isArray(payload?.orders_requested)
      ? payload.orders_requested
          .filter((v: unknown) => v != null)
          .map((v: unknown) => String(v))
      : [];
    const dataRequestId = payload?.data_request?.id != null
      ? String(payload.data_request.id)
      : "";

    // Trabajo pesado en after() — Tiendanube ya recibió su 200.
    after(async () => {
      try {
        // ---- IDEMPOTENCY GUARD ----
        // Buscamos un audit previo con este data_request.id en el motivo. Si
        // existe, es un retry legítimo (o duplicado accidental) — skip para
        // no re-enviar mail ni duplicar audit.
        if (dataRequestId) {
          const audit = await prisma.auditoriaConfiguracion.findFirst({
            where: {
              campo: "lgpd:customers_data_request",
              motivo: { contains: `data_request_id=${dataRequestId}` },
            },
            select: { id: true },
          });
          if (audit) {
            console.log("[lgpd customers/data_request] retry sobre request ya procesado — skip:", {
              storeId,
              dataRequestId,
            });
            return;
          }
        }

        // ---- COMPILAR REPORTE ----
        const reporte = await generarReporteDatosComprador({
          storeId,
          orderIds,
          email,
          documento,
        });

        // ---- RESOLVER CONTACT DEL MERCHANT ----
        // Necesitamos empresaId. El reporte ya intentó resolverlo (vía envíos
        // matched o vía TiendaTiendanube). Si null → store totalmente
        // desconocida → audit "sin contacto" con empresaId no aplicable.
        if (reporte.empresaId === null) {
          console.warn("[lgpd customers/data_request] store desconocida — skip:", {
            storeId,
            dataRequestId,
          });
          return;
        }

        // Cascade: gerente_cliente activo → operador_cliente activo → sin
        // contacto (audit + no send).
        const gerentes = await prisma.usuario.findMany({
          where: { empresaId: reporte.empresaId, activo: true, rol: "gerente_cliente" },
          select: { email: true },
        });
        let contactos = gerentes.map((u) => u.email);
        if (contactos.length === 0) {
          const operadores = await prisma.usuario.findMany({
            where: { empresaId: reporte.empresaId, activo: true, rol: "operador_cliente" },
            select: { email: true },
          });
          contactos = operadores.map((u) => u.email);
        }

        if (contactos.length === 0) {
          console.warn("[lgpd customers/data_request] sin contactos activos — audit sin envío:", {
            storeId,
            empresaId: reporte.empresaId,
            dataRequestId,
          });
          await prisma.auditoriaConfiguracion
            .create({
              data: {
                empresaId: reporte.empresaId,
                campo: "lgpd:customers_data_request",
                valorAnterior: `${reporte.enviosCount} envíos matched`,
                valorNuevo: "sin contactos activos (gerente_cliente/operador_cliente) — reporte NO enviado",
                motivo: `LGPD customers/data_request de Tiendanube (storeId=${storeId}, data_request_id=${dataRequestId})`,
              },
            })
            .catch((auditErr) =>
              console.error("[lgpd customers/data_request] audit no persistió (sin contactos):", {
                storeId,
                err: String(auditErr).slice(0, 300),
              }),
            );
          return;
        }

        // ---- ENVIAR MAIL CON ATTACHMENT ----
        const htmlBody = `
          <h2 style="color: #233b6b;">Pedido de datos personales (LGPD)</h2>
          <p>Recibiste un pedido de acceso a datos personales de un comprador (vía Tiendanube / ley de datos).</p>
          <p>Adjuntamos un Excel con toda la información que Shipro tiene de ese comprador: sus datos de
             contacto y el detalle de sus envíos con historial de seguimiento. Reenvialo al comprador para
             responder su solicitud.</p>
          <p><strong>Envíos incluidos:</strong> ${reporte.enviosCount}</p>
          <p style="font-size: 12px; color: #666;">Este mail es automático de Shipro. La legislación te da un plazo
             para responder al comprador; consultá con tu asesor legal si tenés dudas sobre el proceso.</p>
        `;
        const enviado = await enviarMailGenerico(
          contactos,
          "Pedido de datos personales (LGPD) — Tiendanube",
          htmlBody,
          {
            attachments: [
              {
                filename: "reporte-datos-comprador.xlsx",
                content: reporte.excelBuffer,
                contentType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            ],
          },
        );

        // ---- AUDIT ----
        await prisma.auditoriaConfiguracion
          .create({
            data: {
              empresaId: reporte.empresaId,
              campo: "lgpd:customers_data_request",
              valorAnterior: `${reporte.enviosCount} envíos reportados`,
              valorNuevo: enviado
                ? `Reporte Excel enviado a ${contactos.length} contacto(s)`
                : `Reporte generado pero envío de mail FALLÓ (revisar logs mailer)`,
              motivo: `LGPD customers/data_request de Tiendanube (storeId=${storeId}, data_request_id=${dataRequestId})`,
            },
          })
          .catch((auditErr) =>
            console.error("[lgpd customers/data_request] audit no persistió (post-send):", {
              storeId,
              err: String(auditErr).slice(0, 300),
            }),
          );

        console.log("[lgpd customers/data_request] reporte procesado:", {
          storeId,
          empresaId: reporte.empresaId,
          dataRequestId,
          envios: reporte.enviosCount,
          contactos: contactos.length,
          mailEnviado: enviado,
        });
      } catch (e) {
        // 200 ya se mandó; un throw acá sólo llenaría logs. Un failure real
        // (BD caída, SMTP down) queda registrado.
        console.error("[webhook customers/data_request] background error:", {
          storeId,
          err: e instanceof Error ? e.message : String(e).slice(0, 300),
        });
      }
    });
  });
}
