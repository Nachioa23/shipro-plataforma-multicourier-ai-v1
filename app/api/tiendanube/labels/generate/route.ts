import { NextResponse, after } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { crearEnvio, type CrearEnvioInput } from "@/lib/envios/crear";
import { derivarServicioLabel } from "@/lib/tiendanube/derivar-servicio-label";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

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

// storeId: puede venir en cada item.fulfillment_order_info.store_id o en top-level.
// TODO(3b/homologación): confirmar ubicación exacta contra la request real. Leer
// defensivamente y quedarnos con el primer candidato válido.
function extraerStoreId(body: any, labels: any[]): number | null {
  for (const it of labels) {
    const s = Number(it?.fulfillment_order_info?.store_id);
    if (Number.isInteger(s)) return s;
  }
  const t = Number(body?.store_id);
  return Number.isInteger(t) ? t : null;
}

export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Body inválido" }, { status: 422 });
    }

    const labels = extraerLabels(body);
    if (labels.length === 0) {
      return NextResponse.json({ error: "labels vacío" }, { status: 422 });
    }

    const storeId = extraerStoreId(body, labels);
    if (storeId === null) {
      return NextResponse.json({ error: "store_id inválido" }, { status: 422 });
    }

    // Self-auth: mirror de rates route. Mismo mensaje genérico para "no existe"
    // y "no instalada" para no revelar existencia. Empresa se selecciona mínima
    // — el after() la re-lee si necesita más campos.
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
      select: {
        id: true,
        empresaId: true,
        estado: true,
      },
    });
    if (!tienda || tienda.estado !== "instalada") {
      return NextResponse.json({ error: "Tienda no vinculada" }, { status: 422 });
    }

    // Snapshot de primitives para el closure de after() — evita retener el
    // Prisma Row completo con todos sus campos.
    const tiendaTiendanubeId = tienda.id;
    const empresaId = tienda.empresaId;
    const storeIdSnapshot = storeId;

    // ===============================================================
    // Trabajo pesado — corre DESPUÉS de responder 200 a Tiendanube.
    // ===============================================================
    after(async () => {
      for (const item of labels) {
        try {
          const labelId = typeof item?.id === "string" || typeof item?.id === "number" ? String(item.id) : "";
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

          const option = ffoInfo?.shipping?.option ?? {};
          const shippingType: string | null =
            typeof ffoInfo?.shipping?.type === "string" ? ffoInfo.shipping.type : null;

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

          // ---- Mapping fulfillment_order_info → CrearEnvioInput (mirror de /api/envios) ----
          const recipient = ffoInfo?.recipient ?? {};
          const destination = ffoInfo?.destination ?? {};
          const items: any[] = Array.isArray(ffoInfo?.line_items) ? ffoInfo.line_items : [];

          // Peso: suma de line_items[].unit_dimension.weight × quantity. Fallback 1 kg
          // si el pedido no trae gramaje (mismo criterio conservador que rates route).
          const gramsTotal = items.reduce(
            (acc, li) =>
              acc + (Number(li?.unit_dimension?.weight) || 0) * (Number(li?.quantity) || 1),
            0,
          );
          const pesoReal = gramsTotal > 0 ? gramsTotal / 1000 : 1;

          // Dims: si algún item las trae, se toma el primero como aproximación.
          // TODO(3b): bin-packing real / Modo B (mismos TODOs que rates route).
          // TODO(empaquetado real — DEUDA relacionada 143): hoy se toman las dims de UN SOLO
          // line_item (el primero con medidas) como aproximación del bulto. Un pedido con varios
          // items queda subdimensionado. El peso SÍ suma todos los items (gramsTotal arriba), pero
          // las dims no se consolidan. Verificado contra el contrato Tiendanube: cada line_item trae
          // su propio unit_dimension{weight,height,width,depth}; el empaquetado real (bin-packing /
          // Modo B) debe consolidarlos. Mismo gap que el rates callback (bulto default 10×10×10).
          const primeroConDims = items.find(
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

          // TODO(3b): generar PDF (genérico de Shipro si esProvisoria; real del
          // courier si no) y PATCH a Tiendanube con download_url_from_app + estado
          // READY_TO_DOWNLOAD sobre labelId.
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
