import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { despacharCourier } from "@/lib/envios/dispatch";
import { enviarMailCreacion } from "@/lib/mailer";
import { getAppUrl } from "@/lib/utils/app-url";

// =============================================================================
// FASE 2 pieza 1, sub 3 (2026-07-30): Destrabe automático de envíos en
// BLOQUEADO_CREDENCIAL.
// =============================================================================
//
// Procesa envíos en estado BLOQUEADO_CREDENCIAL para una empresa dada, FIFO
// por id, max MAX_INLINE por llamada.
//
// Se dispara cuando la empresa (via admin_shipro) configura el dueño de una
// credencial en /configuracion/transportes — evento que puede hacer que una
// credencial previamente sin-dueño (Rama A && !propietarioTipo) pase a tener
// dueño y por lo tanto sea despachable.
//
// Molde: procesar-bloqueados-operatividad.ts. Diferencia clave: la re-check
// primaria no es `validarOperatividadPar` sino la lectura del propio row de
// CredencialCourier — si sigue siendo Rama A sin dueño, el envío queda
// siguenBloqueados; si tiene dueño, se procede al despacho normal.
//
// Por cada envío:
//   1. Re-carga la credencial. Si sigue Rama A && !propietarioTipo →
//      siguenBloqueados++ (no cambia estado).
//   2. Validaciones previas (credencial existe, destino existe).
//   3. Si operativo + saldo insuficiente → BLOQUEADO_SALDO (sub-transición).
//   4. Si operativo + saldo OK + dispatch OK → Pendiente (debit + tramos + mail).
//   5. Si operativo + dispatch falla → BLOQUEADO_PARCIAL.
//
// @param empresaId - ID de la empresa cuyos envíos bloqueados se reprocesan.
// =============================================================================

const MAX_INLINE = 50;

export interface ProcesarBloqueadosCredencialResult {
  procesados: number;
  fallados: number;
  transicionadosASaldo: number;
  siguenBloqueados: number;
  restantes: number;
  totalBloqueados: number;
}

export async function procesarEnviosBloqueadosPorCredencial(
  empresaId: number
): Promise<ProcesarBloqueadosCredencialResult> {
  const vacio: ProcesarBloqueadosCredencialResult = {
    procesados: 0, fallados: 0, transicionadosASaldo: 0,
    siguenBloqueados: 0, restantes: 0, totalBloqueados: 0,
  };

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
  });
  if (!empresa) return vacio;

  const todosBloqueados = await prisma.envio.findMany({
    where: { empresaId, estadoActual: "BLOQUEADO_CREDENCIAL" },
    include: {
      courier: true,
      finanzas: true,
      destino: true,
      deposito: true,
    },
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
    // --- 1. Re-cargar credencial + re-check de propiedad (mirror del
    //        validarOperatividadPar del operatividad retry) ---
    const credencial = await prisma.credencialCourier.findUnique({
      where: {
        empresaId_nombreCourier: {
          empresaId,
          nombreCourier: envio.courier.nombre,
        },
      },
    });

    if (!credencial) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_CREDENCIAL",
          observacion: `Reintento post-configuración de dueño falló: credencial de ${envio.courier.nombre} no encontrada para esta empresa.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    // Bloqueo primario: Rama A sin dueño configurado sigue vigente.
    if (credencial.usaCredencialesPropias === false && !credencial.propietarioTipo) {
      siguenBloqueados++;
      continue;
    }

    // --- 2. Validaciones pre-despacho ---
    if (!envio.destino) {
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_CREDENCIAL",
          observacion: `Reintento post-configuración de dueño falló: envío sin destino cargado.`,
          envioId: envio.id,
        },
      });
      fallados++;
      continue;
    }

    // --- 3. Validar saldo (mirror de operatividad L150-178) ---
    const monto: Prisma.Decimal = envio.finanzas?.tarifaFullCotizada ?? new Prisma.Decimal(0);
    const tipoCuentaEfectivo = credencial.tipoCuenta || empresa.modalidadPago;
    const saldoDisponible = tipoCuentaEfectivo === "PREPAGO"
      ? saldoSimulado
      : saldoSimulado.add(limite);

    if (saldoDisponible.lt(monto)) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.envio.update({
            where: { id: envio.id },
            data: { estadoActual: "BLOQUEADO_SALDO" },
          });
          await tx.eventoTracking.create({
            data: {
              estado: "BLOQUEADO_SALDO",
              observacion: `Credencial con dueño configurado, pero saldo insuficiente. Costo $${monto.toFixed(2)}, disponible $${saldoDisponible.toFixed(2)} (${tipoCuentaEfectivo}). Se desbloqueará al recargar saldo.`,
              envioId: envio.id,
            },
          });
        });
        transicionadosASaldo++;
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorCredencial] Transición a BLOQUEADO_SALDO falló para envío ${envio.id}:`, txErr);
        fallados++;
      }
      continue;
    }

    // --- 4. Despachar al courier ---
    // Los envíos en BLOQUEADO_CREDENCIAL YA tienen depositoId + origenId
    // asignados al crear (paralelismo con BLOQUEADO_OPERATIVIDAD). Se pasa
    // el depósito completo al dispatch para no re-consultar.
    const dispatchResult = await despacharCourier({
      credencial,
      courierNombreCanonico: envio.courier.nombre,
      courierIdMain: envio.courierId,
      depositoId: envio.depositoId ?? undefined,
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
      // DEUDA 132 Paso 2: dims persistidas al crear (Paso 1) llegan al re-despacho.
      largoCm: envio.largoCm,
      anchoCm: envio.anchoCm,
      altoCm: envio.altoCm,
      valorDeclarado: envio.finanzas?.valorDeclarado?.toNumber() ?? 0,
      modalidad: envio.modalidad,
      numeroOrden: envio.numeroOrden,
      origen: envio.deposito ? {
        calle: envio.deposito.direccionCalle,
        altura: envio.deposito.direccionAltura,
        cp: envio.deposito.codigoPostal,
        localidad: envio.deposito.localidad,
        provincia: envio.deposito.provincia,
        pais: envio.deposito.pais,
        telefono: envio.deposito.contactoTelefono,
        email: envio.deposito.contactoEmail || undefined,
      } : undefined,
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
              observacion: `Reintento post-configuración de dueño falló: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos persistidos: ${dispatchResult.tramos.length}. El operador debe resolver la falla manualmente.`,
              envioId: envio.id,
            },
          });
        });
      } catch (txErr: any) {
        console.error(`[procesarEnviosBloqueadosPorCredencial] Falló transición a BLOQUEADO_PARCIAL para envío ${envio.id}:`, txErr);
      }
      fallados++;
      continue;
    }

    // --- 5. Dispatch exitoso → Pendiente ---
    const trackingReal = dispatchResult.tracking;
    const nuevoSaldo = saldoSimulado.sub(monto);

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
            empresaId,
            tipo: "DEBITO_ENVIO",
            monto: monto.neg(),
            saldoPosterior: nuevoSaldo,
            referencia: trackingReal,
            descripcion: `Generación de etiqueta ${envio.courier.nombre.toUpperCase()} (desbloqueo post-configuración de dueño)`,
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
            observacion: `Desbloqueado post-configuración del dueño de la credencial. Tracking real: ${trackingReal}.`,
            envioId: envio.id,
          },
        });
      });

      saldoSimulado = nuevoSaldo;

      if (envio.destino.email) {
        // DEUDA 14: skip mail si APP_URL no está configurada (warn loggeado en helper).
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
            console.warn(`[procesarEnviosBloqueadosPorCredencial] Fallo al mandar mail para ${trackingReal}:`, mailErr);
          }
        }
      }

      procesados++;
    } catch (txErr: any) {
      console.error(`[procesarEnviosBloqueadosPorCredencial] Falló transacción para envío ${envio.id}:`, txErr);
      // El courier ya generó tracking real pero la BD no se actualizó. Riesgo
      // de tracking huérfano en el sistema del courier. Logueamos y seguimos.
      await prisma.eventoTracking.create({
        data: {
          estado: "BLOQUEADO_CREDENCIAL",
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
