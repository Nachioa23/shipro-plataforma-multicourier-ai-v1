import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { enviarMailColecta, enviarMailEntregadoNPS } from "@/lib/mailer";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";

export async function GET(request: Request) {
  try {
    const LOTE_MAXIMO = 200; // Capacidad escalada para +100k envíos/mes
    // DEUDA 14: fail-fast si APP_URL no esta configurada (mejor que mandar
    // mails con links a localhost desde produccion).
    const baseUrl = getAppUrlOrThrow();

    // OBTENER LOS ENVÍOS "MÁS VIEJOS" QUE NO ESTÁN ENTREGADOS
    // Ordenamos por 'fechaActualizacion' ascendente, para que siempre procese los más atrasados primero.
    const enviosARastrear = await prisma.envio.findMany({
      where: {
        estadoActual: { notIn: ["ENTREGADO", "INCIDENCIA", "CANCELADO", "DEVUELTO", "NO_ENTREGADO", "BLOQUEADO_SALDO", "BLOQUEADO_DEPOSITO"] },
        trackingNumber: { not: "" }
      },
      include: { 
        destino: true, courier: true, empresa: true,
        tickets: { where: { estado: "ABIERTO" } },
        eventos: { orderBy: { fecha: 'desc' }, take: 1 }
      },
      orderBy: { id: 'asc' }, // Priorizamos los envíos más viejos que aún no se entregaron
      take: LOTE_MAXIMO
    });

    if (enviosARastrear.length === 0) return NextResponse.json({ mensaje: "No hay envíos activos que requieran rastreo." });

    let actualizados = 0; let errores = 0; let ticketsCreados = 0;

    for (const envio of enviosARastrear) {
      try {
        if (envio.trackingNumber.startsWith('SHP-')) continue;

        const nombreCourierBaseDatos = envio.courier.nombre;
        const nombreNormalizado = normalizarParaComparacion(nombreCourierBaseDatos);

        const credencial = await prisma.credencialCourier.findUnique({
          where: { empresaId_nombreCourier: { empresaId: envio.empresaId, nombreCourier: nombreCourierBaseDatos } }
        });

        let llaves = credencial?.usaCredencialesPropias
          ? parsearCredencialesPropias(nombreNormalizado, credencial.credencialesJson)
          : obtenerCredencialesShipro(nombreNormalizado);

        const motorCourier = CourierFactory.crear(nombreNormalizado, llaves);
        const nuevoEstadoCrudo = await motorCourier.rastrear(envio.trackingNumber);
        
        if (nuevoEstadoCrudo && nuevoEstadoCrudo !== "DESCONOCIDO") {
          let estadoShiproLimpio = nuevoEstadoCrudo;
          let mapeo = await prisma.nomenclador.findUnique({
            where: { courierId_estadoCrudo: { courierId: envio.courierId, estadoCrudo: nuevoEstadoCrudo } }
          });

          if (!mapeo) {
            mapeo = await prisma.nomenclador.create({
              data: { courierId: envio.courierId, estadoCrudo: nuevoEstadoCrudo, estadoShipro: null }
            });
          }

          if (mapeo && mapeo.estadoShipro) {
             estadoShiproLimpio = mapeo.estadoShipro.replace('S_', '');
          }

          if (estadoShiproLimpio !== envio.estadoActual) {
            let datosAActualizar: any = { estadoActual: estadoShiproLimpio };
            
            if ((estadoShiproLimpio === "COLECTADO" || estadoShiproLimpio === "TRANSITO") && !envio.fechaColecta) {
                datosAActualizar.fechaColecta = new Date();
            }
            if (estadoShiproLimpio === "ENTREGADO" && !envio.fechaEntrega) {
                datosAActualizar.fechaEntrega = new Date();
            }

            await prisma.envio.update({ where: { id: envio.id }, data: datosAActualizar });
            // Torre de Control Metrica 1.1 (2026-06-04): poblar estadoCrudoOriginal
            // con el estado raw del courier antes del mapeo via Nomenclador. Permite
            // calcular frecuencia ponderada de aparicion de cada estado crudo. El
            // campo observacion se preserva para backward-compat de parsers historicos.
            await prisma.eventoTracking.create({
              data: {
                estado: estadoShiproLimpio,
                estadoCrudoOriginal: nuevoEstadoCrudo,
                observacion: `El courier reportó: ${nuevoEstadoCrudo}`,
                envioId: envio.id
              }
            });
            
            const emailCliente = envio.destino?.email;
            const nombreCliente = envio.destino?.nombre || "Cliente";

            if (emailCliente) {
              const urlSeguimiento = `${baseUrl}/s/${envio.trackingNumber}`;
              if (envio.estadoActual === "IMPRESO" && (estadoShiproLimpio === "COLECTADO" || estadoShiproLimpio === "TRANSITO")) {
                enviarMailColecta(emailCliente, envio.trackingNumber, nombreCliente, nombreCourierBaseDatos, urlSeguimiento);
              }
              if (estadoShiproLimpio === "ENTREGADO") {
                enviarMailEntregadoNPS(emailCliente, envio.trackingNumber, nombreCliente, nombreCourierBaseDatos, baseUrl);
              }
            }
            actualizados++;
          } else {
             if (envio.eventos.length > 0) {
                const ultimoMovimiento = envio.eventos[0].fecha;
                const horasInactivo = (new Date().getTime() - new Date(ultimoMovimiento).getTime()) / (1000 * 60 * 60);

                if (horasInactivo >= 36 && envio.tickets.length === 0) {
                    await prisma.ticketSoporte.create({
                        data: {
                            motivo: "Demora sin actualización del Courier (>36hs)",
                            estado: "ABIERTO",
                            observacion: `[Alerta Automática] El paquete lleva ${Math.round(horasInactivo)} horas atascado en el estado: "${envio.estadoActual}". Requiere intervención.`,
                            envioId: envio.id
                        }
                    });
                    ticketsCreados++;
                }
             }
          }
        }
      } catch (error) {
        errores++;
      }
    }

    return NextResponse.json({ 
      mensaje: "Ronda de rastreo finalizada", 
      procesados: enviosARastrear.length,
      actualizados: actualizados,
      alertasCreadas: ticketsCreados,
      errores: errores
    });

  } catch (error) {
    return NextResponse.json({ error: "Error interno al ejecutar el rastreo" }, { status: 500 });
  }
}