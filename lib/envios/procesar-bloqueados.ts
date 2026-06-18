import prisma from "@/lib/prisma";
import { despacharCourier } from "@/lib/envios/dispatch";
import { enviarMailCreacion } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  evaluarSuspension,
  reactivarEmpresa,
} from "@/lib/utils/suspension-cuenta";

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

  // DEUDA 22 (2026-06-18): auto-reactivacion post-recarga.
  // Esta funcion se llama desde /api/admin/finanzas POST despues de acreditar pago.
  // Si la empresa esta suspendida Y el saldo cruzo umbral de reactivacion
  // (saldoActivo >= -limiteDescubierto * 0.5), reactivamos automaticamente.
  // El audit log queda con rolUsuario="system" (no tenemos Request aqui).
  if (empresa.suspendida) {
    const { debeReactivar } = evaluarSuspension(
      empresa.saldoActivo,
      empresa.limiteDescubierto,
      true  // suspendidaActual = true (ya validado por el if)
    );
    if (debeReactivar) {
      try {
        await reactivarEmpresa(
          empresaId,
          null,
          empresa.saldoActivo,
          empresa.limiteDescubierto
        );
        console.log(`[DEUDA 22] Empresa ${empresaId} REACTIVADA automaticamente post-recarga.`);
      } catch (reactErr) {
        console.error(`[DEUDA 22] reactivarEmpresa fallo para empresa ${empresaId}:`, reactErr);
      }
    }
  }

  const todosBloqueados = await prisma.envio.findMany({
    where: { empresaId, estadoActual: "BLOQUEADO_SALDO" },
    include: { courier: true, finanzas: true, destino: true, deposito: true },
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

    // DEUDA 4: pasar origen del depósito al courier. Para envíos creados
    // post-DEUDA 4, `depositoId` está poblado. Para envíos legacy (null),
    // omitimos origen y el adapter cae al fallback hardcoded.
    const origenDeposito = envio.deposito ? {
      calle: envio.deposito.direccionCalle,
      altura: envio.deposito.direccionAltura,
      cp: envio.deposito.codigoPostal,
      localidad: envio.deposito.localidad,
      provincia: envio.deposito.provincia,
      pais: envio.deposito.pais,
      telefono: envio.deposito.contactoTelefono,
      email: envio.deposito.contactoEmail || undefined,
    } : undefined;

    const dispatchResult = await despacharCourier({
      credencial,
      courierNombreCanonico: envio.courier.nombre,
      // === DEUDA 29 Sub-fase 1.C.2 ===
      courierIdMain: envio.courierId,
      // DEUDA 29 Sub-fase 2.D.despachar: depositoId para resolver sucursal
      // preferida. En envíos legacy depositoId puede ser null → undefined
      // skipea el lookup (adapter cae a fallback creds.id_sucursal_origen).
      depositoId: envio.depositoId ?? undefined,
      // tipoOrigen defensivo: el campo es String en BD, normalizamos al union.
      // Si el valor original era "drop_off_cliente", lo respetamos. Cualquier otro
      // (incluido default "recoleccion_courier") cae al recoleccion_courier.
      tipoOrigen: envio.tipoOrigen === "drop_off_cliente" ? "drop_off_cliente" : "recoleccion_courier",
      // TODO DEUDA 29 Sub-fase 6: persistir sucursalOrigenId/sucursalDestinoId del
      // envío original cuando UI lo pueble. Hoy no se persisten en Envio (solo
      // en TramoEnvio post-despacho), así que en reintentos van como null.
      sucursalOrigenId: null,
      sucursalDestinoId: null,
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
      numeroOrden: envio.numeroOrden,
      origen: origenDeposito,
    });

    if (!dispatchResult.tracking) {
      // DEUDA 29 Sub-fase 1.C.2: PARTIAL FAILURE.
      // El envío deja BLOQUEADO_SALDO y pasa a BLOQUEADO_PARCIAL.
      // Persistimos los tramos efectivamente despachados (puede ser 0 o más, ej. caso C
      // con tramo 1 OK + tramo 2 falla). NO debitamos saldo (no hubo despacho exitoso).
      // saldoSimulado queda intacto para los próximos envíos del loop.
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: { estadoActual: "BLOQUEADO_PARCIAL" }
          });

          if (dispatchResult.tramos.length > 0) {
            await tx.tramoEnvio.createMany({
              data: dispatchResult.tramos.map(t => ({
                envioId: envio.id,
                orden: t.orden,
                courierId: t.courierId,
                tipo: t.tipo,
                trackingExterno: t.trackingExterno,
                sucursalOrigenId: t.sucursalOrigenId ?? null,
                sucursalDestinoId: t.sucursalDestinoId ?? null,
              })),
            });
          }

          await tx.eventoTracking.create({
            data: {
              estado: "BLOQUEADO_PARCIAL",
              observacion: `Reintento post-recarga falló: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos persistidos: ${dispatchResult.tramos.length}. El operador debe resolver la falla manualmente.`,
              envioId: envio.id
            }
          });
        });
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueados] Falló transición a BLOQUEADO_PARCIAL para envío ${envio.id}:`, txErr);
      }
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
            // TODO DEUDA 29 Sub-fase 3: tracking del first-mile ahora vive en TramoEnvio.trackingExterno.
            etiquetaUrl: dispatchResult.etiquetaUrl,
            estadoActual: "Pendiente"
          }
        });

        // DEUDA 29 Sub-fase 1.C.2: persistir los TramoEnvio que dispatch.ts ejecutó.
        if (dispatchResult.tramos.length > 0) {
          await tx.tramoEnvio.createMany({
            data: dispatchResult.tramos.map(t => ({
              envioId: envio.id,
              orden: t.orden,
              courierId: t.courierId,
              tipo: t.tipo,
              trackingExterno: t.trackingExterno,
              sucursalOrigenId: t.sucursalOrigenId ?? null,
              sucursalDestinoId: t.sucursalDestinoId ?? null,
            })),
          });
        }

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
        // DEUDA 14: skip mail si APP_URL no esta configurada (warn loggeado en helper).
        const baseUrl = getAppUrl();
        if (baseUrl) {
          try {
            enviarMailCreacion(
              envio.destino.email,
              trackingReal,
              envio.destino.nombre || "Cliente",
              envio.courier.nombre,
              `${baseUrl}/s/${trackingReal}`
            );
          } catch (mailErr) {
            console.warn(`[procesarEnviosBloqueados] Fallo al mandar mail para ${trackingReal}:`, mailErr);
          }
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
