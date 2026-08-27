import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  dibujarPaginaEtiqueta,
  dibujarEtiquetaProvisoria,
  PDFDocument,
  StandardFonts,
  type EnvioParaEtiqueta,
} from "@/lib/etiquetas/armar-etiqueta";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

// pdf-lib + posible fs.readFileSync del logo (branch Mocis-puro) necesitan Node runtime.
export const runtime = "nodejs";

// DEUDA 144 (Momento 3 labels) — Tiendanube Admin Link.
//
// Endpoint PUBLIC (registrado en proxy.ts PUBLIC_API_EXACT). El merchant hace click
// en un Admin Link desde el admin de Tiendanube y Tiendanube lo redirige acá con:
//   ?locale=es&store=<storeId>&id=<orderId>&id=<orderId2>...
//
// El order_id que llega en `id` es el system id de Tiendanube (Envio.tiendanubeOrderId,
// backfilleado por el webhook fulfillment_order/*). Resolución en cadena:
//   order_id → Envio.tiendanubeOrderId → Envio.etiquetasTiendanube[] → downloadToken → PDF
//
// SELF-AUTH: mirror de /generate y /rates — sólo pedimos que el storeId matchee una
// TiendaTiendanube instalada. No hay firma de Tiendanube en este flow (es un redirect
// del navegador del merchant), pero el token opaco por-etiqueta (downloadToken) ya
// protege el PDF: incluso si un tercero adivinara storeId + order_id, tendría que
// tener la etiqueta activa que le mapea. En Case A redirigimos al /download existente
// y todo el gating vive ahí. En Case B las páginas se generan on-the-fly reusando
// exactamente los mismos helpers.
//
// UI/UX:
//   - 1 pedido con etiqueta activa  → 302 al /download existente (single-label PDF).
//   - N pedidos con etiquetas       → PDF combinado (pdf-lib copyPages) inline.
//   - Sin etiquetas todavía         → página HTML amable "preparándose" (no 404 seco).
//   - Store desconocida / no instalada → HTML "tienda no vinculada".
//   - Ningún order_id en el link    → HTML "no se recibieron pedidos".
//
// SELECCIÓN DE ETIQUETA POR ENVÍO: preferimos la real (esProvisoria=false) si existe;
// si no, la provisoria más reciente. Una fulfillment order admite hasta 20 etiquetas
// (típicamente 1 provisoria + 1 real cuando el envío se destraba).

type LocaleTag = "es" | "pt" | "en";
function pickLocale(raw: string | null | undefined): LocaleTag {
  const s = (raw || "es").toLowerCase();
  if (s.startsWith("pt")) return "pt";
  if (s.startsWith("en")) return "en";
  return "es";
}

const MENSAJES: Record<
  "preparando" | "tiendaNoVinculada" | "sinPedidos" | "storeInvalido" | "errorInterno",
  Record<LocaleTag, { titulo: string; mensaje: string }>
> = {
  preparando: {
    es: {
      titulo: "Preparando etiquetas…",
      mensaje:
        "Las etiquetas se están preparando. Esto puede tardar unos segundos después de generar el envío. Volvé a intentar en un momento.",
    },
    pt: {
      titulo: "Preparando etiquetas…",
      mensaje:
        "As etiquetas estão sendo preparadas. Isto pode levar alguns segundos após gerar o envio. Tente novamente em instantes.",
    },
    en: {
      titulo: "Preparing labels…",
      mensaje:
        "Labels are being prepared. This can take a few seconds after the shipment is generated. Please try again in a moment.",
    },
  },
  tiendaNoVinculada: {
    es: {
      titulo: "Tienda no vinculada",
      mensaje: "Esta tienda no está vinculada con Shipro. Contactá a soporte.",
    },
    pt: {
      titulo: "Loja não vinculada",
      mensaje: "Esta loja não está vinculada ao Shipro. Contate o suporte.",
    },
    en: {
      titulo: "Store not linked",
      mensaje: "This store is not linked to Shipro. Please contact support.",
    },
  },
  sinPedidos: {
    es: { titulo: "Sin pedidos", mensaje: "No se recibieron pedidos en el enlace." },
    pt: { titulo: "Sem pedidos", mensaje: "Nenhum pedido foi recebido no link." },
    en: { titulo: "No orders", mensaje: "No orders were received in the link." },
  },
  storeInvalido: {
    es: { titulo: "Enlace inválido", mensaje: "Falta el identificador de la tienda." },
    pt: { titulo: "Link inválido", mensaje: "Falta o identificador da loja." },
    en: { titulo: "Invalid link", mensaje: "Store identifier is missing." },
  },
  errorInterno: {
    es: {
      titulo: "Error interno",
      mensaje: "Ocurrió un problema al preparar las etiquetas. Volvé a intentar.",
    },
    pt: {
      titulo: "Erro interno",
      mensaje: "Ocorreu um problema ao preparar as etiquetas. Tente novamente.",
    },
    en: {
      titulo: "Internal error",
      mensaje: "Something went wrong preparing the labels. Please try again.",
    },
  },
};

// Página HTML mínima, self-contained, para renderizar dentro del admin de Tiendanube
// (iframe / nueva pestaña). Inline styles, sin dependencias externas. Header en el
// azul Shipro. Sin botones — el merchant vuelve al admin por sí solo.
function paginaHtml(titulo: string, mensaje: string, status: number): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${titulo}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f7f8fa; color: #1f2937; }
  .wrap { display: flex; align-items: center; justify-content: center; min-height: 100%; padding: 24px; box-sizing: border-box; }
  .card { max-width: 480px; width: 100%; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06); }
  .head { background: #233b6b; color: #ffffff; padding: 20px 24px; }
  .head h1 { margin: 0; font-size: 18px; font-weight: 700; }
  .body { padding: 20px 24px; font-size: 14px; line-height: 1.5; }
  .body p { margin: 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="head"><h1>${titulo}</h1></div>
    <div class="body"><p>${mensaje}</p></div>
  </div>
</div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const INCLUDE_ENVIO_ETIQUETA = {
  courier: true,
  empresa: true,
  origen: true,
  destino: true,
  ordenExterna: true,
  tramos: {
    where: { tipo: "recoleccion" as const },
    include: { courier: true },
    take: 1,
  },
} as const;

// Renderiza UNA etiqueta en su propio PDFDocument y devuelve el doc listo para copiar.
// Reusa 1:1 los helpers que ya usa /download — misma lógica de branch por esProvisoria.
async function renderizarEtiqueta(
  envio: EnvioParaEtiqueta,
  esProvisoria: boolean,
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.create();
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontN = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const ctx = { pdfDoc, fontB, fontN };
  if (esProvisoria) {
    await dibujarEtiquetaProvisoria(ctx, envio);
  } else {
    await dibujarPaginaEtiqueta(ctx, envio);
  }
  return pdfDoc;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locale = pickLocale(searchParams.get("locale"));

  try {
    // 1. Parse + validar store.
    const storeRaw = searchParams.get("store");
    const storeNum = Number(storeRaw);
    if (!Number.isInteger(storeNum) || storeNum <= 0) {
      const m = MENSAJES.storeInvalido[locale];
      return paginaHtml(m.titulo, m.mensaje, 400);
    }

    // 2. Parse ids (Tiendanube envía id repetido para N pedidos).
    const ids = searchParams.getAll("id").filter((s) => s && s.length > 0);
    if (ids.length === 0) {
      const m = MENSAJES.sinPedidos[locale];
      return paginaHtml(m.titulo, m.mensaje, 400);
    }

    // 3. Self-auth por storeId (mirror /generate y /rates).
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId: storeNum },
      select: { id: true, empresaId: true, estado: true },
    });
    if (!tienda || tienda.estado !== "instalada") {
      const m = MENSAJES.tiendaNoVinculada[locale];
      return paginaHtml(m.titulo, m.mensaje, 403);
    }

    // 4. Por cada order_id: resolver Envio → etiqueta activa. Preferimos NON-provisoria;
    //    si no hay, la provisoria más reciente. Etiquetas CANCELED o sin token no cuentan.
    type Pick = {
      envio: EnvioParaEtiqueta;
      etiquetaId: number;
      labelId: string;
      downloadToken: string;
      esProvisoria: boolean;
    };
    const encontrados: Pick[] = [];
    const pendientes: string[] = [];

    for (const orderId of ids) {
      const envio = await prisma.envio.findFirst({
        where: {
          tiendanubeOrderId: orderId,
          tiendanubeStoreId: storeNum,
        },
        include: {
          ...INCLUDE_ENVIO_ETIQUETA,
          etiquetasTiendanube: {
            where: { estado: { not: "CANCELED" }, downloadToken: { not: null } },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!envio || envio.etiquetasTiendanube.length === 0) {
        pendientes.push(orderId);
        continue;
      }

      const etiquetas = envio.etiquetasTiendanube;
      // Prefer real (esProvisoria=false); si ninguna es real, tomar la más reciente
      // (que por el orderBy es la [0]).
      const real = etiquetas.find((e) => !e.esProvisoria);
      const elegida = real ?? etiquetas[0];
      if (!elegida.downloadToken) {
        // WHERE ya filtra por token no-null, pero defense-in-depth para el tipo.
        pendientes.push(orderId);
        continue;
      }

      // envio viene con etiquetasTiendanube incluido: casteamos al shape que espera el
      // renderer (mismo include que /download, sin etiquetasTiendanube).
      const envioParaRender = envio as unknown as EnvioParaEtiqueta;
      encontrados.push({
        envio: envioParaRender,
        etiquetaId: elegida.id,
        labelId: elegida.labelId,
        downloadToken: elegida.downloadToken,
        esProvisoria: elegida.esProvisoria,
      });
    }

    // 5. Casos de respuesta.
    if (encontrados.length === 0) {
      // Todas las órdenes pendientes → HTML "preparándose" (200: no es error del merchant).
      const m = MENSAJES.preparando[locale];
      return paginaHtml(m.titulo, m.mensaje, 200);
    }

    // CASO A — un solo pedido pedido con una etiqueta encontrada: redirect al /download
    // existente. Reusa todo el gating por token + render + Content-Type.
    // Base: la URL PÚBLICA (getAppUrlOrThrow), NO request.url — detrás de nginx
    // request.url apunta a http://localhost:3000 (URL interna de Next), y el navegador
    // del merchant caería en localhost → ERR_SSL_PROTOCOL_ERROR. Mismo patrón que el
    // fix del OAuth callback.
    if (ids.length === 1 && encontrados.length === 1) {
      const dest = new URL(
        `/api/tiendanube/labels/download?token=${encodeURIComponent(encontrados[0].downloadToken)}`,
        getAppUrlOrThrow(),
      );
      return NextResponse.redirect(dest, 302);
    }

    // CASO B (y C parcial) — múltiples etiquetas: PDF combinado on-the-fly.
    const combinado = await PDFDocument.create();
    for (const pick of encontrados) {
      const singleDoc = await renderizarEtiqueta(pick.envio, pick.esProvisoria);
      const paginas = await combinado.copyPages(singleDoc, singleDoc.getPageIndices());
      paginas.forEach((p) => combinado.addPage(p));
    }
    const bytes = await combinado.save();

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Etiquetas_Shipro.pdf"`,
      },
    });
  } catch (e) {
    console.error("[/api/tiendanube/labels/admin-link] Error:", e);
    const m = MENSAJES.errorInterno[locale];
    return paginaHtml(m.titulo, m.mensaje, 500);
  }
}
