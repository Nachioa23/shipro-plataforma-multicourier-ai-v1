import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { trackingOriginal, tipoAccion } = body;

    if (!trackingOriginal || !tipoAccion) {
      return NextResponse.json({ error: "Faltan datos para la logística inversa" }, { status: 400 });
    }

    const envioOriginal = await prisma.envio.findFirst({
      where: { trackingNumber: trackingOriginal },
      include: { courier: true, destino: true, origen: true, finanzas: true }
    });

    if (!envioOriginal || !envioOriginal.destino) {
      return NextResponse.json({ error: "Envío original no encontrado" }, { status: 404 });
    }

    // DEUDA 4: el "destino" de la inversa (donde llega el paquete devuelto) es
    // el depósito predeterminado del cliente. Si no hay, no se puede generar.
    const depositoPred = await prisma.deposito.findFirst({
      where: { empresaId: envioOriginal.empresaId, esPredeterminado: true, activo: true, eliminado: false },
    });
    if (!depositoPred) {
      return NextResponse.json(
        {
          error: 'La empresa no tiene depósito predeterminado configurado. La inversa no puede generarse hasta que se configure uno.',
          code: 'DEPOSITO_REQUERIDO',
        },
        { status: 400 }
      );
    }

    const nombreNormalizado = normalizarParaComparacion(envioOriginal.courier.nombre);

    const credencial = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId: envioOriginal.empresaId, nombreCourier: envioOriginal.courier.nombre } }
    });

    // REGLA ESTRICTA DE CREDENCIALES
    const llaves = credencial?.usaCredencialesPropias
      ? parsearCredencialesPropias(nombreNormalizado, credencial.credencialesJson)
      : obtenerCredencialesShipro(nombreNormalizado);

    const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);

    let tipoEntregaFormateado: "inversa" | "cambio" = "inversa";
    if (tipoAccion === 'cambio') tipoEntregaFormateado = "cambio";

    const paramsDespacho = {
      // Datos del cliente que devuelve (origen del paquete inverso).
      destinatarioNombre: envioOriginal.destino.nombre || "Sin Nombre",
      calle: envioOriginal.destino.calle || "Sin Calle",
      altura: envioOriginal.destino.altura || "0",
      piso: envioOriginal.destino.piso || "",
      dpto: envioOriginal.destino.dpto || "",
      localidad: envioOriginal.destino.localidad || "CABA",
      provincia: envioOriginal.destino.provincia || "CABA",
      cp: envioOriginal.destino.cp,
      dni: envioOriginal.destino.documento || "0",
      email: envioOriginal.destino.email || "sinemail@shipro.pro",
      telefono: envioOriginal.destino.telefono || "1100000000",
      peso: envioOriginal.pesoReal || 1,
      paquetes: [{
        pesoKg: envioOriginal.pesoReal || 1,
        largoCm: 10,
        anchoCm: 10,
        altoCm: 10,
        valorDeclarado: envioOriginal.finanzas?.precioFactura?.toNumber() ?? 0,
        requiereSeguro: false
      }],
      referencia: `INVERSA-${trackingOriginal}`,
      tipoEntrega: tipoEntregaFormateado,
      trackingOriginal: trackingOriginal,
      // DEUDA 4: depósito real al que llega la inversa (Mocis lo usa como
      // destino del shipping_inversa). Reemplaza el hardcoded "Depósito Central"
      // que tenía el adapter por defecto.
      origen: {
        calle: depositoPred.direccionCalle,
        altura: depositoPred.direccionAltura,
        cp: depositoPred.codigoPostal,
        localidad: depositoPred.localidad,
        provincia: depositoPred.provincia,
        pais: depositoPred.pais,
        telefono: depositoPred.contactoTelefono,
        email: depositoPred.contactoEmail || undefined,
      },
    };

    let trackingInverso = "SHP-INV-" + Math.floor(Math.random() * 900000);
    let urlEtiquetaFinal = null;

    try {
      const respuestaCourier = await motorCourier.despachar(paramsDespacho);
      if (respuestaCourier && respuestaCourier.tracking) {
        trackingInverso = respuestaCourier.tracking;
        urlEtiquetaFinal = respuestaCourier.etiquetaUrl || null;
      }
    } catch (errorDisp: any) {
      console.error("[Shipro] Error al generar inversa en el courier:", errorDisp.message);
      return NextResponse.json({ error: errorDisp.message }, { status: 400 });
    }

    const nuevoEnvio = await prisma.envio.create({
      data: {
        trackingNumber: trackingInverso,
        etiquetaUrl: urlEtiquetaFinal,
        pesoReal: envioOriginal.pesoReal || 1.0,
        estadoActual: "IMPRESO",
        modalidad: tipoAccion === 'cambio' ? "Cambio Inverso" : "Devolución Inversa",
        fechaImpresion: new Date(),
        empresa: { connect: { id: envioOriginal.empresaId } },
        courier: { connect: { id: envioOriginal.courierId } },
        origen: envioOriginal.destinoId ? { connect: { id: envioOriginal.destinoId } } : undefined,
        destino: envioOriginal.origenId ? { connect: { id: envioOriginal.origenId } } : undefined,
        finanzas: {
          create: {
            precioFactura: envioOriginal.finanzas?.precioFactura || 0,
            precioMostrado: 0 
          }
        }
      }
    });

    await prisma.eventoTracking.create({
      data: {
        estado: "IMPRESO",
        observacion: `Etiqueta de ${tipoAccion} generada a partir del envío ${trackingOriginal}.`,
        envioId: nuevoEnvio.id
      }
    });

    return NextResponse.json({ trackingNumber: trackingInverso, etiquetaUrl: urlEtiquetaFinal });

  } catch (error: any) {
    console.error("Error en POST inversa:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}