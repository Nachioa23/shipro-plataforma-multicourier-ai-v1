// ============================================================================
// REINTENTO DE DESPACHO — reintentarUnEnvio(envioId) (Sub-fase 3 Pieza 2, 2026-09-11)
//
// Retries UN envío en BLOQUEADO_PARCIAL con causa transitoria. Es la unidad
// atómica de trabajo del cron futuro (Pieza 3) — este file NO tiene loop ni
// cron; solo la operación segura sobre un envío individual.
//
// CONCURRENCIA + MONEY — 3 garantías críticas:
//
//   (1) CLAIM ATÓMICO anti-doble-despacho: un solo `updateMany` con `where {
//       id, estadoActual: "BLOQUEADO_PARCIAL", retryCount < MAX }` a
//       `estadoActual: "REINTENTANDO"`. Postgres serializa el UPDATE →
//       solo un caller puede transicionar (count===1); los demás ven count===0
//       y abortan sin dispatch. Dos runs concurrentes NO pueden despachar
//       ambos el mismo envío. Read-then-write NO se usa (reintroduce race).
//
//   (2) DEBITO IDEMPOTENTE: al éxito del retry, se cobra el delta
//       `tarifaFullCotizada − debitoAplicadoEnvio` (helper P1 DEUDA 174).
//       Rama A + never labelled → yaAplicado=0 → cobra chain full. Rama B
//       + Fee ya cobrado (P2 DEUDA 174) → yaAplicado=Fee → delta=0 → skip.
//       Retry duplicado imposible por (1); si igual pasara → helper delta=0.
//
//   (3) REINTENTANDO TRANSIENT: nunca queda stuck. Cualquier path
//       (dispatch failure, exception, error de DB) revierte a
//       BLOQUEADO_PARCIAL para que un retry futuro pueda re-intentarlo (o
//       llegue al cap). ÚNICA excepción: si el dispatch al courier fue
//       exitoso (label real emitida) pero el commit falló por un race
//       (concurrent cancel raro), NO se revierte a BLOQUEADO_PARCIAL —
//       eso causaría doble despacho en el siguiente retry. Se deja
//       evidencia + un evento para que el operator resuelva manual.
//
// SCOPE PIEZA 2 — solo esta función:
//   - NO cron endpoint (Pieza 3).
//   - NO wiring en server (Pieza 4).
//   - NO idempotency courier-side external_reference (sub-pieza aparte).
//   - NO touch a débito paths (crear.ts/corregir.ts/cancelar.ts/handlers).
//   - Solo lecturas via helpers ya en prod (DEUDA 174 P1-P4).
//
// PRERREQUISITOS PARA DEPLOY:
//   - `estadoActual` es String libre (schema) → no requiere migración para
//     agregar "REINTENTANDO". Ya coordinado con Chat C (plugin WooCommerce
//     tiene rama REINTENTANDO en render_meta_box + procesar_respuesta_ok,
//     categoría ESPERA, mensaje "se está reprocesando solo, sin acción").
//   - `cancelar/route.ts` HOY no chequea "REINTENTANDO" (chequea CANCELADO).
//     Una cancelación durante la ventana de retry (~seg) puede pisar el
//     estado — mitigado por el commit post-dispatch con updateMany check
//     (si commit.count===0 → dispatch OK pero estado cambió → NO revert,
//     NO debit, ticket para operator). Cerrar completamente el race
//     requiere agregar guard en cancelar (post-Pieza 4).
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { despacharCourier } from "@/lib/envios/dispatch";
import { obtenerCredencialCourier } from "@/lib/couriers/normalizar";
import { debitoAplicadoEnvio } from "@/lib/finanzas/debito-aplicado";
import { MAX_REINTENTOS } from "@/lib/envios/reintentable";

/**
 * Resultado de un intento de reintentarUnEnvio. `claimed=false` significa
 * que otro proceso ya reclamó el envío (u no era elegible: no está en
 * BLOQUEADO_PARCIAL, o alcanzó el cap). `dispatched=false` con
 * `claimed=true` significa que reclamamos pero el dispatch falló → envío
 * revertido a BLOQUEADO_PARCIAL (o queda para review manual si el
 * dispatch fue OK pero el commit falló — ver `motivo`).
 */
export interface ReintentoResult {
  envioId: number;
  claimed: boolean;
  dispatched: boolean;
  trackingReal: string | null;
  debitAmount: string; // Decimal serializado
  motivo: string;
}

/**
 * Reintenta el despacho de UN envío en BLOQUEADO_PARCIAL con causa
 * transitoria. Concurrency-safe: dos invocaciones simultáneas producen
 * exactamente 1 dispatch (o 0 si ninguna gana el claim).
 *
 * @param envioId - id del envío a reintentar.
 * @returns detalle del resultado (claim, dispatch, monto debitado, tracking).
 */
export async function reintentarUnEnvio(envioId: number): Promise<ReintentoResult> {
  // === 1. CLAIM ATÓMICO ===
  // `updateMany` de Postgres serializa la escritura sobre el row. Solo un
  // proceso puede transicionar BLOQUEADO_PARCIAL → REINTENTANDO (count===1).
  // Los demás ven count===0 y abortan.
  const claim = await prisma.envio.updateMany({
    where: {
      id: envioId,
      estadoActual: "BLOQUEADO_PARCIAL",
      retryCount: { lt: MAX_REINTENTOS },
    },
    data: {
      estadoActual: "REINTENTANDO",
      retryCount: { increment: 1 },
      ultimoReintento: new Date(),
    },
  });

  if (claim.count !== 1) {
    return {
      envioId,
      claimed: false,
      dispatched: false,
      trackingReal: null,
      debitAmount: "0",
      motivo:
        "Claim no efectuado (otro proceso ya reclamó, o envío no está en BLOQUEADO_PARCIAL, o alcanzó el cap de retryCount).",
    };
  }

  // === 2. DISPATCH ===
  // A partir de acá SOMOS DUEÑOS del retry. Cualquier failure debe
  // revertir REINTENTANDO → BLOQUEADO_PARCIAL para no dejar el envío stuck.
  const envioIncludeArgs = {
    courier: true,
    destino: true,
    deposito: true,
    finanzas: true,
  } as const;
  type EnvioConIncludes = Prisma.EnvioGetPayload<{ include: typeof envioIncludeArgs }>;

  let dispatchResult: Awaited<ReturnType<typeof despacharCourier>>;
  let envio: EnvioConIncludes | null;

  try {
    envio = await prisma.envio.findUnique({
      where: { id: envioId },
      include: envioIncludeArgs,
    });

    if (!envio) {
      await revertirClaim(envioId, "Envío no encontrado durante reintento (concurrent delete?)");
      return {
        envioId,
        claimed: true,
        dispatched: false,
        trackingReal: null,
        debitAmount: "0",
        motivo: "Envío no encontrado; revertido a BLOQUEADO_PARCIAL.",
      };
    }
    if (!envio.destino) {
      await revertirClaim(envioId, "Envío sin destino cargado");
      return {
        envioId,
        claimed: true,
        dispatched: false,
        trackingReal: null,
        debitAmount: "0",
        motivo: "Envío sin destino; revertido a BLOQUEADO_PARCIAL.",
      };
    }

    const credencial = await obtenerCredencialCourier(envio.empresaId, envio.courier.nombre);
    if (!credencial || !credencial.activo) {
      await revertirClaim(envioId, "Credencial no encontrada o inactiva");
      return {
        envioId,
        claimed: true,
        dispatched: false,
        trackingReal: null,
        debitAmount: "0",
        motivo: "Credencial no encontrada o inactiva; revertido a BLOQUEADO_PARCIAL.",
      };
    }

    dispatchResult = await despacharCourier({
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
      largoCm: envio.largoCm,
      anchoCm: envio.anchoCm,
      altoCm: envio.altoCm,
      valorDeclarado: envio.finanzas?.valorDeclarado?.toNumber() ?? 0,
      modalidad: envio.modalidad,
      numeroOrden: envio.numeroOrden,
      origen: envio.deposito
        ? {
            calle: envio.deposito.direccionCalle,
            altura: envio.deposito.direccionAltura,
            cp: envio.deposito.codigoPostal,
            localidad: envio.deposito.localidad,
            provincia: envio.deposito.provincia,
            pais: envio.deposito.pais,
            telefono: envio.deposito.contactoTelefono,
            email: envio.deposito.contactoEmail || undefined,
          }
        : undefined,
    });
  } catch (err: any) {
    // Exception en la carga o durante dispatch (antes de que el courier
    // devuelva). Revertir a BLOQUEADO_PARCIAL — sin label courier emitida.
    await revertirClaim(envioId, `Excepción durante reintento: ${err?.message || "unknown"}`);
    return {
      envioId,
      claimed: true,
      dispatched: false,
      trackingReal: null,
      debitAmount: "0",
      motivo: `Excepción antes/durante dispatch: ${err?.message || "unknown"}. Revertido a BLOQUEADO_PARCIAL.`,
    };
  }

  // Dispatch fue null → courier no emitió label. Revertir.
  if (!dispatchResult.tracking) {
    await revertirClaim(
      envioId,
      `Reintento falló: ${dispatchResult.error || "courier no devolvió tracking"}. Tramos persistidos: ${dispatchResult.tramos.length}.`,
    );
    // Persistir tramos huérfanos si los hay (caso C parcial que ahora volvió a fallar).
    // Se hace FUERA de la tx de revertirClaim para no acoplar; si esto falla, el estado
    // ya está en BLOQUEADO_PARCIAL, revisable por operator.
    if (dispatchResult.tramos.length > 0) {
      try {
        await prisma.tramoEnvio.createMany({
          data: dispatchResult.tramos.map((t) => ({
            envioId,
            orden: t.orden,
            courierId: t.courierId,
            tipo: t.tipo,
            trackingExterno: t.trackingExterno,
            sucursalOrigenId: t.sucursalOrigenId ?? null,
            sucursalDestinoId: t.sucursalDestinoId ?? null,
          })),
        });
      } catch (e) {
        console.warn(`[reintentarUnEnvio] no se persistieron tramos huérfanos para envío ${envioId}:`, e);
      }
    }
    return {
      envioId,
      claimed: true,
      dispatched: false,
      trackingReal: null,
      debitAmount: "0",
      motivo: `Retry dispatch falló: ${dispatchResult.error || "sin tracking"}. Revertido a BLOQUEADO_PARCIAL.`,
    };
  }

  // === 3. DISPATCH EXITOSO — courier tiene label real emitida ===
  //
  // De acá en adelante NO revertimos a BLOQUEADO_PARCIAL bajo ninguna
  // condición: revertir causaría doble dispatch en el próximo retry
  // (el courier ya tiene un tracking real que Shipro perdería visibility de).
  //
  // Commit ATÓMICO: `updateMany where estadoActual === "REINTENTANDO"` a
  // "Pendiente" + trackingNumber + etiquetaUrl. Si count===0 el estado fue
  // cambiado (concurrent cancel raro) — auto-ticket y salir sin debit.
  const trackingReal = dispatchResult.tracking;
  const etiquetaUrl = dispatchResult.etiquetaUrl;
  const target: Prisma.Decimal = envio.finanzas?.tarifaFullCotizada ?? new Prisma.Decimal(0);
  const courierNombre = envio.courier.nombre;
  const empresaId = envio.empresaId;
  let debitAmount: Prisma.Decimal = new Prisma.Decimal(0);
  let commitOk = false;

  try {
    await prisma.$transaction(async (tx) => {
      const commit = await tx.envio.updateMany({
        where: { id: envioId, estadoActual: "REINTENTANDO" },
        data: {
          trackingNumber: trackingReal,
          etiquetaUrl,
          estadoActual: "Pendiente",
        },
      });
      if (commit.count !== 1) {
        // Estado ya no es REINTENTANDO — algo lo cambió (concurrent cancel raro).
        // Aborta la tx sin debit ni estado update.
        throw new Error("STATE_CHANGED_MID_RETRY");
      }

      // Persistir tramos nuevos del despacho exitoso.
      if (dispatchResult.tramos.length > 0) {
        await tx.tramoEnvio.createMany({
          data: dispatchResult.tramos.map((t) => ({
            envioId,
            orden: t.orden,
            courierId: t.courierId,
            tipo: t.tipo,
            trackingExterno: t.trackingExterno,
            sucursalOrigenId: t.sucursalOrigenId ?? null,
            sucursalDestinoId: t.sucursalDestinoId ?? null,
          })),
        });
      }

      // DEBITO idempotente via helper P1 DEUDA 174. Rama A never-labelled →
      // yaAplicado=0 → cobra chain. Rama B (Fee ya cobrado P2) → delta=0.
      const yaAplicado = await debitoAplicadoEnvio(envioId, tx);
      const delta = target.sub(yaAplicado);
      if (delta.gt(0)) {
        const empresaActual = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: { saldoActivo: true },
        });
        const saldoActual = empresaActual?.saldoActivo ?? new Prisma.Decimal(0);
        const nuevoSaldo = saldoActual.sub(delta);
        await tx.movimientoFinanciero.create({
          data: {
            empresaId,
            tipo: "DEBITO_ENVIO",
            monto: delta.neg(),
            saldoPosterior: nuevoSaldo,
            referencia: trackingReal,
            descripcion: `Reintento exitoso — ${courierNombre} (dispatch post-BLOQUEADO_PARCIAL)`,
            envioId,
          },
        });
        await tx.empresa.update({
          where: { id: empresaId },
          data: { saldoActivo: nuevoSaldo },
        });
        debitAmount = delta;
      }

      await tx.eventoTracking.create({
        data: {
          envioId,
          estado: "Pendiente",
          observacion: `Reintento exitoso post-BLOQUEADO_PARCIAL. Tracking real: ${trackingReal}.`,
        },
      });
    });
    commitOk = true;
  } catch (commitErr: any) {
    // Dispatch exitoso pero commit falló. Courier tiene label real.
    // NO revertir a BLOQUEADO_PARCIAL (evitaría doble dispatch en el siguiente retry).
    // NO debitar. Log evento como advertencia crítica para que operator resuelva.
    const causa = commitErr?.message || "unknown";
    console.error(
      `[reintentarUnEnvio] CRÍTICO: dispatch OK para envío ${envioId} (tracking=${trackingReal}) pero commit falló: ${causa}. Estado NO se revierte (evita doble dispatch). Manual review requerida.`,
    );
    try {
      await prisma.eventoTracking.create({
        data: {
          envioId,
          estado: "REINTENTANDO",
          observacion: `[CRÍTICO reintento] Dispatch al courier OK (tracking=${trackingReal}) pero commit del estado falló (${causa}). El envío NO se revirtió a BLOQUEADO_PARCIAL para evitar doble dispatch. El operator debe: (a) verificar el estado real del envío en el courier, (b) actualizar manualmente estadoActual y trackingNumber, (c) revisar si corresponde debitar.`,
        },
      });
    } catch (evErr) {
      console.error(`[reintentarUnEnvio] no se pudo persistir evento crítico para envío ${envioId}:`, evErr);
    }
    return {
      envioId,
      claimed: true,
      dispatched: true,
      trackingReal,
      debitAmount: "0",
      motivo: `[CRÍTICO] Dispatch OK pero commit falló (${causa}). Requiere revisión manual del operator.`,
    };
  }

  return {
    envioId,
    claimed: true,
    dispatched: true,
    trackingReal,
    debitAmount: debitAmount.toString(),
    motivo: commitOk
      ? `Reintento exitoso. Tracking ${trackingReal}. Debit delta: ${debitAmount.toString()}.`
      : "Reintento con commit anómalo.",
  };
}

/**
 * Revierte un claim previo (estado REINTENTANDO → BLOQUEADO_PARCIAL) + persiste
 * un `EventoTracking` con el motivo. Se usa SOLO cuando no hubo dispatch exitoso
 * al courier — jamás cuando el courier ya emitió una label real.
 *
 * Usa `updateMany where estadoActual="REINTENTANDO"` para no pisar otro estado
 * (ej. CANCELADO por race extrema). Si count===0 el estado ya cambió y no
 * hacemos nada — la información se preserva en el evento.
 */
async function revertirClaim(envioId: number, motivo: string): Promise<void> {
  try {
    await prisma.envio.updateMany({
      where: { id: envioId, estadoActual: "REINTENTANDO" },
      data: { estadoActual: "BLOQUEADO_PARCIAL" },
    });
    await prisma.eventoTracking.create({
      data: {
        envioId,
        estado: "BLOQUEADO_PARCIAL",
        observacion: `Reintento falló: ${motivo}. Se revirtió a BLOQUEADO_PARCIAL; próximo retry podrá reintentar si el cap no está alcanzado.`,
      },
    });
  } catch (err) {
    console.error(`[reintentarUnEnvio] revertirClaim falló para envío ${envioId}:`, err);
  }
}
