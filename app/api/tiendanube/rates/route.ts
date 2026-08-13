import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cotizar } from "@/lib/cotizador";
import { generarCodeServicio } from "@/lib/tiendanube/servicios-publicados";

// Peso default (kg) cuando no hay peso disponible. Se usa en dos casos:
// (1) Modo B activo pero SIN peso configurado (config a medias) → respeta la
//     intención de tarifa fija con un peso de referencia, en vez de caer al peso real.
// (2) Default path con un carrito que no trae peso alguno (caso raro / mala data).
// 2kg es un piso conservador (protege de subcobrar). El peso del Modo B DEBERÍA ser
// OBLIGATORIO en la pantalla de configuración (no poder activar el Modo B sin cargarlo,
// decisión de Nacho — DEUDA 143); este default es la red de seguridad por si falla igual.
const PESO_DEFAULT_KG = 2;

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
    // Include de empresa con los campos de Modo B (DEUDA 143) para evitar un
    // segundo query al armar el/los bulto(s) más abajo.
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
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

    // Armar el/los bulto(s) a cotizar.
    // Modo B (tarifa fija): si la empresa lo tiene activo, SIEMPRE 1 bulto de tarifa fija,
    // sin importar el contenido real del carrito (regla comercial de tarifa — DEUDA 143). Si
    // falta el peso configurado, se usa PESO_DEFAULT_KG (respeta la intención de tarifa fija
    // en lugar de caer al peso real del carrito). Dims faltantes → valor chico (10) para que
    // mande el peso en la cotización volumétrica.
    // Modo A (bin-packing) se enchufará acá en el futuro.
    const emp = tienda.empresa;
    const modoBAplicable = !!emp?.empaqueModoBActivo;

    let paquetes;
    if (modoBAplicable) {
      paquetes = [{
        pesoKg: emp!.empaqueModoBPesoKg ?? PESO_DEFAULT_KG,
        largoCm: emp!.empaqueModoBLargoCm ?? 10,
        anchoCm: emp!.empaqueModoBAnchoCm ?? 10,
        altoCm: emp!.empaqueModoBAltoCm ?? 10,
        valorDeclarado: Number(body.total_price) || 0,
        requiereSeguro: false,
      }];
    } else {
      // Default (STEP 1): UN bulto sumando el peso de items[] (grams→kg), 1kg si no hay datos.
      const items: any[] = Array.isArray(body.items) ? body.items : [];
      const gramsTotal = items.reduce(
        (acc, it) => acc + (Number(it?.grams) || 0) * (Number(it?.quantity) || 1),
        0,
      );
      const pesoKg = gramsTotal > 0 ? gramsTotal / 1000 : PESO_DEFAULT_KG;
      paquetes = [{
        pesoKg,
        largoCm: 10, anchoCm: 10, altoCm: 10,
        valorDeclarado: Number(body.total_price) || 0,
        requiereSeguro: false,
      }];
    }

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
    // - code: viene de generarCodeServicio(courier, codigoServicio) — el MISMO slug
    //   estable con que se pre-registra el carrier option. Tiendanube descarta rates
    //   cuyo code no esté registrado, así que emitir el slug dinámico de modalidad
    //   (como antes) era una bomba de tiempo: cambiaba con cada `servicio` que
    //   devolviera el courier.
    // - Sin codigoServicio → se descarta la opción (fallback fantasma DEUDA 129,
    //   ver comment del mapOpcion abajo). Mejor no publicarla que emitir un code
    //   no registrado que Tiendanube ignoraría igual.
    // - name: humano/cosmético, no tiene que matchear el code.
    // - reference: se preserva para Momento 3, ahora con codigoServicio para
    //   trazabilidad (útil cuando Tiendanube devuelve el reference al crear label).
    const currency = body.currency ?? "ARS";
    const mapOpcion = (o: any, type: "ship" | "pickup") => {
      if (!o.codigoServicio) return null; // sin code estable → no se publica
      return {
        name: `${o.courier} - ${o.modalidad}`,
        code: generarCodeServicio(o.courier, o.codigoServicio),
        price: Number(o.precioFinal),
        currency,
        type,
        reference: JSON.stringify({ courier: o.courier, modalidad: o.modalidad, codigoServicio: o.codigoServicio, id: o.id }),
      };
    };

    const ship = (resultado.domicilio ?? [])
      .map((o) => mapOpcion(o, "ship"))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const pickup = (resultado.sucursal ?? [])
      .map((o) => mapOpcion(o, "pickup"))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const seen = new Set<string>();
    const shipUnique = ship.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
    const rates = [...shipUnique, ...pickup];

    // DEUDA 111 — snapshot del embudo del checkout (captura desde día 1). BEST-EFFORT:
    // si falla, NO rompe la respuesta al comprador. depositoOrigenId usa el depósito
    // predeterminado de la empresa (Tiendanube manda un location_id propio que no mapea
    // a nuestro Deposito; el mapeo fino queda para futuro). Los Decimal se convierten a
    // number para un JSON limpio. Nota: agrega una escritura al camino (~límite 5s de
    // Tiendanube); con volumen alto, evaluar moverlo a async (DEUDA 145 relacionada).
    try {
      const depositoPredId = emp?.depositos?.[0]?.id;
      if (depositoPredId != null) {
        const opcionesSnapshot = [
          ...(resultado.domicilio ?? []).map((o) => ({
            tipo: "domicilio", courier: o.courier, modalidad: o.modalidad,
            precioFinal: Number(o.precioFinal), precioProveedor: Number(o.precioProveedor),
            slaHs: o.slaHs, esFallback: !!o.esFallback,
          })),
          ...(resultado.sucursal ?? []).map((o) => ({
            tipo: "sucursal", courier: o.courier, modalidad: o.modalidad,
            precioFinal: Number(o.precioFinal), precioProveedor: Number(o.precioProveedor),
            slaHs: o.slaHs, esFallback: !!o.esFallback,
          })),
        ];
        await prisma.cotizacionSnapshot.create({
          data: {
            empresaId: tienda.empresaId,
            depositoOrigenId: depositoPredId,
            destinoSnapshotJson: JSON.stringify({ cpDestino, provinciaDestino: provinciaDestino ?? null }),
            paqueteSnapshotJson: JSON.stringify(paquetes),
            opcionesSnapshotJson: JSON.stringify(opcionesSnapshot),
          },
        });
      }
    } catch (snapErr) {
      console.error("[/api/tiendanube/rates] snapshot best-effort falló (no afecta respuesta):", snapErr);
    }

    // Empty rates[] con 200 es válido — Tiendanube simplemente no muestra
    // opciones. Refinamiento de política (cuándo 422 vs empty-200) queda para
    // un paso posterior.
    return NextResponse.json({ rates }, { status: 200 });
  } catch (e) {
    console.error("[/api/tiendanube/rates] Error interno:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
