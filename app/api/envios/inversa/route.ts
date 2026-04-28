import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";

function obtenerCredencialesShipro(courier: string) {
  const c = courier.toLowerCase(); 
  if (c === 'andreani') {
    return { 
      username: process.env.ANDREANI_USER?.trim() || '', 
      password: process.env.ANDREANI_PASS?.trim() || '', 
      cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
      contrato_cambio: process.env.ANDREANI_CONTRATO_CAMBIO?.trim() || '',
      contrato_devolucion: process.env.ANDREANI_CONTRATO_DEVOLUCION?.trim() || ''
    };
  }
  if (c === 'mocis') {
    return { 
      clientApi: process.env.MOCIS_CLIENT_API?.trim() || '', 
      clientSecret: process.env.MOCIS_CLIENT_SECRET?.trim() || '' 
    };
  }
  return {};
}

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

    const nombreNormalizado = envioOriginal.courier.nombre.toLowerCase();

    const credencial = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId: envioOriginal.empresaId, nombreCourier: envioOriginal.courier.nombre } }
    });

    // REGLA ESTRICTA DE CREDENCIALES
    let llaves = credencial?.usaCredencialesPropias
        ? JSON.parse(credencial.credencialesJson || '{}')
        : obtenerCredencialesShipro(nombreNormalizado);

    const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);

    let tipoEntregaFormateado: "inversa" | "cambio" = "inversa";
    if (tipoAccion === 'cambio') tipoEntregaFormateado = "cambio";

    const paramsDespacho = {
      destinatarioNombre: envioOriginal.destino.nombre || "Sin Nombre",
      calle: envioOriginal.destino.calle || "Sin Calle",
      altura: envioOriginal.destino.altura || "0",
      piso: envioOriginal.destino.piso || "",
      dpto: envioOriginal.destino.dpto || "",
      localidad: envioOriginal.destino.localidad || "CABA",
      provincia: envioOriginal.destino.provincia || "CABA",
      // HARDCODED: CP de origen del depósito.
      // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
      // Ver DEUDAS.md
      cp: envioOriginal.destino.cp || "1050",
      dni: envioOriginal.destino.documento || "0",
      email: envioOriginal.destino.email || "sinemail@shipro.pro",
      telefono: envioOriginal.destino.telefono || "1100000000",
      peso: envioOriginal.pesoReal || 1,
      paquetes: [{
        pesoKg: envioOriginal.pesoReal || 1,
        largoCm: 10,
        anchoCm: 10,
        altoCm: 10,
        valorDeclarado: envioOriginal.finanzas?.precioFactura || 0,
        requiereSeguro: false
      }],
      referencia: `INVERSA-${trackingOriginal}`,
      tipoEntrega: tipoEntregaFormateado,
      trackingOriginal: trackingOriginal 
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