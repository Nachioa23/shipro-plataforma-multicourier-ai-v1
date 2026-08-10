import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cotizar } from "@/lib/cotizador";

// DEUDA 144 — Rates callback de Tiendanube (Momento 2 del plugin).
//
// Endpoint PUBLIC (registrado en proxy.ts PUBLIC_API_EXACT). Tiendanube NO firma
// este callback ni manda API key: se auto-autentica leyendo body.store_id y
// resolviéndolo contra TiendaTiendanube (estado="instalada"). Un store_id
// desconocido → 422 (Tiendanube trata 4xx como "servicio vivo, request malo" y
// dispara fallback merchant si está configurado; 5xx contaría para su circuit
// breaker — ver DEUDA 129/130).
//
// SCOPE — QUOTES ONLY: consulta tarifas y devuelve rates[]. NO crea envíos, NO
// debita saldo, NO despacha, NO llama a labels. Read-only w.r.t. plata.
//
// STEP 1 (skeleton): arma UN bulto default sumando grams de items[] (1kg si no
// hay items). Dimensiones hardcoded a 10x10x10 — el packaging real (Modo B fijo
// / Modo A bin-packing) se enchufa en el próximo paso (DEUDA 143). Persistencia
// de CotizacionSnapshot (DEUDA 111) también queda para un paso posterior.
//
// Contrato de request/response verificado contra doc oficial en DEUDA 130.
// Detalles del shape de body.destination (postal_code vs zipcode) NO están 100%
// confirmados hasta probar contra sandbox de Tiendanube — leemos defensivamente.
export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Body inválido" }, { status: 422 });
    }

    const storeId = Number(body.store_id);
    if (!Number.isInteger(storeId)) {
      return NextResponse.json({ error: "store_id inválido" }, { status: 422 });
    }

    // Self-auth: la tienda tiene que estar vinculada y activa. Mismo mensaje
    // genérico para "no existe" y "no instalada" para no revelar existencia.
    const tienda = await prisma.tiendaTiendanube.findUnique({ where: { storeId } });
    if (!tienda || tienda.estado !== "instalada") {
      return NextResponse.json({ error: "Tienda no vinculada" }, { status: 422 });
    }

    // Destino. Shape exacto de body.destination a confirmar contra sandbox
    // Tiendanube durante homologación — leemos defensivamente los nombres más
    // probables (postal_code / zipcode / zip; province / state).
    const dest: any = body.destination ?? {};
    const cpDestino = String(dest.postal_code ?? dest.zipcode ?? dest.zip ?? "").trim();
    const provinciaDestino = dest.province ?? dest.state ?? undefined;
    if (!cpDestino) {
      return NextResponse.json({ error: "Destino sin código postal" }, { status: 422 });
    }

    // STEP 1: armar UN bulto default sumando el peso de items[] (grams → kg,
    // con quantity si viene). Dims default 10x10x10 — el motor de empaquetado
    // (Modo B/A) se enchufa en el próximo paso.
    const items: any[] = Array.isArray(body.items) ? body.items : [];
    const gramsTotal = items.reduce(
      (acc, it) => acc + (Number(it?.grams) || 0) * (Number(it?.quantity) || 1),
      0,
    );
    const pesoKg = gramsTotal > 0 ? gramsTotal / 1000 : 1;
    const paquetes = [{
      pesoKg,
      largoCm: 10,
      anchoCm: 10,
      altoCm: 10,
      valorDeclarado: Number(body.total_price) || 0,
      requiereSeguro: false,
    }];

    // Cotizar. Sin cpOrigen → cotizar() usa el depósito predeterminado de la
    // empresa (DEUDA 4). origen="checkout" para etiquetar bien el registro de
    // cobertura vacía (DEUDA 32+37).
    const resultado = await cotizar({
      empresaId: tienda.empresaId,
      cpDestino,
      provinciaDestino,
      paquetes,
      valorCarrito: Number(body.total_price) || undefined,
      origen: "checkout",
    });

    // Mapear OpcionTarifa → rate de Tiendanube.
    // - code: slug estable único por courier+modalidad. Tiendanube ignora
    //   codes duplicados en type="ship" (procesa solo el primero) — dedupimos
    //   preservando el primero.
    // - reference: string opaco con courier+modalidad+id, para recuperar la
    //   elección del comprador cuando Tiendanube pida crear la etiqueta
    //   (Momento 3) sin consultar BD.
    const currency = body.currency ?? "ARS";
    const normalizarCode = (o: { courier: string; modalidad: string }) =>
      `${o.courier}-${o.modalidad}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const mapOpcion = (o: any, type: "ship" | "pickup") => ({
      name: `${o.courier} - ${o.modalidad}`,
      code: normalizarCode(o),
      price: Number(o.precioFinal),
      currency,
      type,
      reference: JSON.stringify({ courier: o.courier, modalidad: o.modalidad, id: o.id }),
    });

    const ship = (resultado.domicilio ?? []).map((o) => mapOpcion(o, "ship"));
    const pickup = (resultado.sucursal ?? []).map((o) => mapOpcion(o, "pickup"));

    const seen = new Set<string>();
    const shipUnique = ship.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
    const rates = [...shipUnique, ...pickup];

    // Empty rates[] con 200 es válido — Tiendanube simplemente no muestra
    // opciones. Refinamiento de política (cuándo 422 vs empty-200) queda para
    // un paso posterior.
    return NextResponse.json({ rates }, { status: 200 });
  } catch (e) {
    console.error("[/api/tiendanube/rates] Error interno:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
