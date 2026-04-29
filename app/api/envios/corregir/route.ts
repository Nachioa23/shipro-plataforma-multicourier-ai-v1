import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { trackingNumber, calle, altura, cp, localidad, provincia, piso, dpto } = body;

    if (!trackingNumber || !calle || !altura || !cp) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // 1. Buscamos el envío y toda su info relacional necesaria para despachar
    const envio = await prisma.envio.findFirst({
      where: { 
        trackingNumber: trackingNumber, 
        estadoActual: { in: ["RETENIDO", "Retenido"] } 
      },
      include: { 
        destino: true,
        courier: true,
        finanzas: true,
        empresa: true
      }
    });

    // CORRECCIÓN DE TYPESCRIPT: Verificamos que el objeto "destino" exista completo
    if (!envio || !envio.destino || !envio.courier) {
      return NextResponse.json({ error: "Envío no encontrado o inválido para corrección" }, { status: 404 });
    }

    // 2. Actualizamos la dirección del destinatario en la base de datos
    await prisma.direccion.update({
      where: { id: envio.destino.id },
      data: { 
        calle, 
        altura, 
        cp: String(cp), 
        localidad, 
        provincia, 
        piso: piso || "", 
        dpto: dpto || "" 
      }
    });

    // 3. ¡MOMENTO DE LA VERDAD! Despachamos al Courier con la dirección limpia
    let nuevoTrackingOficial = envio.trackingNumber; // Mantenemos el provisorio por defecto
    let nuevoTrackingFirstMile = envio.trackingFirstMile;
    let nuevaUrlEtiqueta = envio.etiquetaUrl;
    let despachoExitoso = false;

    try {
      const nombreCourierLimpio = envio.courier.nombre.toLowerCase().replace(/['\s]/g, '');
      
      const credencialMain = await prisma.credencialCourier.findUnique({
        where: { empresaId_nombreCourier: { empresaId: envio.empresaId, nombreCourier: envio.courier.nombre.toLowerCase() } }
      });

      if (credencialMain && credencialMain.activo) {
        const llavesMain = credencialMain.usaCredencialesPropias
          ? parsearCredencialesPropias(nombreCourierLimpio, credencialMain.credencialesJson)
          : obtenerCredencialesShipro(nombreCourierLimpio);
        
        const motorMain = CourierFactory.crear(nombreCourierLimpio, llavesMain);
        
        let tipoEntregaFormateado: "sucursal" | "domicilio" | "inversa" | "cambio" = "domicilio";
        const mod = envio.modalidad?.toLowerCase() || "";
        if (mod.includes('sucursal')) tipoEntregaFormateado = "sucursal";
        if (mod.includes('inversa') || mod.includes('devolucion')) tipoEntregaFormateado = "inversa";
        if (mod.includes('cambio')) tipoEntregaFormateado = "cambio";

        const paramsDespacho = {
          destinatarioNombre: envio.destino.nombre || "Consumidor Final", 
          calle: calle, 
          altura: altura, 
          piso: piso, 
          dpto: dpto, 
          localidad: localidad, 
          provincia: provincia, 
          cp: String(cp), 
          dni: envio.destino.documento || "", 
          email: envio.destino.email || "", 
          telefono: envio.destino.telefono || "", 
          peso: envio.pesoReal, 
          paquetes: [{ 
            pesoKg: envio.pesoReal, 
            largoCm: 10, anchoCm: 10, altoCm: 10,
            valorDeclarado: envio.finanzas?.valorDeclarado || 0, 
            requiereSeguro: credencialMain.requiereSeguro      
          }], 
          referencia: envio.numeroOrden ? `ORDEN-${envio.numeroOrden}` : `ORDEN-${Date.now()}`,
          tipoEntrega: tipoEntregaFormateado
        };

        const respuestaMain = await motorMain.despachar(paramsDespacho);
        if (respuestaMain && respuestaMain.tracking) {
          nuevoTrackingOficial = respuestaMain.tracking; 
          nuevaUrlEtiqueta = respuestaMain.etiquetaUrl || null; 
          despachoExitoso = true;
        }

        // Lógica de First Mile (Recolector)
        if (despachoExitoso && credencialMain.courierRecolector && credencialMain.courierRecolector !== "mismo_courier") {
          let llavesRecolector = obtenerCredencialesShipro(credencialMain.courierRecolector);
          const motorRecolector = CourierFactory.crear(credencialMain.courierRecolector, llavesRecolector);
          
          const paramsRecolector = { ...paramsDespacho, referencia: `FIRST-MILE: ${nuevoTrackingOficial}` };
          const respuestaRecolector = await motorRecolector.despachar(paramsRecolector);
          
          if (respuestaRecolector && respuestaRecolector.tracking) {
            nuevoTrackingFirstMile = respuestaRecolector.tracking;
            const jsonCreds = JSON.parse(credencialMain.credencialesJson || '{}');
            const revendedor = jsonCreds.revendedor || '';

            if (revendedor === credencialMain.courierRecolector && nombreCourierLimpio === 'andreani') {
               try {
                  const tokenAdmin = await (motorRecolector as any).getToken(); 
                  const bodyVinculacion = new URLSearchParams();
                  bodyVinculacion.append('code', nuevoTrackingFirstMile); 
                  bodyVinculacion.append('andreani_tracking_codes', `[${nuevoTrackingOficial}]`); 

                  await fetch(`https://mocis.akeron.net/api/v1/shipping/andreani/set_tracking_code`, {
                     method: 'POST',
                     headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                     body: bodyVinculacion.toString()
                  });
               } catch (errorVinc) {}
            }
          }
        }
      }
    } catch (errorDisp) {
       console.warn(`[Shipro] Falló el despacho oficial post-corrección.`, errorDisp);
       return NextResponse.json({ error: "Dirección corregida, pero el correo rechazó la etiqueta. Contactar soporte." }, { status: 502 });
    }

    // 4. Si el despacho fue exitoso, actualizamos el envío y lo liberamos
    if (despachoExitoso) {
        await prisma.envio.update({
          where: { id: envio.id },
          data: { 
            estadoActual: "Pendiente",
            trackingNumber: nuevoTrackingOficial,
            trackingFirstMile: nuevoTrackingFirstMile,
            etiquetaUrl: nuevaUrlEtiqueta
          }
        });

        // 5. Dejamos huella en la trazabilidad operativa
        await prisma.eventoTracking.create({
          data: {
            envioId: envio.id,
            estado: "Pendiente",
            observacion: `Dirección corregida. Tracking oficial asignado: ${nuevoTrackingOficial}`
          }
        });

    } else {
        return NextResponse.json({ error: "No se pudo generar la etiqueta oficial con el courier." }, { status: 500 });
    }

    return NextResponse.json({ success: true, trackingOficial: nuevoTrackingOficial });

  } catch (error) {
    console.error("Error corrigiendo dirección desde link público:", error);
    return NextResponse.json({ error: "Error interno del servidor al procesar la corrección" }, { status: 500 });
  }
}