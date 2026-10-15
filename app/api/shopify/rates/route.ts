import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cotizar } from "@/lib/cotizador";
import { armarBultoApilado } from "@/lib/empaquetado/armar-bulto";
import { hashApiKey } from "@/lib/utils/apikey-hash";
import { mapearCotizacionAShopify } from "@/lib/shopify/rates";

// Peso default (kg) espejo del rates callback de Tiendanube: red de seguridad
// cuando Modo B está activo pero sin peso configurado, o cuando el carrito no
// trae peso. 2kg es un piso conservador (protege de subcobrar).
const PESO_DEFAULT_KG = 2;

// Shopify Fase 2 — Rates callback.
//
// Endpoint PÚBLICO (registrado en proxy.ts PUBLIC_API_EXACT). Shopify NO firma
// este callback ni manda el shop domain: se auto-autentica via el `token` opaco
// de la callbackUrl → hashApiKey → TiendaShopify.rateCallbackTokenHash @unique.
// Si no matchea o la tienda no está instalada → 404 (Shopify fuerza backup
// rates en 4xx; la venta no se corta).
//
// SCOPE Fase 2 — QUOTES ONLY domicilio: lee tarifas, devuelve rates[].
// NO crea envíos, NO debita saldo, NO despacha. SIN sucursal/pickup (otro
// mecanismo de Shopify, Fase futura). SIN geocode (no hace falta sin pickup).
//
// Patrón espejo del rates callback de Tiendanube con los deltas Shopify:
//   - Auth por token hasheado en query string (vs store_id en body de TN).
//   - items[].price viene en SUBUNIDADES (centavos) — valorCarrito /100.
//   - items[] NO manda dimensions (dims=0 → armarBultoApilado cae al peso).
//   - Response rates[].total_price en SUBUNIDADES (string).
export async function POST(request: Request) {
  try {
    // Auth: token opaco en query → hashApiKey → lookup O(1) por rateCallbackTokenHash.
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "token requerido" }, { status: 404 });
    }
    const hash = hashApiKey(token);
    const tienda = await prisma.tiendaShopify.findUnique({
      where: { rateCallbackTokenHash: hash },
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
    // 404 fuerza a Shopify a usar sus backup rates (mismo mensaje genérico para
    // token inválido y tienda no instalada — no revelar existencia).
    if (!tienda || tienda.estado !== "instalada") {
      return NextResponse.json({ error: "No disponible" }, { status: 404 });
    }

    // Body de Shopify: { rate: { origin, destination, items[], currency, locale } }.
    const body: any = await request.json().catch(() => null);
    const rate: any = body?.rate ?? null;
    if (!rate) {
      return NextResponse.json({ error: "rate inválido" }, { status: 422 });
    }

    // Destino. Shopify manda shape consistente: postal_code + province.
    const dest: any = rate.destination ?? {};
    const cpDestino = String(dest.postal_code ?? "").trim();
    const provinciaDestino = typeof dest.province === "string" ? dest.province : undefined;
    if (!cpDestino) {
      return NextResponse.json({ error: "Destino sin código postal" }, { status: 422 });
    }

    // valorCarrito: suma de items[].price * items[].quantity (todo en subunidades) → mayor,
    // luego /100 para pasar a la unidad base (ARS, etc).
    const items: any[] = Array.isArray(rate.items) ? rate.items : [];
    const subTotalSubu = items.reduce(
      (acc, it) => acc + (Number(it?.price) || 0) * (Number(it?.quantity) || 1),
      0,
    );
    const valorCarrito = subTotalSubu / 100;

    // Armar paquete.
    const emp = tienda.empresa;
    const modoBAplicable = !!emp?.empaqueModoBActivo;
    let paquetes;
    if (modoBAplicable) {
      paquetes = [
        {
          pesoKg: emp!.empaqueModoBPesoKg ?? PESO_DEFAULT_KG,
          largoCm: emp!.empaqueModoBLargoCm ?? 10,
          anchoCm: emp!.empaqueModoBAnchoCm ?? 10,
          altoCm: emp!.empaqueModoBAltoCm ?? 10,
          valorDeclarado: valorCarrito,
          requiereSeguro: false,
        },
      ];
    } else {
      // Shopify NO manda dimensions por item → dims=0; armarBultoApilado cae a
      // default por peso (sin volumétrico útil hasta que Shopify lo exponga).
      const itemsParaEmpaquetar = items.map((it: any) => ({
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
          valorDeclarado: valorCarrito,
          requiereSeguro: false,
        },
      ];
    }

    // Cotizar sin geocode (no hay pickup en Fase 2). origen="checkout" alinea
    // con el patrón de TN para registrar coberturaVacia correctamente.
    const resultado = await cotizar({
      empresaId: tienda.empresaId,
      cpDestino,
      provinciaDestino,
      paquetes,
      valorCarrito: valorCarrito || undefined,
      origen: "checkout",
    });

    const currency = typeof rate.currency === "string" ? rate.currency : "ARS";
    const rates = mapearCotizacionAShopify(resultado.domicilio ?? [], currency);

    // CotizacionSnapshot best-effort (DEUDA 111 — mismo shape que TN rates).
    try {
      const depositoPredId = emp?.depositos?.[0]?.id;
      if (depositoPredId != null) {
        const opcionesSnapshot = [
          ...(resultado.domicilio ?? []).map((o) => ({
            tipo: "domicilio",
            courier: o.courier,
            modalidad: o.modalidad,
            precioFinal: Number(o.precioFinal),
            precioProveedor: Number(o.costoCourierNativo),
            slaHs: o.slaHs,
            esFallback: !!o.esFallback,
          })),
          ...(resultado.sucursal ?? []).map((o) => ({
            tipo: "sucursal",
            courier: o.courier,
            modalidad: o.modalidad,
            precioFinal: Number(o.precioFinal),
            precioProveedor: Number(o.costoCourierNativo),
            slaHs: o.slaHs,
            esFallback: !!o.esFallback,
          })),
        ];
        await prisma.cotizacionSnapshot.create({
          data: {
            empresaId: tienda.empresaId,
            depositoOrigenId: depositoPredId,
            destinoSnapshotJson: JSON.stringify({
              cpDestino,
              provinciaDestino: provinciaDestino ?? null,
            }),
            paqueteSnapshotJson: JSON.stringify(paquetes),
            opcionesSnapshotJson: JSON.stringify(opcionesSnapshot),
          },
        });
      }
    } catch (snapErr) {
      console.error(
        "[/api/shopify/rates] snapshot best-effort falló (no afecta respuesta):",
        snapErr,
      );
    }

    // Empty rates[] con 200 es válido — Shopify no muestra opciones y aplica
    // sus backup rates si están configuradas.
    return NextResponse.json({ rates }, { status: 200 });
  } catch (e) {
    console.error("[/api/shopify/rates] Error interno:", e);
    // 5xx: Shopify usa backup rates si están configuradas; la venta no se corta.
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
