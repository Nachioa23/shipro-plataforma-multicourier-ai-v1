import prisma from "@/lib/prisma";
import { despacharCourier } from "@/lib/envios/dispatch";
import { enviarMailCreacion } from "@/lib/mailer";

const MAX_INLINE = 10;

export interface ProcesarBloqueadosResult {
  procesados: number;
  fallados: number;
  restantes: number;
  totalBloqueados: number;
}

/**
 * Procesa envíos en estado BLOQUEADO_SALDO de una empresa, FIFO por id.
 * Útil después de una recarga de saldo (DEUDA 16).
 *
 * Para cada envío bloqueado: si el saldo alcanza con la regla de su
 * tipoCuenta efectivo (PREPAGO o POSTPAGO), llama al courier real,
 * actualiza tracking + etiquetaUrl + estado, debita saldo, crea
 * MovimientoFinanciero y manda mail al destinatario.
 *
 * Si el courier falla, el envío queda en BLOQUEADO_SALDO con un
 * EventoTracking nuevo describiendo el error.
 *
 * Procesa máx MAX_INLINE envíos por llamada (latencia bounded);
 * el resto queda para otra llamada o un endpoint manual futuro.
 */
export async function procesarEnviosBloqueados(empresaId: number): Promise<ProcesarBloqueadosResult> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    return { procesados: 0, fallados: 0, restantes: 0, totalBloqueados: 0 };
  }

  const todosBloqueados = await prisma.envio.findMany({
    where: { empresaId, estadoActual: "BLOQUEADO_SALDO" },
    include: { courier: true, finanzas: true, destino: true },
    orderBy: { id: 'asc' }
  });

  if (todosBloqueados.length === 0) {
    return { procesados: 0, fallados: 0, restantes: 0, totalBloqueados: 0 };
  }

  const aProcesar = todosBloqueados.slice(0, MAX_INLINE);

  // Saldo simulado en memoria — descontamos a medida que destrabamos.
  // Asume serialización (no hay otra recarga concurrente). Si la hay,
  // peor caso: dejamos algunos envíos sin destrabar (reintento manual).
  let saldoSimulado = empresa.saldoActivo;
  const limite = empresa.limiteDescubierto;

  let procesados = 0;
  let fallados = 0;

  for (const envio of aProcesar) {
    const monto = envio.finanzas?.precioFactura || 0;

    const credencial = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId, nombreCourier: envio.courier.nombre } }
    });

    if (!credencial) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_SALDO",
          observacion: `Reintento post-recarga falló: credencial de ${envio.courier.nombre} no encontrada para esta empresa.`,
          envioId: envio.id
        }
      });
      fallados++;
      continue;
    }

    const tipoCuentaEfectivo = credencial.tipoCuenta || empresa.modalidadPago;
    const saldoDisponible = tipoCuentaEfectivo === "PREPAGO" ? saldoSimulado : saldoSimulado + limite;

    if (saldoDisponible < monto) {
      // Saldo no alcanza para este. Como vamos FIFO, los siguientes tampoco
      // si tienen costo similar — pero podrían ser más baratos. Continuamos
      // por si alguno encaja (no break).
      continue;
    }

    if (!envio.destino) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_SALDO",
          observacion: `Reintento post-recarga falló: envío sin destino cargado.`,
          envioId: envio.id
        }
      });
      fallados++;
      continue;
    }

    const dispatchResult = await despacharCourier({
      credencial,
      courierNombreCanonico: envio.courier.nombre,
      destinatarioNombre: envio.destino.nombre || "",
      calle: envio.destino.calle || "",
      altura: envio.destino.altura || "",
      piso: envio.destino.piso || undefined,
      dpto: envio.destino.dpto || undefined,
      localidad: envio.destino.localidad || "",
      provincia: envio.destino.provincia || undefined,
      cp: envio.destino.cp,
      dni: envio.destino.documento || "",
      email: envio.destino.email || "",
      telefono: envio.destino.telefono || "",
      pesoReal: envio.pesoReal,
      valorDeclarado: envio.finanzas?.valorDeclarado || 0,
      modalidad: envio.modalidad,
      numeroOrden: envio.numeroOrden
    });

    if (!dispatchResult.tracking) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_SALDO",
          observacion: `Reintento post-recarga falló: ${dispatchResult.error || "courier no devolvió tracking"}.`,
          envioId: envio.id
        }
      });
      fallados++;
      continue;
    }

    const trackingReal = dispatchResult.tracking;
    const nuevoSaldo = saldoSimulado - monto;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.envio.update({
          where: { id: envio.id },
          data: {
            trackingNumber: trackingReal,
            trackingFirstMile: dispatchResult.trackingFirstMile,
            etiquetaUrl: dispatchResult.etiquetaUrl,
            estadoActual: "Pendiente"
          }
        });

        await tx.movimientoFinanciero.create({
          data: {
            empresaId,
            tipo: "DEBITO_ENVIO",
            monto: -monto,
            saldoPosterior: nuevoSaldo,
            referencia: trackingReal,
            descripcion: `Generación de etiqueta ${envio.courier.nombre.toUpperCase()} (desbloqueo post-recarga)`,
            envioId: envio.id
          }
        });

        await tx.empresa.update({
          where: { id: empresaId },
          data: { saldoActivo: nuevoSaldo }
        });

        await tx.eventoTracking.create({
          data: {
            estado: "Pendiente",
            observacion: `Desbloqueado post-recarga. Tracking real: ${trackingReal}.`,
            envioId: envio.id
          }
        });
      });

      saldoSimulado = nuevoSaldo;

      if (envio.destino.email) {
        try {
          enviarMailCreacion(
            envio.destino.email,
            trackingReal,
            envio.destino.nombre || "Cliente",
            envio.courier.nombre,
            `${process.env.APP_URL || "http://localhost:3000"}/seguimiento/${trackingReal}`
          );
        } catch (mailErr) {
          console.warn(`[procesarEnviosBloqueados] Fallo al mandar mail para ${trackingReal}:`, mailErr);
        }
      }

      procesados++;
    } catch (txErr: any) {
      console.error(`[procesarEnviosBloqueados] Falló transacción para envío ${envio.id}:`, txErr);
      // El courier ya generó tracking real pero la BD no se actualizó. Riesgo
      // de tracking huérfano en sistema del courier. Logueamos y seguimos.
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_SALDO",
          observacion: `Tracking ${trackingReal} generado en courier pero falló persistencia: ${txErr?.message || "Error de BD"}. Revisar manualmente.`,
          envioId: envio.id
        }
      });
      fallados++;
    }
  }

  const restantes = todosBloqueados.length - procesados - fallados;
  return { procesados, fallados, restantes, totalBloqueados: todosBloqueados.length };
}
