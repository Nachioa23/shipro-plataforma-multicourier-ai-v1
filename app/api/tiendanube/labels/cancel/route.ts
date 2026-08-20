import { NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { cancelarTramosEnCourier } from "@/lib/tiendanube/cancelar-tramos";

// El path Tiendanube-facing es {callback_labels_url}/cancel. Por eso el archivo vive
// en /api/tiendanube/labels/cancel/route.ts — Tiendanube nos pega directo acá.
export const runtime = "nodejs";
// El después-de-responder (after()) ejecuta el llamado al courier (Andreani/Mocis
// pueden tardar 10-40s). El maxDuration cubre esa ventana; la response
// ya se fue en <5s (requisito de Tiendanube).
export const maxDuration = 60;

// DEUDA 104 (Homologación shipping) — Labels callback /cancel de Tiendanube.
//
// Endpoint PUBLIC (registrado en proxy.ts PUBLIC_API_EXACT). Los labels callbacks
// NO están firmados con HMAC (a diferencia de los webhooks LGPD). AUTH es el
// lookup en BD: si el labelId matchea a una EtiquetaTiendanube y su tienda está
// "instalada", el pedido es legítimo; si no, ese label queda FAILED (per-label,
// no rompe el batch entero).
//
// CONTRATO (Poggi + doc oficial):
//   Body: { labels: [{ fulfillment_order_id, label_id }, ...] } — sin store_id,
//         sin order_id, sin reason.
//   Response 200 (sin body) si TODAS resolvieron OK.
//   Response 207 con { labels: [{ fulfillment_order_id, label_id, status: "OK"|"FAILED",
//         reason?: { code, message } }] } si alguna quedó FAILED.
//   reason.code catalog: LABEL_IN_TRANSIT, LABEL_DELIVERED, CANCELLATION_WINDOW_EXPIRED,
//         CARRIER_SYSTEM_ERROR, CARRIER_POLICY_VIOLATION, INSUFFICIENT_PERMISSIONS,
//         CARRIER_CANCELLATION_REJECTED.
//   Estados NO cancelables (Tiendanube-side): READY_TO_DOWNLOAD, FAILED, SUSPENDED.
//         CANCELED ya está cancelada → OK idempotente.
//         Cancelables: READY_TO_USE, DOWNLOADED, IN_PROGRESS, STARTED.
//
// DESIGN (Nacho, authoritative): idempotente-con-veredicto-persistido.
//   Por label:
//     - Si cancelacionResueltaEn != null → veredicto YA guardado → responder INSTANT
//       con el guardado (OK, o FAILED+reason). Este es el retry path — no re-invoca
//       al courier. Idempotencia estricta.
//     - Si no está resuelto → correr validaciones sync (existencia, estado
//       cancelable, provisoria). Si es provisoria → marcar CANCELED + persistir OK
//       sync, listo. Si es cancelable normal → marcar envío CANCELADO en Shipro
//       (source of truth) + responder OK optimista + disparar el courier cancel en
//       after() que persiste el veredicto real. On failure background → ticket +
//       auditoría para que el operador resuelva; el veredicto persiste como FAILED,
//       así que un retry de Tiendanube devuelve la verdad y a nadie se le miente.
export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.labels)) {
      // Envelope malformado ≠ per-label FAILED. Es un 400 del batch.
      return NextResponse.json({ error: "Body inválido: se esperaba { labels: [...] }" }, { status: 400 });
    }

    const results: Array<{
      fulfillment_order_id: string;
      label_id: string;
      status: "OK" | "FAILED";
      reason?: { code: string; message: string };
    }> = [];

    for (const item of body.labels) {
      const labelId = item?.label_id != null ? String(item.label_id) : "";
      const fulfillmentOrderId = item?.fulfillment_order_id != null ? String(item.fulfillment_order_id) : "";

      if (!labelId || !fulfillmentOrderId) {
        // Item malformado dentro del batch → per-label FAILED, no rompe el resto.
        results.push({
          fulfillment_order_id: fulfillmentOrderId,
          label_id: labelId,
          status: "FAILED",
          reason: { code: "CARRIER_CANCELLATION_REJECTED", message: "Item sin label_id o fulfillment_order_id" },
        });
        continue;
      }

      // ---- Lookup: label + envío + tramos + tienda ----
      // Este findUnique ES la auth: si el labelId no está en nuestra BD (o su tienda
      // no está instalada), no operamos ese label.
      const etiqueta = await prisma.etiquetaTiendanube.findUnique({
        where: { labelId },
        include: {
          envio: {
            include: {
              courier: true,
              tramos: {
                include: { courier: true },
                orderBy: { orden: "asc" },
              },
            },
          },
          tienda: {
            select: { storeId: true, accessToken: true, estado: true },
          },
        },
      });

      // Label desconocido → FAILED (no 404 del batch).
      if (!etiqueta) {
        results.push({
          fulfillment_order_id: fulfillmentOrderId,
          label_id: labelId,
          status: "FAILED",
          reason: { code: "CARRIER_CANCELLATION_REJECTED", message: "Etiqueta desconocida" },
        });
        continue;
      }

      // Tienda no instalada → INSUFFICIENT_PERMISSIONS (label existe pero no
      // podemos operar en su tienda; equivalente a "permisos revocados").
      if (etiqueta.tienda.estado !== "instalada") {
        results.push({
          fulfillment_order_id: fulfillmentOrderId,
          label_id: labelId,
          status: "FAILED",
          reason: { code: "INSUFFICIENT_PERMISSIONS", message: "La tienda no está instalada" },
        });
        continue;
      }

      // ---- Idempotencia por veredicto persistido ----
      // Si ya resolvimos este label en un llamado previo, devolvemos el veredicto
      // guardado tal cual. Sin re-invocar al courier. Retry de Tiendanube → sirve
      // la verdad ya conocida.
      if (etiqueta.cancelacionResueltaEn != null) {
        if (etiqueta.cancelacionEstado === "OK") {
          results.push({ fulfillment_order_id: fulfillmentOrderId, label_id: labelId, status: "OK" });
        } else {
          results.push({
            fulfillment_order_id: fulfillmentOrderId,
            label_id: labelId,
            status: "FAILED",
            reason: {
              code: etiqueta.cancelacionReasonCode ?? "CARRIER_CANCELLATION_REJECTED",
              message: etiqueta.cancelacionReasonMessage ?? "El courier rechazó la cancelación",
            },
          });
        }
        continue;
      }

      // ---- Estado Tiendanube-side ya CANCELED → OK idempotente ----
      if (etiqueta.estado === "CANCELED") {
        // Persistimos el veredicto OK si aún no está (defensivo — normalmente ya
        // debería estarlo si estado=CANCELED, pero podría haberse marcado por otro
        // flow sin pasar por acá).
        await prisma.etiquetaTiendanube
          .update({
            where: { id: etiqueta.id },
            data: {
              cancelacionEstado: "OK",
              cancelacionResueltaEn: new Date(),
            },
          })
          .catch((e) => console.error("[/api/tiendanube/labels/cancel] no se pudo persistir OK idempotente:", e));
        results.push({ fulfillment_order_id: fulfillmentOrderId, label_id: labelId, status: "OK" });
        continue;
      }

      // ---- Estados no cancelables (política Tiendanube) ----
      if (etiqueta.estado === "READY_TO_DOWNLOAD" || etiqueta.estado === "SUSPENDED" || etiqueta.estado === "FAILED") {
        results.push({
          fulfillment_order_id: fulfillmentOrderId,
          label_id: labelId,
          status: "FAILED",
          reason: {
            code: "CARRIER_POLICY_VIOLATION",
            message: `Estado no cancelable (${etiqueta.estado})`,
          },
        });
        continue;
      }

      // ---- Etiqueta provisoria (SHP-*, sin tramos courier) ----
      // No hay courier al que llamar — marcamos todo cancelado sync y devolvemos OK.
      if (etiqueta.esProvisoria) {
        const ahora = new Date();
        await prisma.$transaction([
          prisma.etiquetaTiendanube.update({
            where: { id: etiqueta.id },
            data: {
              estado: "CANCELED",
              cancelacionEstado: "OK",
              cancelacionResueltaEn: ahora,
            },
          }),
          prisma.envio.update({
            where: { id: etiqueta.envioId },
            data: { estadoActual: "CANCELADO" },
          }),
        ]);
        results.push({ fulfillment_order_id: fulfillmentOrderId, label_id: labelId, status: "OK" });
        continue;
      }

      // ---- Etiqueta normal cancelable: optimista + trabajo en after() ----
      // 1) Shipro es fuente de verdad → marcamos CANCELADO ya (sync).
      // 2) Escribimos ONE EventoTracking con sincronizadoTiendanubeEn = ahora
      //    para que el barrido de reintento NO re-empuje este evento
      //    (Tiendanube ya nos avisó — no le mandamos su propia señal de vuelta).
      // 3) Respondemos OK optimista para este label.
      // 4) after() invoca al courier y persiste el veredicto real. Si el courier
      //    rechaza → ticket + auditoría; el veredicto queda FAILED y un retry de
      //    Tiendanube devolverá la verdad.
      const ahora = new Date();
      const envioId = etiqueta.envioId;
      const etiquetaId = etiqueta.id;
      const trackingNumber = etiqueta.envio.trackingNumber;
      const empresaIdEnvio = etiqueta.envio.empresaId;
      const envioParaWorker = {
        id: etiqueta.envio.id,
        empresaId: etiqueta.envio.empresaId,
        courierId: etiqueta.envio.courierId,
        tramos: etiqueta.envio.tramos.map((t) => ({
          orden: t.orden,
          trackingExterno: t.trackingExterno,
          courierId: t.courierId,
          courier: { nombre: t.courier.nombre },
        })),
      };

      await prisma.$transaction([
        prisma.envio.update({
          where: { id: envioId },
          data: { estadoActual: "CANCELADO" },
        }),
        prisma.etiquetaTiendanube.update({
          where: { id: etiquetaId },
          data: { estado: "CANCELED" },
        }),
        prisma.eventoTracking.create({
          data: {
            estado: "CANCELADO",
            observacion: "[Cancelación Tiendanube] Cancelación pedida por Tiendanube; intentando cancelar en courier.",
            envioId: envioId,
            // Marcamos sync como YA sincronizado con Tiendanube: la cancelación viene
            // DE Tiendanube; no hay que empujársela de vuelta a su timeline.
            sincronizadoTiendanubeEn: ahora,
          },
        }),
      ]);

      // Trabajo pesado — corre después del 200/207.
      after(async () => {
        try {
          const r = await cancelarTramosEnCourier(envioParaWorker);
          if (r.ok) {
            await prisma.etiquetaTiendanube.update({
              where: { id: etiquetaId },
              data: {
                cancelacionEstado: "OK",
                cancelacionResueltaEn: new Date(),
              },
            });
            console.log(
              `[/api/tiendanube/labels/cancel] courier canceló OK labelId=${labelId} envioId=${envioId} tramosOk=${r.tramosCancelados}`,
            );
            return;
          }

          // Courier rechazó / falló en ≥1 tramo. Persistir FAILED + alertar al operador.
          const reasonMessage = (r.mensajeCourier ?? "El courier rechazó la cancelación").slice(0, 300);
          await prisma.etiquetaTiendanube.update({
            where: { id: etiquetaId },
            data: {
              cancelacionEstado: "FAILED",
              cancelacionReasonCode: "CARRIER_CANCELLATION_REJECTED",
              cancelacionReasonMessage: reasonMessage,
              cancelacionResueltaEn: new Date(),
            },
          });

          // Ticket operador (dedup: skip si ya hay ABIERTO/EN_PROCESO para este envío).
          const ticketAbierto = await prisma.ticketSoporte.findFirst({
            where: { envioId, estado: { in: ["ABIERTO", "EN_PROCESO"] } },
            select: { id: true },
          });
          if (!ticketAbierto) {
            await prisma.ticketSoporte
              .create({
                data: {
                  motivo: "Cancelación en courier falló (pedida por Tiendanube)",
                  estado: "ABIERTO",
                  observacion: `[Alerta Automática] El courier rechazó la cancelación de la etiqueta ${labelId} (envío ${trackingNumber}). Motivo: ${reasonMessage}. Requiere intervención.`,
                  envioId,
                },
              })
              .catch((tErr) =>
                console.error("[/api/tiendanube/labels/cancel] no se pudo crear ticket:", { envioId, err: String(tErr).slice(0, 200) }),
              );
          }

          // Auditoría de configuración (paralela al patrón de otros fallos best-effort).
          await prisma.auditoriaConfiguracion
            .create({
              data: {
                empresaId: empresaIdEnvio,
                campo: "tiendanube:cancel_courier_failed",
                valorAnterior: JSON.stringify({ labelId, envioId, trackingNumber }),
                valorNuevo: JSON.stringify({ mensaje: reasonMessage, tramosFallidos: r.tramosFallidos }),
                motivo: `Cancelación pedida por Tiendanube: el courier rechazó labelId=${labelId}. Ticket abierto para intervención manual.`,
              },
            })
            .catch((aErr) =>
              console.error("[/api/tiendanube/labels/cancel] no se pudo persistir auditoría:", { envioId, err: String(aErr).slice(0, 200) }),
            );

          console.warn(
            `[/api/tiendanube/labels/cancel] courier rechazó cancelación labelId=${labelId} envioId=${envioId} tramosFallidos=${r.tramosFallidos} mensaje="${reasonMessage}"`,
          );
        } catch (workerErr) {
          // Nunca relanzar en after(); la respuesta al cliente ya se fue.
          console.error("[/api/tiendanube/labels/cancel] worker error:", {
            labelId,
            envioId,
            err: workerErr instanceof Error ? workerErr.message : String(workerErr).slice(0, 300),
          });
        }
      });

      // Optimista para el primer response. El veredicto REAL queda persistido para
      // el retry de Tiendanube.
      results.push({ fulfillment_order_id: fulfillmentOrderId, label_id: labelId, status: "OK" });
    }

    // ---- Assemble response ----
    // 200 sin body si TODAS OK; 207 con array si alguna FAILED. Nunca 500 por
    // un fallo per-label (esos ya son FAILED en results).
    const algunFailed = results.some((r) => r.status === "FAILED");
    if (!algunFailed) {
      return new Response(null, { status: 200 });
    }
    return NextResponse.json({ labels: results }, { status: 207 });
  } catch (e) {
    console.error("[/api/tiendanube/labels/cancel] Error interno:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
