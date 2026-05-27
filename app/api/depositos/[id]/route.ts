import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validarDepositoInput, validarPuedeEliminarOInactivar, validarHayOtroPredeterminado } from "@/lib/depositos/validar";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { procesarEnviosBloqueadosPorDeposito } from "@/lib/envios/procesar-bloqueados-deposito";
import { procesarEnviosBloqueadosPorOperatividad } from "@/lib/envios/procesar-bloqueados-operatividad";
import { geocodificarDireccion } from "@/lib/geo/geocodificar-direccion";

// ==========================================
// GET /api/depositos/[id]
// Detalle de un depósito.
// ==========================================
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  return NextResponse.json(acceso.deposito);
}

// ==========================================
// PUT /api/depositos/[id]
// Actualiza un depósito.
// - Si esPredeterminado pasa a true: desmarcar otros (transacción).
// - Si esPredeterminado pasa de true a false: bloquear si no hay otro predeterminado.
// - Si activo pasa a false y es predeterminado: bloquear.
// ==========================================
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  const body = await request.json();

  const errorValidacion = validarDepositoInput(body);
  if (errorValidacion) return NextResponse.json({ error: errorValidacion }, { status: 400 });

  // === DEUDA 29 Sub-fase 6.D.7: flag dry-run ===
  // Si ?dryRun=true, el handler computa la cascada del consolidador
  // pero NO escribe en BD: devuelve el preview para el modal de
  // confirmacion del frontend. El body es el mismo que el del PUT real.
  const esDryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  const previo = acceso.deposito;
  const nuevoEsPredeterminado = body.esPredeterminado === true;
  const nuevoActivo = body.activo !== false;

  // Reglas D7
  if (previo.esPredeterminado && !nuevoEsPredeterminado) {
    const error = await validarHayOtroPredeterminado(previo.empresaId, depositoId);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }
  if (previo.esPredeterminado && !nuevoActivo) {
    return NextResponse.json({ error: 'No se puede inactivar el depósito predeterminado. Marcá otro como predeterminado primero.' }, { status: 400 });
  }
  // Si esPredeterminado=true entonces activo=true (consistencia)
  if (nuevoEsPredeterminado && !nuevoActivo) {
    return NextResponse.json({ error: 'Un depósito predeterminado no puede estar inactivo.' }, { status: 400 });
  }

  // ==========================================
  // DEUDA 29 Sub-fase 6.D rectificación (2026-05-19): manejo opcional de
  // courierRecolectorId con cascada inteligente.
  //
  // Si el body trae el campo, validar y permitir asignar/quitar el consolidador.
  // Si no viene, no se toca (comportamiento idéntico al anterior).
  //
  // Casos:
  //  - CASO 1 (set null cuando previo no era null): cascada de reset
  //    recogeViaConsolidador=false en todas las configs del depósito.
  //  - CASO 2a (set X cuando previo era null): solo REPORTAR elegibilidad,
  //    NO auto-setear recogeViaConsolidador.
  //  - CASO 2b (set Y cuando previo era X≠Y): resetear configs con
  //    recogeViaConsolidador=true cuyo courier no cubre cpDepositoConsolidador
  //    de Y. Reportar reset + preservado + elegibles para el nuevo recolector.
  //  - No-op (set X igual al previo): validar y seguir, sin cascada.
  //
  // Validación de cobertura del consolidador (best-effort MVP):
  //  El consolidador X debe cubrir el CP del depósito. Si X no tiene filas
  //  en SucursalCourierCp (caso Mocis), SKIP — se reportará en skipsDeValidacion
  //  y se cerrará vía DEUDA 32 post-MVP (sync de cobertura en background).
  // ==========================================
  let courierRecolectorIdNuevo: number | null | undefined = undefined;
  let cambiosCascada:
    | {
        motivo: "consolidador_removido" | "consolidador_asignado" | "consolidador_cambiado";
        recogeViaConsolidadorReset: { courierId: number; courierNombre: string }[];
        recogeViaConsolidadorPreservado: { courierId: number; courierNombre: string }[];
        eligiblesParaActivar: { courierId: number; courierNombre: string }[];
        skipsDeValidacion: string[];
      }
    | undefined = undefined;
  let idsConfigsAResetear: number[] = [];

  if ("courierRecolectorId" in body) {
    const valor = (body as { courierRecolectorId: unknown }).courierRecolectorId;

    if (valor === null) {
      courierRecolectorIdNuevo = null;
    } else if (typeof valor === "number" && Number.isInteger(valor)) {
      // Validar courier existe + activo
      const courierConsolidador = await prisma.courier.findFirst({
        where: { id: valor, activo: true },
      });
      if (!courierConsolidador) {
        return NextResponse.json(
          { error: "Courier recolector no encontrado o inactivo" },
          { status: 404 }
        );
      }
      if (!courierConsolidador.puedeConsolidar) {
        return NextResponse.json(
          {
            error: `El courier '${courierConsolidador.nombre}' no tiene capacidad de consolidación (puedeConsolidar=false)`,
          },
          { status: 400 }
        );
      }
      if (!courierConsolidador.cpDepositoConsolidador) {
        return NextResponse.json(
          {
            error: `El courier '${courierConsolidador.nombre}' no tiene cpDepositoConsolidador configurado, no puede ser asignado como recolector`,
          },
          { status: 400 }
        );
      }

      // Validación de cobertura del CP del depósito por el consolidador (best-effort)
      const skipsDeValidacion: string[] = [];
      const consolidadorTieneCobertura = await prisma.sucursalCourierCp.findFirst({
        where: { sucursal: { courierId: valor, activa: true, eliminada: false } },
        select: { id: true },
      });
      if (consolidadorTieneCobertura) {
        const cubreCpDeposito = await prisma.sucursalCourierCp.findFirst({
          where: {
            codigoPostal: previo.codigoPostal,
            sucursal: { courierId: valor, activa: true, eliminada: false },
          },
          select: { id: true },
        });
        if (!cubreCpDeposito) {
          return NextResponse.json(
            {
              error: `El courier '${courierConsolidador.nombre}' no cubre el CP del depósito (${previo.codigoPostal}). No puede ser asignado como recolector.`,
            },
            { status: 400 }
          );
        }
      } else {
        skipsDeValidacion.push(
          `Cobertura del consolidador '${courierConsolidador.nombre}' no validada (sin filas en SucursalCourierCp; resolverá DEUDA 32 post-MVP).`
        );
      }

      courierRecolectorIdNuevo = valor;

      // Cómputo de cascada (skip si es no-op: previo === nuevo)
      const cambioReal = previo.courierRecolectorId !== valor;
      if (cambioReal) {
        const motivo: "consolidador_asignado" | "consolidador_cambiado" =
          previo.courierRecolectorId === null ? "consolidador_asignado" : "consolidador_cambiado";

        const configsDelDeposito = await prisma.depositoCourierConfig.findMany({
          where: { depositoId },
          include: { courier: { select: { id: true, nombre: true } } },
        });

        const eligiblesParaActivar: { courierId: number; courierNombre: string }[] = [];
        const resetReport: { courierId: number; courierNombre: string }[] = [];
        const preservadoReport: { courierId: number; courierNombre: string }[] = [];
        const cpConsolidadorNuevo = courierConsolidador.cpDepositoConsolidador;

        for (const cfg of configsDelDeposito) {
          if (cfg.courierId === valor) continue; // el propio recolector se omite

          // ¿El courier de la config cubre cpDepositoConsolidador del nuevo recolector?
          const match = await prisma.sucursalCourierCp.findFirst({
            where: {
              codigoPostal: cpConsolidadorNuevo,
              sucursal: { courierId: cfg.courierId, activa: true, eliminada: false },
            },
            select: { id: true },
          });
          const cubreCpConsolidador = !!match;

          if (cubreCpConsolidador) {
            eligiblesParaActivar.push({ courierId: cfg.courierId, courierNombre: cfg.courier.nombre });
          }

          // CASO 2b: si la config ya tenía recogeViaConsolidador=true...
          if (motivo === "consolidador_cambiado" && cfg.recogeViaConsolidador) {
            if (cubreCpConsolidador) {
              // Mantener: el courier sigue cubriendo el nuevo CP consolidador.
              preservadoReport.push({ courierId: cfg.courierId, courierNombre: cfg.courier.nombre });
            } else {
              // Resetear: ya no cubre, recogeViaConsolidador queda obsoleto.
              idsConfigsAResetear.push(cfg.id);
              resetReport.push({ courierId: cfg.courierId, courierNombre: cfg.courier.nombre });
            }
          }
        }

        cambiosCascada = {
          motivo,
          recogeViaConsolidadorReset: resetReport,
          recogeViaConsolidadorPreservado: preservadoReport,
          eligiblesParaActivar,
          skipsDeValidacion,
        };
      }
    } else {
      return NextResponse.json(
        { error: "courierRecolectorId debe ser null o un número entero" },
        { status: 400 }
      );
    }

    // CASO 1: set null + previo no era null → resetear configs con recogeViaConsolidador=true
    if (courierRecolectorIdNuevo === null && previo.courierRecolectorId !== null) {
      const configsConRecoge = await prisma.depositoCourierConfig.findMany({
        where: { depositoId, recogeViaConsolidador: true },
        include: { courier: { select: { id: true, nombre: true } } },
      });
      cambiosCascada = {
        motivo: "consolidador_removido",
        recogeViaConsolidadorReset: configsConRecoge.map((c) => ({
          courierId: c.courierId,
          courierNombre: c.courier.nombre,
        })),
        recogeViaConsolidadorPreservado: [],
        eligiblesParaActivar: [],
        skipsDeValidacion: [],
      };
      idsConfigsAResetear = configsConRecoge.map((c) => c.id);
    }
  }

  // === DEUDA 29 Sub-fase 6.D.7: modo dry-run ===
  // Si ?dryRun=true, la cascada ya fue computada arriba (cambiosCascada)
  // y NO se escribe nada en BD. Devuelve el preview para que el modal de
  // confirmacion del frontend lo muestre antes de aplicar el cambio real.
  // El PUT real (sin el flag) ejecuta la transaccion normalmente.
  if (esDryRun) {
    return NextResponse.json({
      dryRun: true,
      cambiosCascada: cambiosCascada ?? null,
    });
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    if (nuevoEsPredeterminado && !previo.esPredeterminado) {
      await tx.deposito.updateMany({
        where: { empresaId: previo.empresaId, esPredeterminado: true, NOT: { id: depositoId } },
        data: { esPredeterminado: false },
      });
    }
    // CAMBIO 6.D rectificación (2026-05-19): si hubo cascada de reset
    // (CASO 1 o CASO 2b), aplicarla DENTRO de la misma transacción para
    // que el cambio del consolidador y el reset de configs sean atómicos.
    if (idsConfigsAResetear.length > 0) {
      await tx.depositoCourierConfig.updateMany({
        where: { id: { in: idsConfigsAResetear } },
        data: { recogeViaConsolidador: false },
      });
    }

    return tx.deposito.update({
      where: { id: depositoId },
      data: {
        nombre: String(body.nombre).trim(),
        esPredeterminado: nuevoEsPredeterminado,
        activo: nuevoActivo,
        contactoNombre: String(body.contactoNombre).trim(),
        contactoTelefono: String(body.contactoTelefono).trim(),
        contactoEmail: body.contactoEmail ? String(body.contactoEmail).trim() : null,
        direccionCalle: String(body.direccionCalle).trim(),
        direccionAltura: String(body.direccionAltura).trim(),
        direccionPiso: body.direccionPiso ? String(body.direccionPiso).trim() : null,
        direccionDpto: body.direccionDpto ? String(body.direccionDpto).trim() : null,
        codigoPostal: String(body.codigoPostal).trim(),
        localidad: String(body.localidad).trim(),
        provincia: String(body.provincia).trim(),
        pais: body.pais ? String(body.pais).trim() : "Argentina",
        horarios: String(body.horarios),
        observaciones: body.observaciones ? String(body.observaciones).trim() : null,
        ...(courierRecolectorIdNuevo !== undefined
          ? { courierRecolectorId: courierRecolectorIdNuevo }
          : {}),
      },
    });
  });

  // DEUDA 29 Sub-fase 2.B.0: re-geocodificar solo si cambió alguno de los 5
  // campos de dirección. Política híbrida ante fallo:
  //   - Sin cambio → no tocar coords ni timestamp.
  //   - Cambio + Google OK → actualizar coords + timestamp.
  //   - Cambio + Google FALLA → mantener coords viejas (stale, mejor para
  //     Haversine que null) pero setear ultimaGeocodificacion=null como señal
  //     de desactualización. Queries futuras pueden detectar
  //     (latitud IS NOT NULL AND ultimaGeocodificacion IS NULL) para
  //     re-geocodificar o flagear "coordsActualizadas: false" en la UI.
  const direccionCambio =
    previo.direccionCalle !== actualizado.direccionCalle ||
    previo.direccionAltura !== actualizado.direccionAltura ||
    previo.codigoPostal !== actualizado.codigoPostal ||
    previo.localidad !== actualizado.localidad ||
    previo.provincia !== actualizado.provincia;

  let depositoConCoords = actualizado;
  if (direccionCambio) {
    const coords = await geocodificarDireccion({
      direccionCalle: actualizado.direccionCalle,
      direccionAltura: actualizado.direccionAltura,
      codigoPostal: actualizado.codigoPostal,
      localidad: actualizado.localidad,
      provincia: actualizado.provincia,
      pais: actualizado.pais,
    });
    if (coords) {
      depositoConCoords = await prisma.deposito.update({
        where: { id: depositoId },
        data: {
          latitud: coords.latitud,
          longitud: coords.longitud,
          ultimaGeocodificacion: new Date(),
        },
      });
    } else {
      console.warn(`[depositos] WARN: PUT id=${depositoId} (${actualizado.nombre}) — geocoding falló, coords stale (ultimaGeocodificacion=null como señal).`);
      depositoConCoords = await prisma.deposito.update({
        where: { id: depositoId },
        data: { ultimaGeocodificacion: null },
      });
    }
  }

  // DEUDA 4: si este update pasó a predeterminado (transición false → true),
  // disparar destrabado de envíos en BLOQUEADO_DEPOSITO.
  let recovery;
  if (!previo.esPredeterminado && nuevoEsPredeterminado) {
    recovery = await procesarEnviosBloqueadosPorDeposito(previo.empresaId);
  }

  // === DEUDA 34: destrabe automatico post-cambio de courierRecolectorId ===
  // Cambiar el courier recolector puede resolver el motivo
  // consolidador_inconsistente en varios pares del deposito a la vez.
  // Por eso se llama SIN courierId: barre todos los pares del deposito.
  // Solo dispara si el courierRecolectorId efectivamente cambio.
  let recoveryOperatividad;
  if (
    courierRecolectorIdNuevo !== undefined &&
    courierRecolectorIdNuevo !== previo.courierRecolectorId
  ) {
    try {
      recoveryOperatividad = await procesarEnviosBloqueadosPorOperatividad(depositoId);
    } catch (recErr) {
      console.error("[depositos PUT] procesarEnviosBloqueadosPorOperatividad fallo:", recErr);
    }
  }

  return NextResponse.json({
    ...depositoConCoords,
    ...(recovery ? { recovery } : {}),
    ...(recoveryOperatividad ? { recoveryOperatividad } : {}),
    ...(cambiosCascada ? { cambiosCascada } : {}),
  });
}

// ==========================================
// DELETE /api/depositos/[id]
// Soft delete: UPDATE eliminado=true, activo=false, esPredeterminado=false.
// La FK Envio.depositoId tiene ON DELETE RESTRICT como defense-in-depth.
// ==========================================
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  const error = await validarPuedeEliminarOInactivar(acceso.deposito.empresaId, depositoId);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const actualizado = await prisma.deposito.update({
    where: { id: depositoId },
    data: { eliminado: true, activo: false, esPredeterminado: false },
  });

  return NextResponse.json({ success: true, deposito: actualizado });
}
