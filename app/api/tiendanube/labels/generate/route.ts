import { NextResponse, after } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { crearEnvio, type CrearEnvioInput } from "@/lib/envios/crear";
import { derivarServicioLabel } from "@/lib/tiendanube/derivar-servicio-label";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { decryptSecret } from "@/lib/utils/secret-crypto";
import { patchLabelReadyToDownload } from "@/lib/tiendanube/labels-api";

// El path Tiendanube-facing es {callback_labels_url}/generate. Por eso el archivo vive
// en /api/tiendanube/labels/generate/route.ts — Tiendanube nos pega directo acá.
export const runtime = "nodejs";
// El worker de after() ejecuta crearEnvio + despacho al courier (Andreani/Mocis
// pueden tardar 15-40s en total). El maxDuration cubre la ventana completa; el
// response al request ya voló bien antes de esos ~5s de Tiendanube.
export const maxDuration = 60;

// DEUDA 144 (Momento 3 labels, pieza 3a) — Labels callback de Tiendanube.
//
// Endpoint PUBLIC (registrado en proxy.ts PUBLIC_API_EXACT). Self-auth via
// store_id (mismo patrón que /api/tiendanube/rates). Tiendanube NO firma este
// callback: la única credencial es que sepamos resolver el storeId a una
// TiendaTiendanube instalada.
//
// CONTRATO (Poggi): Tiendanube postea un ARRAY de labels. Cada item trae al
// menos `id` (labelId de Tiendanube) y `fulfillment_order_info` con `id` (el
// ffo_id, base de idempotencia), `shipping.option` (code + reference con lo
// que emitimos en rates), y datos del pedido (recipient + destination + items).
// Detalles exactos del shape se confirman contra sandbox durante homologación
// (mismo criterio que rates route: leer defensivamente con optional chaining).
//
// LATENCIA: Tiendanube corta a ~5s. El despacho real al courier tarda más
// (15-40s con Andreani/Mocis), así que TODO EL TRABAJO PESADO corre en
// after() DESPUÉS de responder. El handler mínimo valida store + arma la
// respuesta 200; el after() worker hace crearEnvio + persiste EtiquetaTiendanube.
//
// SCOPE 3a: skeleton — crear envío + persistir fila EtiquetaTiendanube.
//   NO generamos PDF (Shipro-branded ni fetch del courier) — TODO(3b).
//   NO hacemos PATCH a Tiendanube (download_url_from_app / READY_TO_DOWNLOAD) — TODO(3b).
//   NO servimos el download endpoint — TODO(3b).
//
// IDEMPOTENCIA (2 capas):
//   1. crearEnvio + `@@unique([empresaId, idempotencyKey])` con
//      idempotencyKey = fulfillment_order_info.id → mismo ffo pedido dos veces
//      = MISMO Envio, sin doble despacho ni doble débito.
//   2. EtiquetaTiendanube.labelId @unique → un labelId no se persiste dos veces.
//      Guard con findFirst antes de crear (early skip; el @unique es la red final).

// Body defensivo — la doc confirma array de labels; aceptamos también un
// objeto suelto por si el sandbox lo entrega distinto.
function extraerLabels(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") return [body];
  return [];
}

// Shape REAL confirmada 2026-08-26 v2 (payload completo TN-LABELS-DEBUG en prod):
// el callback NO trae store_id en ningún lado. Resolvemos la tienda por
// shipping.carrier.carrier_id — la id del carrier que registramos al conectar la
// app en la tienda (ver TiendaTiendanube.shippingCarrierId).
function extraerCarrierId(labels: any[]): string | null {
  for (const it of labels) {
    const cid = it?.shipping?.carrier?.carrier_id;
    if (typeof cid === "string" && cid.length > 0) return cid;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => null);
    console.log("[TN-LABELS-DEBUG] raw body:", JSON.stringify(body));
    console.log("[TN-LABELS-DEBUG] content-type:", request.headers.get("content-type"));
    if (!body) {
      console.log("[TN-DBG] 422 body-invalido");
      return NextResponse.json({ error: "Body inválido" }, { status: 422 });
    }

    const labels = extraerLabels(body);
    if (labels.length === 0) {
      console.log("[TN-DBG] 422 labels-vacio, body es array?", Array.isArray(body), "typeof body:", typeof body);
      return NextResponse.json({ error: "labels vacío" }, { status: 422 });
    }
    console.log("[TN-DBG] labels.length:", labels.length);

    // Self-auth: el payload NO trae store_id (shape v2 confirmada 2026-08-26).
    // La única señal para identificar la tienda es shipping.carrier.carrier_id — el
    // shippingCarrierId que Tiendanube devolvió al crear el carrier durante el install
    // OAuth. Ese id es único por par (tienda, app), así que basta para la lookup.
    const carrierId = extraerCarrierId(labels);
    console.log("[TN-DBG] carrierId extraido:", carrierId);
    if (!carrierId) {
      console.log("[TN-DBG] 422 carrier-ausente, primer label shipping:", JSON.stringify(labels[0]?.shipping));
      return NextResponse.json({ error: "carrier_id ausente en el payload" }, { status: 422 });
    }
    const tienda = await prisma.tiendaTiendanube.findFirst({
      where: { shippingCarrierId: carrierId, estado: "instalada" },
      select: {
        id: true,
        empresaId: true,
        estado: true,
        storeId: true,
      },
    });
    console.log("[TN-DBG] tienda encontrada:", tienda ? tienda.storeId : "NULL");
    if (!tienda) {
      console.log("[TN-DBG] 422 tienda-no-vinculada, carrierId=", carrierId, "encontrada?", !!tienda);
      return NextResponse.json({ error: "Tienda no vinculada" }, { status: 422 });
    }

    // Snapshot de primitives para el closure de after() — evita retener el
    // Prisma Row completo con todos sus campos.
    const tiendaTiendanubeId = tienda.id;
    const empresaId = tienda.empresaId;
    const storeIdSnapshot = tienda.storeId;

    // ===============================================================
    // Trabajo pesado — corre DESPUÉS de responder 200 a Tiendanube.
    // ===============================================================
    after(async () => {
      for (const item of labels) {
        try {
          // Shape REAL confirmada 2026-08-26 v2 (payload completo TN-LABELS-DEBUG):
          //   - label_id                              → labelId  (¡NO `id`!)
          //   - fulfillment_order_info.id             → ffo_id
          //   - fulfillment_order_info.number         → numeroOrden
          //   - fulfillment_order_info.total_weight   → peso (kg)
          //   - shipping.carrier.carrier_id           → identifica la tienda (resuelto arriba)
          //   - shipping.option.{code,reference,type} → derivar servicio
          //   - recipient / destination / line_items  → TOP-LEVEL en el label (no bajo ffoInfo)
          const labelId = typeof item?.label_id === "string" || typeof item?.label_id === "number" ? String(item.label_id) : "";
          const ffoInfo = item?.fulfillment_order_info ?? {};
          const fulfillmentOrderId =
            typeof ffoInfo?.id === "string" || typeof ffoInfo?.id === "number" ? String(ffoInfo.id) : "";

          if (!labelId || !fulfillmentOrderId) {
            console.error(
              "[/api/tiendanube/labels/generate] item sin labelId/fulfillmentOrderId — skip:",
              { labelId, fulfillmentOrderId },
            );
            continue;
          }

          // Guard idempotente: si ya persistimos este labelId, no reprocesamos.
          // El @unique en el schema es la red final; este check es early-out para
          // evitar disparar crearEnvio (con débito) en un reintento del callback.
          const yaExiste = await prisma.etiquetaTiendanube.findFirst({
            where: { labelId },
            select: { id: true },
          });
          if (yaExiste) {
            console.log(
              `[/api/tiendanube/labels/generate] labelId ya persistido — skip labelId=${labelId}`,
            );
            continue;
          }

          // shipping.option/type — TOP-LEVEL en el label real (confirmado 2026-08-26).
          // Antes se leía anidado bajo fulfillment_order_info (que no existe en el shape real).
          const option = item?.shipping?.option ?? {};
          const shippingType: string | null =
            typeof item?.shipping?.type === "string" ? item.shipping.type : null;

          const derivado = await derivarServicioLabel(
            empresaId,
            {
              code: typeof option?.code === "string" ? option.code : null,
              reference: typeof option?.reference === "string" ? option.reference : null,
            },
            shippingType,
          );

          if (!derivado) {
            // TODO(3b): reportar FAILED a Tiendanube (PATCH del label con estado
            // que corresponda). Por ahora sólo logueamos para tener trazabilidad.
            console.error(
              "[/api/tiendanube/labels/generate] no se pudo derivar servicio — TODO(3b) reportar FAILED:",
              { labelId, fulfillmentOrderId, code: option?.code ?? null },
            );
            continue;
          }

          // ---- Mapping del payload real → CrearEnvioInput ----
          // recipient / destination / line_items son TOP-LEVEL en el label (shape v2 confirmada).
          const recipient = item?.recipient ?? {};
          const destination = item?.destination ?? {};
          const lineItems: any[] = Array.isArray(item?.line_items) ? item.line_items : [];

          // Peso: fulfillment_order_info.total_weight (kg, autoritativo — el server ya sumó).
          // Fallback defensivo: computar de line_items[].unit_dimension.weight (también en kg —
          // payload real 2026-08-26 confirmó unidades kg: 0.24 unit × 3 = 0.72 total_weight).
          // Sin data → 0 → la barrera de crear.ts (DEUDA 132) lo marca BLOQUEADO_DATOS_PAQUETE,
          // que es el comportamiento correcto (no inventamos peso).
          const totalWeightFfo = Number(ffoInfo?.total_weight);
          const computedWeight = lineItems.reduce(
            (acc, li) => acc + (Number(li?.unit_dimension?.weight) || 0) * (Number(li?.quantity) || 1),
            0,
          );
          const pesoReal = Number.isFinite(totalWeightFfo) && totalWeightFfo > 0
            ? totalWeightFfo
            : (computedWeight > 0 ? computedWeight : 0);

          // Dims: primer line_item con medidas > 0. Unit: cm (payload real trae 10, 20 — coherente).
          // TODO(empaquetado real — DEUDA 143): hoy se toman las dims de UN SOLO line_item (el
          // primero con medidas) como aproximación del bulto. Un pedido con varios items queda
          // subdimensionado. El peso SÍ suma todos los items (computedWeight/total_weight arriba),
          // pero las dims no se consolidan.
          const primeroConDims = lineItems.find(
            (li) =>
              Number(li?.unit_dimension?.width) > 0 ||
              Number(li?.unit_dimension?.height) > 0 ||
              Number(li?.unit_dimension?.depth) > 0,
          );
          const largoCm = primeroConDims?.unit_dimension?.depth ?? null;
          const anchoCm = primeroConDims?.unit_dimension?.width ?? null;
          const altoCm = primeroConDims?.unit_dimension?.height ?? null;

          // crearEnvio decide domicilio/sucursal por keyword-match sobre `modalidad`
          // (busca "sucursal" o "retiro" — ver lib/envios/crear.ts). Con estos strings
          // el ruteo interno queda correcto.
          const modalidad =
            derivado.tipoEntrega === "sucursal" ? "Retiro en Sucursal" : "Entrega a Domicilio";

          const input: CrearEnvioInput = {
            empresaId,
            destinatarioNombre: String(recipient?.name ?? "").trim(),
            cpDestino: String(destination?.zipcode ?? destination?.postal_code ?? "").trim(),
            pesoReal,
            largoCm,
            anchoCm,
            altoCm,
            nombreCourier: derivado.courierNombre,
            calle: destination?.street ?? destination?.address ?? undefined,
            altura: destination?.number != null ? String(destination.number) : undefined,
            piso: destination?.floor != null ? String(destination.floor) : undefined,
            // NOTA (verificado vs contrato Tiendanube): el objeto `destination` NO expone un campo
            // `department`. Los campos de dirección son street/number/floor/between_streets. Por eso
            // este mapeo de dpto queda casi siempre undefined desde Tiendanube — el complemento de
            // dirección del comprador viaja en `floor` (ya mapeado arriba a `piso`). Se deja el read
            // defensivo por si un shape futuro lo agrega, pero HOY no hay fuente para dpto.
            dpto: destination?.department != null ? String(destination.department) : undefined,
            dni: recipient?.identifier != null ? String(recipient.identifier) : undefined,
            email: typeof recipient?.email === "string" ? recipient.email : undefined,
            telefono: recipient?.phone != null ? String(recipient.phone) : undefined,
            localidad: destination?.locality ?? destination?.city ?? undefined,
            modalidad,
            // valorDeclarado: el payload real (shape v2) NO trae total_price ni ningún campo
            // de valor declarado. El read defensivo devuelve undefined y el server aplica
            // su política server-side de seguro (contrato: insurance es 100% del server).
            valorDeclarado: Number(ffoInfo?.total_price?.value) || undefined,
            provinciaDestino:
              typeof destination?.province?.name === "string"
                ? destination.province.name
                : typeof destination?.province === "string"
                ? destination.province
                : undefined,
            numeroOrden: ffoInfo?.number != null ? String(ffoInfo.number) : null,
            // Ancla de idempotencia — mismo ffo pedido dos veces = mismo envío,
            // sin doble despacho ni doble débito (schema @@unique).
            idempotencyKey: fulfillmentOrderId,
            sucursalDestinoId: derivado.sucursalId,
            // e-commerce path: si falta depósito/credencial/operatividad/saldo, el envío
            // se crea BLOQUEADO_* con SHP-* (no rompe la venta) y se destraba solo cuando
            // la causa se resuelve (procesarEnviosBloqueados*).
            permitirBloqueoPorDeposito: true,
          };

          let envioResult: any;
          try {
            envioResult = await crearEnvio(input);
          } catch (e) {
            // TODO(3b): reportar FAILED a Tiendanube.
            console.error(
              "[/api/tiendanube/labels/generate] crearEnvio falló — TODO(3b) reportar FAILED:",
              {
                labelId,
                fulfillmentOrderId,
                err: e instanceof Error ? e.message : String(e),
              },
            );
            continue;
          }

          const envioId = Number(envioResult?.id);
          if (!Number.isInteger(envioId)) {
            console.error(
              "[/api/tiendanube/labels/generate] crearEnvio no devolvió envio.id — skip persistencia de etiqueta:",
              { labelId, fulfillmentOrderId },
            );
            continue;
          }

          const estado = String(envioResult?.estado ?? "");
          const trackingNum = String(envioResult?.trackingNumber ?? "");
          // PROVISORIA = el envío NO se emitió en el courier (regla Nacho). Señal robusta cross-courier:
          // el tracking sigue siendo el placeholder SHP-* (un despacho OK — cualquier courier — lo reemplaza
          // por el tracking real). Cubre los 5 BLOQUEADO_* + RETENIDO + cualquier estado futuro sin despacho.
          const esProvisoria = trackingNum.startsWith("SHP-");

          // Token opaco para el endpoint de descarga público (DEUDA 144 Momento 3 Parte 2).
          // 192 bits de entropía vía randomBytes(24) → base64url = 32 chars URL-safe.
          // Sin expiración por tiempo (Nacho lock): la URL vive hasta que la etiqueta se
          // cancele. El single-use NO se enforcea acá (Tiendanube guarda el PDF en su S3).
          // El guard de idempotencia por labelId (arriba) garantiza un solo token por etiqueta.
          const downloadToken = randomBytes(24).toString("base64url");
          const documentoUrl = `${getAppUrlOrThrow()}/api/tiendanube/labels/download?token=${downloadToken}`;

          let filaCreada = false;
          try {
            await prisma.etiquetaTiendanube.create({
              data: {
                envioId,
                tiendaTiendanubeId,
                labelId,
                fulfillmentOrderId,
                estado: "IN_PROGRESS",
                esProvisoria,
                trackingAsociado:
                  typeof envioResult?.trackingNumber === "string"
                    ? envioResult.trackingNumber
                    : null,
                downloadToken,
                documentoUrl,
              },
            });
            filaCreada = true;
          } catch (persistErr) {
            // Race o retry: si el @unique de labelId dispara acá, el early guard no
            // frenó a tiempo (ok — el envío quedó creado, la etiqueta ya está en BD).
            console.error(
              "[/api/tiendanube/labels/generate] persistencia de EtiquetaTiendanube falló (envío sigue vivo):",
              { labelId, fulfillmentOrderId, err: String(persistErr).slice(0, 300) },
            );
          }

          console.log(
            `[/api/tiendanube/labels/generate] label OK store=${storeIdSnapshot} ffo=${fulfillmentOrderId} labelId=${labelId} envioId=${envioId} tracking=${envioResult?.trackingNumber} estado=${estado} provisoria=${esProvisoria}`,
          );

          // Cerrar el circuito: avisar a Tiendanube que la etiqueta está lista para descargar.
          // El PDF NO se genera acá — el endpoint /labels/download lo produce on-the-fly cuando
          // Tiendanube baja de documentoUrl (Parte 2). Best-effort: si el PATCH falla, el envío +
          // la fila ya existen; Tiendanube marca la label FAILED tras 30min y el flujo de reemplazo
          // (pieza posterior) reintenta/cancela. No rompemos el loop por un PATCH fallido.
          // Gate por filaCreada: si el @unique falló arriba (row ya existía o error de BD), no
          // pateamos — evita pisar el estado de una etiqueta que otro flow puede estar manejando.
          if (filaCreada) {
            try {
              // Re-leer el accessToken fresco (la tienda pudo rotar credenciales durante el
              // after()). Extra query pero más robusto que capturar el snapshot en el closure.
              const tiendaAuth = await prisma.tiendaTiendanube.findUnique({
                where: { id: tiendaTiendanubeId },
                select: { accessToken: true },
              });
              if (!tiendaAuth?.accessToken) {
                console.error(
                  "[/api/tiendanube/labels/generate] sin accessToken para PATCH — skip:",
                  { labelId, fulfillmentOrderId },
                );
              } else {
                const trackingCode = String(envioResult?.trackingNumber ?? "");
                await patchLabelReadyToDownload({
                  storeId: storeIdSnapshot,
                  accessToken: decryptSecret(tiendaAuth.accessToken),
                  fulfillmentOrderId,
                  labelId,
                  trackingCode,
                  trackingUrl: `${getAppUrlOrThrow()}/s/${trackingCode}`,
                  downloadUrl: documentoUrl,
                  fileName: `Etiqueta_${labelId}.pdf`,
                });
                console.log(
                  `[/api/tiendanube/labels/generate] PATCH READY_TO_DOWNLOAD OK labelId=${labelId} ffo=${fulfillmentOrderId}`,
                );
              }
            } catch (patchErr) {
              console.error(
                "[/api/tiendanube/labels/generate] PATCH a Tiendanube falló (envío + fila OK; reintento post — pieza posterior):",
                { labelId, fulfillmentOrderId, err: String(patchErr).slice(0, 300) },
              );
            }
          }
        } catch (loopErr) {
          // Nunca romper el for-loop por un item — la falla de uno no debe
          // arrastrar a los demás.
          console.error(
            "[/api/tiendanube/labels/generate] error procesando label — continúa con la siguiente:",
            loopErr,
          );
        }
      }
    });

    // 200 rápido — Tiendanube exige <5s. Todo el trabajo pesado está en after().
    return NextResponse.json({ status: "accepted" }, { status: 200 });
  } catch (e) {
    console.error("[/api/tiendanube/labels/generate] Error interno:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
