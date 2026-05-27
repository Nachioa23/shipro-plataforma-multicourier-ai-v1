import prisma from "@/lib/prisma";
import { despacharCourier } from "@/lib/envios/dispatch";
import { enviarMailCreacion } from "@/lib/mailer";
import { validarOperatividadPar } from "@/lib/depositos/operatividad";

// =============================================================================
// DEUDA 34: Destrabe automatico de envios en BLOQUEADO_OPERATIVIDAD
// =============================================================================
//
// Procesa envios en estado BLOQUEADO_OPERATIVIDAD para un deposito dado,
// opcionalmente filtrados por courierId. FIFO por id, max MAX_INLINE por
// llamada.
//
// Se dispara cuando cambia la configuracion de un par (deposito x courier)
// o el courierRecolectorId de un deposito — eventos que pueden hacer que un
// par previamente no-operativo pase a operativo.
//
// Diferencia clave con procesarEnviosBloqueadosPorDeposito: los envios en
// BLOQUEADO_OPERATIVIDAD YA tienen depositoId, courierId y origenId asignados
// (se crearon con deposito resuelto pero el par no era operativo). Por lo
// tanto NO se resuelve deposito ni se crea snapshot de origen.
//
// Por cada envio:
//   1. Re-valida operatividad con validarOperatividadPar().
//   2. Si sigue no-operativo → deja en BLOQUEADO_OPERATIVIDAD (siguenBloqueados).
//   3. Si operativo + saldo insuficiente → BLOQUEADO_SALDO.
//   4. Si operativo + dispatch OK → Pendiente (debit saldo, tramos, mail).
//   5. Si operativo + dispatch falla → BLOQUEADO_PARCIAL.
//
// @param depositoId - ID del deposito cuyos envios bloqueados se reprocesan.
// @param courierId  - Si se provee, filtra solo envios de ese courier.
//                     Si undefined, reprocesa todos los pares del deposito.
// =============================================================================

const MAX_INLINE = 50;

export interface ProcesarBloqueadosOperatividadResult {
  procesados: number;
  fallados: number;
  transicionadosASaldo: number;
  siguenBloqueados: number;
  restantes: number;
  totalBloqueados: number;
}

export async function procesarEnviosBloqueadosPorOperatividad(
  depositoId: number,
  courierId?: number
): Promise<ProcesarBloqueadosOperatividadResult> {
  const vacio: ProcesarBloqueadosOperatividadResult = {
    procesados: 0, fallados: 0, transicionadosASaldo: 0,
    siguenBloqueados: 0, restantes: 0, totalBloqueados: 0,
  };

  const deposito = await prisma.deposito.findUnique({
    where: { id: depositoId },
  });
  if (!deposito || deposito.eliminado || !deposito.activo) return vacio;

  const empresa = await prisma.empresa.findUnique({
    where: { id: deposito.empresaId },
  });
  if (!empresa) return vacio;

  const filtro: any = {
    depositoId,
    estadoActual: "BLOQUEADO_OPERATIVIDAD",
  };
  if (courierId !== undefined) filtro.courierId = courierId;

  const todosBloqueados = await prisma.envio.findMany({
    where: filtro,
    include: { courier: true, finanzas: true, destino: true },
    orderBy: { id: "asc" },
  });

  if (todosBloqueados.length === 0) return vacio;

  const aProcesar = todosBloqueados.slice(0, MAX_INLINE);

  let saldoSimulado = empresa.saldoActivo;
  const limite = empresa.limiteDescubierto;

  let procesados = 0;
  let fallados = 0;
  let transicionadosASaldo = 0;
  let siguenBloqueados = 0;

  for (const envio of aProcesar) {
    // --- 1. Re-validar operatividad del par ---
    const operatividad = await validarOperatividadPar({
      prisma,
      deposito,
      courier: envio.courier,
    });

    if (!operatividad.operativo) {
      siguenBloqueados++;
      continue;
    }

    // --- 2. Validaciones previas al despacho ---
    const credencial = await prisma.credencialCourier.findUnique({
      where: {
        empresaId_nombreCourier: {
          empresaId: deposito.empresaId,
          nombreCourier: envio.courier.nombre,
        },
      },
    });

    if (!credencial) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_OPERATIVIDAD",
          observacion: `Reintento post-configuración de par falló: credencial de ${envio.courier.nombre} no encontrada para esta empresa.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    if (!envio.destino) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_OPERATIVIDAD",
          observacion: `Reintento post-configuración de par falló: envío sin destino cargado.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    // --- 3. Validar saldo ---
    const monto = envio.finanzas?.precioFactura || 0;
    const tipoCuentaEfectivo = credencial.tipoCuenta || empresa.modalidadPago;
    const saldoDisponible = tipoCuentaEfectivo === "PREPAGO"
      ? saldoSimulado
      : saldoSimulado + limite;

    if (saldoDisponible < monto) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: { estadoActual: "BLOQUEADO_SALDO" },
          });
          await tx.eventoTracking.create({
            data: {
              estado: "BLOQUEADO_SALDO",
              observacion: `Par operativo pero saldo insuficiente. Costo $${monto.toFixed(2)}, disponible $${saldoDisponible.toFixed(2)} (${tipoCuentaEfectivo}). Se desbloqueará al recargar saldo.`,
              envioId: envio.id,
            },
          });
        });
        transicionadosASaldo++;
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorOperatividad] Transición a BLOQUEADO_SALDO falló para envío ${envio.id}:`, txErr);
        fallados++;
      }
      continue;
    }

    // --- 4. Despachar al courier ---
    // Cargar config del par para pasarla explicitamente a despacharCourier
    // (evita lookup redundante dentro de dispatch — leccion de 6.D.5).
    const configPar = await prisma.depositoCourierConfig.findUnique({
      where: {
        depositoId_courierId: {
          depositoId: envio.depositoId ?? depositoId,
          courierId: envio.courierId,
        },
      },
    });

    const dispatchResult = await despacharCourier({
      credencial,
      courierNombreCanonico: envio.courier.nombre,
      courierIdMain: envio.courierId,
      depositoId: envio.depositoId ?? undefined,
      deposito,
      config: configPar,
      tipoOrigen: envio.tipoOrigen === "drop_off_cliente" ? "drop_off_cliente" : "recoleccion_courier",
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
        calle: deposito.direccionCalle,
        altura: deposito.direccionAltura,
        cp: deposito.codigoPostal,
        localidad: deposito.localidad,
        provincia: deposito.provincia,
        pais: deposito.pais,
        telefono: deposito.contactoTelefono,
        email: deposito.contactoEmail || undefined,
      },
    });

    if (!dispatchResult.tracking) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: { estadoActual: "BLOQUEADO_PARCIAL" },
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
              observacion: `Reintento post-configuración de par falló: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos persistidos: ${dispatchResult.tramos.length}. El operador debe resolver la falla manualmente.`,
              envioId: envio.id,
            },
          });
        });
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorOperatividad] Falló transición a BLOQUEADO_PARCIAL para envío ${envio.id}:`, txErr);
      }
      fallados++;
      continue;
    }

    // --- 5. Dispatch exitoso → Pendiente ---
    const trackingReal = dispatchResult.tracking;
    const nuevoSaldo = saldoSimulado - monto;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.envio.update({
          where: { id: envio.id },
          data: {
            trackingNumber: trackingReal,
            etiquetaUrl: dispatchResult.etiquetaUrl,
            estadoActual: "Pendiente",
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

        await tx.movimientoFinanciero.create({
          data: {
            empresaId: deposito.empresaId,
            tipo: "DEBITO_ENVIO",
            monto: -monto,
            saldoPosterior: nuevoSaldo,
            referencia: trackingReal,
            descripcion: `Generación de etiqueta ${envio.courier.nombre.toUpperCase()} (desbloqueo post-configuración de par)`,
            envioId: envio.id,
          },
        });

        await tx.empresa.update({
          where: { id: deposito.empresaId },
          data: { saldoActivo: nuevoSaldo },
        });

        await tx.eventoTracking.create({
          data: {
            estado: "Pendiente",
            observacion: `Desbloqueado post-configuración de par (depósito × courier). Tracking real: ${trackingReal}.`,
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
          console.warn(`[procesarEnviosBloqueadosPorOperatividad] Fallo al mandar mail para ${trackingReal}:`, mailErr);
        }
      }

      procesados++;
    } catch (txErr: any) {
      console.error(`[procesarEnviosBloqueadosPorOperatividad] Falló transacción para envío ${envio.id}:`, txErr);
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_OPERATIVIDAD",
          observacion: `Tracking ${trackingReal} generado en courier pero falló persistencia: ${txErr?.message || "Error de BD"}. Revisar manualmente.`,
          envioId: envio.id,
        },
      });
      fallados++;
    }
  }

  const restantes = todosBloqueados.length - procesados - fallados - transicionadosASaldo - siguenBloqueados;
  return {
    procesados,
    fallados,
    transicionadosASaldo,
    siguenBloqueados,
    restantes,
    totalBloqueados: todosBloqueados.length,
  };
}
