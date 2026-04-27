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
      contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || ''
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
    const { tracking, forzarActualizacion } = await request.json();

    if (!tracking) return NextResponse.json({ error: "Falta el número de tracking" }, { status: 400 });

    const envio = await prisma.envio.findFirst({
      where: { trackingNumber: tracking },
      include: { courier: true, destino: true, finanzas: true }
    });

    if (!envio) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });

    let mensaje = "Historial cargado";
    if (forzarActualizacion && envio.estadoActual !== "CANCELADO") {
      const nombreNormalizado = envio.courier.nombre.toLowerCase();
      
      const credencial = await prisma.credencialCourier.findUnique({
        where: { empresaId_nombreCourier: { empresaId: envio.empresaId, nombreCourier: envio.courier.nombre } }
      });

      // REGLA ESTRICTA DE CREDENCIALES
      let llaves = credencial?.usaCredencialesPropias 
        ? JSON.parse(credencial.credencialesJson || '{}') 
        : obtenerCredencialesShipro(nombreNormalizado);

      const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);
      
      try {
        const nuevoEstadoCrudo = await motorCourier.rastrear(tracking);
        if (nuevoEstadoCrudo && nuevoEstadoCrudo !== envio.estadoActual) {
          await prisma.envio.update({ where: { id: envio.id }, data: { estadoActual: nuevoEstadoCrudo } });
          await prisma.eventoTracking.create({
            data: { estado: nuevoEstadoCrudo, observacion: "Actualización manual forzada", envioId: envio.id }
          });
          mensaje = "¡Estado actualizado desde el Courier!";
          envio.estadoActual = nuevoEstadoCrudo; 
        } else {
          mensaje = "El courier no reporta nuevos movimientos.";
        }
      } catch (e: any) {
        mensaje = "No se pudo conectar con el Courier, mostrando último estado conocido.";
      }
    }

    const historial = await prisma.eventoTracking.findMany({
      where: { envioId: envio.id },
      orderBy: { id: 'desc' }
    });

    return NextResponse.json({ 
      success: true, 
      mensaje,
      envio: {
        id: envio.id,
        tracking: envio.trackingNumber,
        estadoActual: envio.estadoActual,
        courier: envio.courier.nombre,
        modalidad: envio.modalidad || "Estándar",
        peso: envio.pesoReal || 1,
        fechaCreacion: envio.fechaImpresion, 
        destinatario: {
          nombre: envio.destino?.nombre || "Sin Nombre",
          documento: envio.destino?.documento || "-",
          telefono: envio.destino?.telefono || "-",
          email: envio.destino?.email || "-",
          direccionStr: `${envio.destino?.calle || ''} ${envio.destino?.altura || ''} ${envio.destino?.piso ? `Piso ${envio.destino.piso}` : ''}`,
          localidad: envio.destino?.localidad || "",
          cp: envio.destino?.cp || ""
        },
        finanzas: {
          costoEnvio: envio.finanzas?.precioMostrado || envio.finanzas?.precioFactura || 0,
          valorDeclarado: envio.finanzas?.precioFactura || 0 
        }
      },
      historial 
    });

  } catch (error: any) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}