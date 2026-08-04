import { NextResponse } from "next/server";
import { resolverContext } from "@/lib/auth-context";
import { verificarAccesoEnvio } from "@/lib/envios/ownership";

// Le ordenamos a Next.js que NUNCA guarde en caché esta búsqueda
export const dynamic = 'force-dynamic';

// DEUDA 106 PIEZA 1 (2026-08-03): dos correcciones en cirugía sobre este handler.
//
// (A) OWNERSHIP LEAK. Antes, findFirst({where:{trackingNumber}}) devolvía la data
//     RAW a cualquier caller que pasara el proxy — un gerente_cliente de empresa X
//     leía trackings de empresa Y. PRINCIPIO 2 (DEUDAS.md:19) manda que toda lectura
//     scope-cliente pase por verificarAccesoEnvio, que retorna null en mismatch para
//     que el handler responda 404 sin revelar existencia (mismo criterio que
//     depositos: envío inexistente y envío ajeno son indistinguibles al caller).
//     Este endpoint no había sido migrado (cancelar + inversa sí, FAMILIA 2).
//
// (B) OVER-EXPOSURE. Aun para un caller LEGÍTIMO, la respuesta era el objeto Prisma
//     entero — leaba empresa.saldoActivo, limiteDescubierto, apiKeyHash, cuit,
//     direccionFiscal*, modalidadPago + destino.documento/email/telefono + internals
//     de courier. Se recorta a un DTO explícito (whitelist) con la UNIÓN mínima
//     que los consumidores reales necesitan.
//
// PIEZA 2 (posterior): destinatario auth via link mágico con token — requiere
// mecánica que hoy no existe (ver DEUDA 106). Este PIEZA 1 NO cambia proxy.ts
// (buscar sigue en DUAL_EXACT — session o api-key).

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });
    }

    const trackingLimpio = tracking.trim();

    // (A) Ownership gate — mismo patrón que cancelar/inversa (FAMILIA 2).
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    const envio = await verificarAccesoEnvio(
      { trackingNumber: trackingLimpio },
      ctx,
      {
        courier: true,
        destino: true,
        empresa: true,
        // Historial de trazabilidad, del más nuevo al más viejo.
        eventos: { orderBy: { fecha: 'desc' } },
      }
    );

    if (!envio) {
      // 404 idéntico para envío inexistente Y para envío ajeno — no filtramos existencia.
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    // (B) DTO whitelist — sólo lo que los consumidores reales usan:
    //   - app/s/[tracking]/page.tsx (public tracking, session-gated hoy):
    //       tracking, estado, eventos, fechaEntrega/Colecta/Impresion,
    //       empresa.nombre (vendedor), destino.nombre (comprador), courier.nombre.
    //   - app/corregir/[tracking]/page.tsx: estadoActual + destino address parts
    //       (calle..provincia) para prefill del form. NO documento/email/telefono.
    //   - app/(dashboard)/rastreo/page.tsx: scope propio via ownership gate arriba;
    //       este DTO le alcanza para su render (no requiere financials de su propia
    //       empresa vía este endpoint — los tiene por otros paths).
    //
    // Explícitamente EXCLUIDO:
    //   empresa: saldoActivo, limiteDescubierto, apiKeyHash, apiKeyActiva, cuit,
    //     direccionFiscal*, modalidadPago, tarifaPlanaRespaldo, suspendida,
    //     onboardingCompletado.
    //   destino: documento (DNI), email, telefono.
    //   courier: emailSoporte, telefonoSoporte, contactoComercial, smo*, puede*, etc.
    //   envio: valorDeclarado, numeroOrden, apiExterna, motivoRetencion, fragil,
    //     campos operativos internos.
    const dto = {
      trackingNumber: envio.trackingNumber,
      estadoActual: envio.estadoActual,
      modalidad: envio.modalidad,
      fechaImpresion: envio.fechaImpresion,
      fechaColecta: envio.fechaColecta,
      fechaEntrega: envio.fechaEntrega,
      courier: { nombre: envio.courier.nombre },
      empresa: { nombre: envio.empresa.nombre },
      destino: envio.destino
        ? {
            nombre: envio.destino.nombre,
            calle: envio.destino.calle,
            altura: envio.destino.altura,
            piso: envio.destino.piso,
            dpto: envio.destino.dpto,
            cp: envio.destino.cp,
            localidad: envio.destino.localidad,
            provincia: envio.destino.provincia,
          }
        : null,
      eventos: envio.eventos.map((e) => ({
        estado: e.estado,
        observacion: e.observacion,
        fecha: e.fecha,
      })),
    };

    return NextResponse.json(dto);
  } catch (error) {
    console.error("Error buscando envío público:", error);
    return NextResponse.json({ error: "Error al buscar el envío" }, { status: 500 });
  }
}
