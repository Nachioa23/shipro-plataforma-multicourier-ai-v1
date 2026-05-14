import prisma from "@/lib/prisma";
import { despacharCourier } from "@/lib/envios/dispatch";
import { enviarMailCreacion } from "@/lib/mailer";

const MAX_INLINE = 10;

export interface ProcesarBloqueadosDepositoResult {
  procesados: number;
  fallados: number;
  transicionadosASaldo: number;
  restantes: number;
  totalBloqueados: number;
}

/**
 * Procesa envíos en estado BLOQUEADO_DEPOSITO de una empresa, FIFO por id.
 * Útil después de que la empresa configure su depósito predeterminado
 * (DEUDA 4 + visión DEUDA 27).
 *
 * Para cada envío bloqueado: carga el depósito predeterminado actual de la
 * empresa. Si no hay, no se procesa nada (return temprano).
 *
 * Si hay depósito predeterminado, valida saldo según el `tipoCuenta` efectivo
 * (igual que procesar-bloqueados.ts):
 * - Si saldo NO alcanza: el envío transiciona a BLOQUEADO_SALDO. La empresa
 *   debe recargar saldo, y procesarEnviosBloqueados() lo destrabará.
 * - Si saldo OK: llama al courier real, actualiza el envío con tracking real,
 *   asigna depositoId y origen snapshot, debita saldo, manda mail.
 *
 * Procesa máx MAX_INLINE envíos por llamada.
 */
export async function procesarEnviosBloqueadosPorDeposito(empresaId: number): Promise<ProcesarBloqueadosDepositoResult> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: {
      depositos: {
        where: { eliminado: false, activo: true, esPredeterminado: true },
        take: 1,
      },
    },
  });

  if (!empresa) {
    return { procesados: 0, fallados: 0, transicionadosASaldo: 0, restantes: 0, totalBloqueados: 0 };
  }

  const depositoPred = empresa.depositos[0];
  if (!depositoPred) {
    // Aún no hay depósito predeterminado configurado. Nada que hacer.
    return { procesados: 0, fallados: 0, transicionadosASaldo: 0, restantes: 0, totalBloqueados: 0 };
  }

  const todosBloqueados = await prisma.envio.findMany({
    where: { empresaId, estadoActual: "BLOQUEADO_DEPOSITO" },
    include: { courier: true, finanzas: true, destino: true },
    orderBy: { id: 'asc' },
  });

  if (todosBloqueados.length === 0) {
    return { procesados: 0, fallados: 0, transicionadosASaldo: 0, restantes: 0, totalBloqueados: 0 };
  }

  const aProcesar = todosBloqueados.slice(0, MAX_INLINE);

  // Saldo simulado en memoria — descontamos a medida que destrabamos.
  let saldoSimulado = empresa.saldoActivo;
  const limite = empresa.limiteDescubierto;

  let procesados = 0;
  let fallados = 0;
  let transicionadosASaldo = 0;

  for (const envio of aProcesar) {
    const monto = envio.finanzas?.precioFactura || 0;

    const credencial = await prisma.credencialCourier.findUnique({
      where: { empresaId_nombreCourier: { empresaId, nombreCourier: envio.courier.nombre } },
    });

    if (!credencial) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_DEPOSITO",
          observacion: `Reintento post-configuración de depósito falló: credencial de ${envio.courier.nombre} no encontrada para esta empresa.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    if (!envio.destino) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_DEPOSITO",
          observacion: `Reintento post-configuración de depósito falló: envío sin destino cargado.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    // Validar saldo. Si no alcanza, transicionar a BLOQUEADO_SALDO (el envío
    // tendrá depositoId asignado por consistencia, pero queda esperando recarga).
    const tipoCuentaEfectivo = credencial.tipoCuenta || empresa.modalidadPago;
    const saldoDisponible = tipoCuentaEfectivo === "PREPAGO" ? saldoSimulado : saldoSimulado + limite;

    if (saldoDisponible < monto) {
      // Transición DEPOSITO → SALDO: poblar depositoId + origenId snapshot,
      // pero NO despachar ni debitar. Estado pasa a BLOQUEADO_SALDO.
      try {
        await prisma.$transaction(async (tx) => {
          const direccionOrigen = await tx.direccion.create({
            data: {
              nombre: depositoPred.nombre,
              calle: depositoPred.direccionCalle,
              altura: depositoPred.direccionAltura,
              piso: depositoPred.direccionPiso,
              dpto: depositoPred.direccionDpto,
              cp: depositoPred.codigoPostal,
              localidad: depositoPred.localidad,
              provincia: depositoPred.provincia,
              pais: depositoPred.pais,
              telefono: depositoPred.contactoTelefono,
              email: depositoPred.contactoEmail,
            },
          });

          await tx.envio.update({
            where: { id: envio.id },
            data: {
              estadoActual: "BLOQUEADO_SALDO",
              depositoId: depositoPred.id,
              origenId: direccionOrigen.id,
            },
          });

          await tx.eventoTracking.create({
            data: {
              estado: "BLOQUEADO_SALDO",
              observacion: `Depósito configurado y asignado, pero saldo insuficiente. Costo $${monto.toFixed(2)}, disponible $${saldoDisponible.toFixed(2)} (${tipoCuentaEfectivo}). Se desbloqueará al recargar saldo.`,
              envioId: envio.id,
            },
          });
        });
        transicionadosASaldo++;
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorDeposito] Transición a BLOQUEADO_SALDO falló para envío ${envio.id}:`, txErr);
        fallados++;
      }
      continue;
    }

    // Saldo alcanza. Despachar al courier con origen del depósito.
    const dispatchResult = await despacharCourier({
      credencial,
      courierNombreCanonico: envio.courier.nombre,
      // === DEUDA 29 Sub-fase 1.C.2 ===
      courierIdMain: envio.courierId,
      // DEUDA 29 Sub-fase 2.D.despachar: depositoId para resolver sucursal
      // preferida. En este flow envio.depositoId siempre está poblado (porque
      // el destrabe ya asignó el depósito predeterminado antes de llegar acá),
      // pero defensivamente normalizamos null → undefined.
      depositoId: envio.depositoId ?? undefined,
      // tipoOrigen defensivo: el campo es String en BD, normalizamos al union.
      // Si el valor original era "drop_off_cliente", lo respetamos. Cualquier otro
      // (incluido default "recoleccion_courier") cae al recoleccion_courier.
      //
      // TODO DEUDA 29 Sub-fase 6: validación en crear.ts para que envíos con
      // tipoOrigen="drop_off_cliente" no entren a BLOQUEADO_DEPOSITO (no necesitan
      // depósito propio porque el cliente lleva el paquete a sucursal del courier).
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
    });

    if (!dispatchResult.tracking) {
      // DEUDA 29 Sub-fase 1.C.2: PARTIAL FAILURE.
      // El envío deja BLOQUEADO_DEPOSITO y pasa a BLOQUEADO_PARCIAL.
      // Asignamos depositoId + origenId snapshot AUNQUE el courier falle: el cliente
      // YA configuró su depósito predeterminado, esa info no se debe perder. El motivo
      // del bloqueo cambió de "sin depósito" a "courier rechazó". NO debitamos saldo.
      // Persistimos tramos exitosos si los hay (caso C tramo 1 OK + tramo 2 falla).
      try {
        await prisma.$transaction(async (tx) => {
          const direccionOrigen = await tx.direccion.create({
            data: {
              nombre: depositoPred.nombre,
              calle: depositoPred.direccionCalle,
              altura: depositoPred.direccionAltura,
              piso: depositoPred.direccionPiso,
              dpto: depositoPred.direccionDpto,
              cp: depositoPred.codigoPostal,
              localidad: depositoPred.localidad,
              provincia: depositoPred.provincia,
              pais: depositoPred.pais,
              telefono: depositoPred.contactoTelefono,
              email: depositoPred.contactoEmail,
            },
          });

          await tx.envio.update({
            where: { id: envio.id },
            data: {
              estadoActual: "BLOQUEADO_PARCIAL",
              depositoId: depositoPred.id,
              origenId: direccionOrigen.id,
            },
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
              observacion: `Reintento post-configuración de depósito falló: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos persistidos: ${dispatchResult.tramos.length}. El operador debe resolver la falla manualmente.`,
              envioId: envio.id,
            },
          });
        });
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorDeposito] Falló transición a BLOQUEADO_PARCIAL para envío ${envio.id}:`, txErr);
      }
      fallados++;
      continue;
    }

    const trackingReal = dispatchResult.tracking;
    const nuevoSaldo = saldoSimulado - monto;

    try {
      await prisma.$transaction(async (tx) => {
        // Snapshot de la dirección de origen al momento del despacho.
        const direccionOrigen = await tx.direccion.create({
          data: {
            nombre: depositoPred.nombre,
            calle: depositoPred.direccionCalle,
            altura: depositoPred.direccionAltura,
            piso: depositoPred.direccionPiso,
            dpto: depositoPred.direccionDpto,
            cp: depositoPred.codigoPostal,
            localidad: depositoPred.localidad,
            provincia: depositoPred.provincia,
            pais: depositoPred.pais,
            telefono: depositoPred.contactoTelefono,
            email: depositoPred.contactoEmail,
          },
        });

        await tx.envio.update({
          where: { id: envio.id },
          data: {
            trackingNumber: trackingReal,
            // TODO DEUDA 29 Sub-fase 3: tracking del first-mile ahora vive en TramoEnvio.trackingExterno.
            etiquetaUrl: dispatchResult.etiquetaUrl,
            estadoActual: "Pendiente",
            depositoId: depositoPred.id,
            origenId: direccionOrigen.id,
          },
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
            descripcion: `Generación de etiqueta ${envio.courier.nombre.toUpperCase()} (desbloqueo post-configuración de depósito)`,
            envioId: envio.id,
          },
        });

        await tx.empresa.update({
          where: { id: empresaId },
          data: { saldoActivo: nuevoSaldo },
        });

        await tx.eventoTracking.create({
          data: {
            estado: "Pendiente",
            observacion: `Desbloqueado post-configuración de depósito. Tracking real: ${trackingReal}.`,
            envioId: envio.id,
          },
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
          console.warn(`[procesarEnviosBloqueadosPorDeposito] Fallo al mandar mail para ${trackingReal}:`, mailErr);
        }
      }

      procesados++;
    } catch (txErr: any) {
      console.error(`[procesarEnviosBloqueadosPorDeposito] Falló transacción para envío ${envio.id}:`, txErr);
      // Tracking ya generado en courier pero BD no se actualizó. Logueamos.
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_DEPOSITO",
          observacion: `Tracking ${trackingReal} generado en courier pero falló persistencia: ${txErr?.message || "Error de BD"}. Revisar manualmente.`,
          envioId: envio.id,
        },
      });
      fallados++;
    }
  }

  const restantes = todosBloqueados.length - procesados - fallados - transicionadosASaldo;
  return { procesados, fallados, transicionadosASaldo, restantes, totalBloqueados: todosBloqueados.length };
}
