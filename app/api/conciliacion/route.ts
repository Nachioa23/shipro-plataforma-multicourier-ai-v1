import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, EstadoLiquidacion } from "@prisma/client";
import { aplicarMarkup, type ConfigMarkup } from "@/lib/cotizador";
import { calcularFeeOperacion } from "@/lib/utils/operacion-fee";

// STEP 1 (dos-vías-liquidación): validador del período de la factura del courier.
// Formato requerido YYYY-MM (ej. "2026-04"). Es el mes al que corresponde la
// factura del courier (no la fecha de importación). Se persiste en
// FinanzasEnvio.periodoLogistica para agrupar la proforma LOGISTICA por mes.
const PERIODO_FACTURA_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function POST(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { filasExcel, referenciaFactura, ivaDeclarado, periodoFacturaCourier } = await request.json();

    if (!filasExcel || !Array.isArray(filasExcel) || !referenciaFactura) {
      return NextResponse.json({ error: "Faltan datos o no se indicó el Número de Factura del Courier." }, { status: 400 });
    }

    // Nacho: la convención IVA del Excel del courier NO se asume. La declara el
    // usuario al subir el archivo (la factura del courier suele traer ambas
    // columnas; si uno se equivoca de columna, sin declaración explícita el
    // desvío sale 21% errado y pasa silenciosamente). No hay default.
    if (ivaDeclarado !== "SIN_IVA" && ivaDeclarado !== "CON_IVA") {
      return NextResponse.json(
        { error: "Falta o es inválido 'ivaDeclarado'. Requerido: 'SIN_IVA' o 'CON_IVA'. La convención IVA del Excel debe declararse explícitamente al subir el archivo." },
        { status: 400 }
      );
    }
    const tarifaExcelIncluyeIva = ivaDeclarado === "CON_IVA";

    // STEP 1: período de la factura del courier (YYYY-MM). Mismo patrón que
    // ivaDeclarado — obligatorio, sin default. Es el mes al que corresponde la
    // factura (marzo puede llegar el 3 de abril; el período es "2026-03").
    // Se persiste en FinanzasEnvio.periodoLogistica para agrupar la proforma
    // LOGISTICA por período correcto.
    if (typeof periodoFacturaCourier !== "string" || !PERIODO_FACTURA_REGEX.test(periodoFacturaCourier)) {
      return NextResponse.json(
        { error: "Falta o es inválido 'periodoFacturaCourier'. Requerido formato YYYY-MM (ej. '2026-04'). Es el mes al que corresponde la factura del courier, no la fecha en que la subís." },
        { status: 400 }
      );
    }

    // proxy.ts inyecta x-usuario-email cuando la sesión está autenticada.
    // Si no viene, guardamos null en la bitácora (no inventamos auth).
    const usuarioEmail = request.headers.get("x-usuario-email");

    let resultados = {
      procesados: 0,
      aprobadosParaCliente: 0,
      alertasDobleCobro: 0,
      alertasSobreprecio: 0,
      montoARecuperar: new Prisma.Decimal(0)
    };

    // Snapshot para UNDO: por cada FinanzasEnvio que este endpoint modifica,
    // guardamos { finanzasEnvioId, prior: { 8 campos antes del update } }.
    // Al final de la corrida creamos UN ConciliacionRun con este array;
    // POST /api/conciliacion/revertir lo restaura si nada del snapshot cayó
    // dentro de una LiquidacionMensual (mes ya cerrado → corregir con ajuste,
    // no con reversión).
    // STEP 1: agregamos periodoLogistica y estadoLiquidacionLogistica al snapshot
    // porque esta corrida los modifica en Rama A.
    type SnapshotEntry = {
      finanzasEnvioId: number;
      prior: {
        pesoAforado: number | null;
        costoCourierEsperado: string | null;
        costoCourierFacturado: string | null;
        estadoAuditoria: string | null;
        facturaCourierRef: string | null;
        costoAforo: string | null;
        periodoLogistica: string | null;
        estadoLiquidacionLogistica: EstadoLiquidacion;
      };
    };
    const snapshot: SnapshotEntry[] = [];

    // Sanity check para posible IVA mal declarado (solo warn, no bloquea).
    // Contamos rows donde costoFacturado > costoEsperado * 1.15 SIN aumento de
    // peso. Si esa fracción supera 50% del universo procesado por ESCUDO 2 y
    // el usuario declaró SIN_IVA, es probable que el Excel esté CON IVA.
    let rowsEnMainBranch = 0;
    let rowsSospechosasIva = 0;

    // ==========================================================================
    // FASE 1 FIX (post-DEUDA 73/107): conciliación rebuild
    //
    // ANTES: este endpoint sobrescribia FinanzasEnvio.precioFactura con la
    // formula pre-FASE-1 (ajusteTarifaPorcentaje + markupFijo, sin cascada, sin
    // SMO, sin Fee, sin IVA). Rompía silenciosamente la autoridad de precioFactura
    // sembrada por lib/envios/crear.ts.
    //
    // AHORA: precioFactura queda CONGELADO en lo que se cotizó/debitó al alta.
    // El desvío se guarda en FinanzasEnvio.costoAforo. El total-al-cliente en la
    // liquidación mensual sigue siendo (precioFactura + costoAforo), tal como ya
    // lo agrega app/api/admin/liquidaciones/route.ts.
    //
    // Regla de negocio (Nacho): quien paga se decide por PESO.
    //   - subió el peso  → el cliente mandó paquete más pesado → CLIENTE PAGA
    //     el delta a través del MISMO aplicarMarkup (Fee/SMO fijos cancelan;
    //     escala solo la parte porcentual + IVA).
    //   - peso igual pero costo subió → sobrefacturación del courier →
    //     SOBREPRECIO_RECLAMAR; costoAforo=0; cliente no paga.
    //   - Rama B (usaCredencialesPropias=true): SKIP entero. Shipro nunca recibe
    //     factura del courier (el courier factura directo al cliente) y el Fee
    //     es fijo → desvío = 0 por definición.
    // ==========================================================================

    // Cachés por proceso: mismo empresa/courier suele repetirse en un mismo Excel.
    const feeShiproNetoCache = new Map<number, Prisma.Decimal>();
    const intermediarioCache = new Map<number, number | null>();
    let credencialMissingWarned = false;
    const ahora = new Date();

    for (const fila of filasExcel) {
      // 1. Buscamos el envío
      const envio = await prisma.envio.findUnique({
        where: { trackingNumber: fila.tracking },
        include: {
          finanzas: true,
          empresa: { include: { credenciales: true } },
          courier: true
        }
      });

      if (!envio || !envio.finanzas) continue;

      // ==========================================
      // ESCUDO 1: ANTI-DOBLE COBRO (Caso UPS)
      // ==========================================
      // Si el envío ya fue facturado al cliente en el pasado, o si ya tiene un número de factura de courier asignado
      // STEP 1 (dos-vías-liquidación): un envío ya fue liquidado si cualquiera
      // de las dos vías (Fee/Logistica) está en LIQUIDADO, o si ya tiene la
      // marca de factura del courier (anti-doble-cobro clásico).
      if (
        envio.finanzas.estadoLiquidacionFee === EstadoLiquidacion.LIQUIDADO ||
        envio.finanzas.estadoLiquidacionLogistica === EstadoLiquidacion.LIQUIDADO ||
        envio.finanzas.facturaCourierRef !== null
      ) {

        // Snapshot los 8 campos ANTES del update (aunque este branch solo toca
        // estadoAuditoria, snapshoteamos todos para restaurar coherentemente
        // — el revertir espeja los mismos campos).
        snapshot.push({
          finanzasEnvioId: envio.finanzas.id,
          prior: {
            pesoAforado: envio.finanzas.pesoAforado ?? null,
            costoCourierEsperado: envio.finanzas.costoCourierEsperado ? envio.finanzas.costoCourierEsperado.toString() : null,
            costoCourierFacturado: envio.finanzas.costoCourierFacturado ? envio.finanzas.costoCourierFacturado.toString() : null,
            estadoAuditoria: envio.finanzas.estadoAuditoria ?? null,
            facturaCourierRef: envio.finanzas.facturaCourierRef ?? null,
            costoAforo: envio.finanzas.costoAforo ? envio.finanzas.costoAforo.toString() : null,
            periodoLogistica: envio.finanzas.periodoLogistica ?? null,
            estadoLiquidacionLogistica: envio.finanzas.estadoLiquidacionLogistica,
          },
        });

        await prisma.finanzasEnvio.update({
          where: { id: envio.finanzas.id },
          data: { estadoAuditoria: "DOBLE_COBRO" }
        });

        resultados.alertasDobleCobro++;
        resultados.montoARecuperar = resultados.montoARecuperar.add(new Prisma.Decimal(fila.costo)); // Exigimos la nota de crédito por el total
        resultados.procesados++;
        continue; // Cortamos acá, el cliente no se entera de nada
      }

      // ==========================================
      // ESCUDO 2 (REDISEÑADO): eje de decisión PESO
      // ==========================================
      rowsEnMainBranch++;

      const costoEsperado: Prisma.Decimal = envio.finanzas.precioProveedor ?? new Prisma.Decimal(0);
      const costoFactRaw: Prisma.Decimal = new Prisma.Decimal(fila.costo);
      const credencial = envio.empresa.credenciales.find(c => c.nombreCourier === envio.courier.nombre);

      // Sanity: costo >×1.15 esperado SIN aumento de peso es sospechoso de IVA
      // mal declarado. Se acumula acá (peso ya calculable) y se evalúa post-loop.
      {
        const pesoFacturadoSanity = new Prisma.Decimal(fila.peso || 0);
        const pesoCotizadoSanity = new Prisma.Decimal(envio.finanzas.pesoCobrado ?? 0);
        if (!pesoFacturadoSanity.gt(pesoCotizadoSanity) && costoFactRaw.gt(costoEsperado.mul("1.15"))) {
          rowsSospechosasIva++;
        }
      }

      let estadoAud: string = "OK";
      let costoAforo: Prisma.Decimal = new Prisma.Decimal(0);

      if (credencial?.usaCredencialesPropias === true) {
        // RAMA B: Shipro nunca recibe factura del courier para envíos Rama B
        // (el courier factura el flete directo al cliente). El Fee de plataforma
        // es fijo. Por definición el desvío es 0. Marcamos estado OK y salimos
        // del pricing. No se cuenta como sobreprecio ni como aforo.
        estadoAud = "OK";
        costoAforo = new Prisma.Decimal(0);
      } else if (credencial) {
        // RAMA A: eje de decisión = PESO.
        const pesoFacturado = new Prisma.Decimal(fila.peso || 0);
        // pesoCobrado es Float en el schema; envolvemos en Decimal para comparar sin float drift.
        const pesoCotizado = new Prisma.Decimal(envio.finanzas.pesoCobrado ?? 0);
        // ============================================================
        // DECISIÓN DE NEGOCIO (Nacho, ratificada) — NO EXISTEN ACREDITACIONES AL CLIENTE.
        // Solo un AUMENTO de peso dispara ajuste. Si pesoFacturado <= pesoCotizado
        // (peso igual o menor), NO se ajusta nada: el cliente paga la tarifa
        // publicada que aceptó al cotizar y la diferencia a favor queda para
        // Shipro. Por eso `subioPeso` usa `.gt(...)` estricto y no un `!eq(...)`.
        // ============================================================
        const subioPeso = pesoFacturado.gt(pesoCotizado);
        const subioCosto = costoFactRaw.sub(costoEsperado).gt("0.1");

        // ============================================================
        // DECISIÓN DE NEGOCIO (Nacho, ratificada) — CASO MIXTO ACEPTADO.
        // Cuando el peso cambió Y ADEMÁS el courier facturó mal, el sistema
        // no puede separar los dos efectos: solo conoce lo facturado, no lo
        // que "debería" costar al peso nuevo. Decisión tomada: se recalcula
        // la tarifa publicada con los parámetros facturados (aplicarMarkup
        // sobre `costoFactRaw`) y se liquida eso al cliente.
        // Consecuencia asumida: si el courier sobrefactura al mismo tiempo
        // que el paquete pesa más, ese sobre-cobro llega al cliente y no se
        // dispara SOBREPRECIO_RECLAMAR. NO es deuda pendiente ni limitación
        // a resolver — es la política definitiva.
        // ============================================================
        if (subioPeso) {
          // CLIENTE PAGA. Recomputamos la tarifa autoritativa con el costo REAL
          // usando aplicarMarkup (mismo formula que crear.ts). Fee y SMO son
          // fijos y ya viven adentro de precioFactura original → cancelan en
          // la resta. El delta viene de la cascada porcentual + IVA.
          //
          // Cargamos Fee neto y % intermediario (cacheados por proceso) para
          // que la config coincida byte-a-byte con la que uso crear.ts al alta.

          let feeShiproNeto = feeShiproNetoCache.get(envio.empresaId);
          if (feeShiproNeto === undefined) {
            const feeRes = await calcularFeeOperacion(envio.empresaId, new Prisma.Decimal(0));
            feeShiproNeto = feeRes?.feePreIva ?? new Prisma.Decimal(0);
            feeShiproNetoCache.set(envio.empresaId, feeShiproNeto);
          }

          let intermediarioMarkupPorcentaje: number | null;
          if (intermediarioCache.has(envio.courierId)) {
            intermediarioMarkupPorcentaje = intermediarioCache.get(envio.courierId) ?? null;
          } else {
            const inter = await prisma.courierIntermediario.findFirst({
              where: {
                courierId: envio.courierId,
                activo: true,
                vigenciaDesde: { lte: ahora },
                OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: ahora } }],
              },
            });
            intermediarioMarkupPorcentaje = inter?.markupPorcentaje ?? null;
            intermediarioCache.set(envio.courierId, intermediarioMarkupPorcentaje);
          }

          const smoNeto: Prisma.Decimal = envio.courier.smoActivo
            ? new Prisma.Decimal(envio.courier.smoPrecioAlClienteConIva) // stored NETO pese al nombre del campo
            : new Prisma.Decimal(0);

          const config: ConfigMarkup = {
            usaCredencialesPropias: credencial.usaCredencialesPropias,
            ajusteTarifaPorcentaje: credencial.ajusteTarifaPorcentaje,
            markupFijo: credencial.markupFijo,
            // OVERRIDE respecto de credencial.tarifaIncluyeIva: el flag de la
            // credencial describe lo que devuelve la API del courier; el Excel
            // del courier es una fuente DISTINTA con su propia convención,
            // declarada por el usuario en `ivaDeclarado`. aplicarMarkup necesita
            // saber si dividir por 1.21 al intake para llegar al neto, y esa
            // decisión depende del Excel.
            tarifaIncluyeIva: tarifaExcelIncluyeIva,
            intermediarioMarkupPorcentaje,
            smoNeto,
            feeShiproNeto,
          };

          const tarifaConCostoReal = aplicarMarkup(costoFactRaw, config).precioFinal;
          const precioFacturaOriginal: Prisma.Decimal = envio.finanzas.precioFactura ?? new Prisma.Decimal(0);
          const delta = tarifaConCostoReal.sub(precioFacturaOriginal);
          // DECISIÓN DE NEGOCIO (Nacho, ratificada): el clamp a 0 ES la regla
          // (no hay acreditaciones al cliente). Si por la razón que fuere el
          // recálculo diera un delta negativo (por ej. una tarifa vigente más
          // barata que la del alta), el cliente NO recibe crédito: la diferencia
          // a favor queda para Shipro. NO convertir esto en un valor con signo
          // — no es un guard defensivo, es la política de negocio.
          costoAforo = delta.gt(0) ? delta : new Prisma.Decimal(0);
          estadoAud = "OK"; // costoAforo > 0 basta para señalar el aforo cobrado; mantenemos el vocabulario OK/DOBLE_COBRO/SOBREPRECIO_RECLAMAR.
        } else if (subioCosto) {
          // SOBREPRECIO: el courier facturó más pero el paquete NO subió de
          // peso → sobrefacturación. Cliente no paga; Shipro reclama la nota
          // de crédito al courier.
          // Peso sin cambio → el cliente paga la tarifa cotizada (DECISIÓN 1);
          // el sobre-cobro del courier se maneja como reclamo, no llega al cliente.
          estadoAud = "SOBREPRECIO_RECLAMAR";
          costoAforo = new Prisma.Decimal(0);
          resultados.alertasSobreprecio++;
          resultados.montoARecuperar = resultados.montoARecuperar.add(costoFactRaw.sub(costoEsperado));
        } else {
          // MATCH: mismo peso, mismo costo (o costo menor). Todo OK.
          // Peso sin cambio → el cliente paga la tarifa cotizada (DECISIÓN 1);
          // si el courier terminó facturando de menos, la diferencia a favor queda para Shipro.
          estadoAud = "OK";
          costoAforo = new Prisma.Decimal(0);
        }
      } else {
        // Sin credencial (dato inconsistente): no podemos determinar rama.
        // Defensivo: costoAforo=0, estadoAud=OK. Log una vez por Excel para no spamear.
        if (!credencialMissingWarned) {
          console.warn(
            `[conciliacion] Envío ${envio.trackingNumber}: credencial no encontrada para ` +
            `empresa=${envio.empresaId} courier="${envio.courier.nombre}". Se marca OK con costoAforo=0.`
          );
          credencialMissingWarned = true;
        }
      }

      snapshot.push({
        finanzasEnvioId: envio.finanzas.id,
        prior: {
          pesoAforado: envio.finanzas.pesoAforado ?? null,
          costoCourierEsperado: envio.finanzas.costoCourierEsperado ? envio.finanzas.costoCourierEsperado.toString() : null,
          costoCourierFacturado: envio.finanzas.costoCourierFacturado ? envio.finanzas.costoCourierFacturado.toString() : null,
          estadoAuditoria: envio.finanzas.estadoAuditoria ?? null,
          facturaCourierRef: envio.finanzas.facturaCourierRef ?? null,
          costoAforo: envio.finanzas.costoAforo ? envio.finanzas.costoAforo.toString() : null,
          periodoLogistica: envio.finanzas.periodoLogistica ?? null,
          estadoLiquidacionLogistica: envio.finanzas.estadoLiquidacionLogistica,
        },
      });

      // STEP 1 (dos-vías-liquidación): Rama A avanza la vía LOGISTICA a EN_PROCESO
      // y se sella el período de la factura del courier. Rama B: NO se toca
      // (queda NO_APLICA — Shipro nunca recibe factura del courier en Rama B).
      // Los envíos sin credencial reconocible tampoco se tocan (defensivo).
      const enPipelineLogistica = credencial != null && credencial.usaCredencialesPropias === false;

      await prisma.finanzasEnvio.update({
        where: { id: envio.finanzas!.id },
        data: {
          pesoAforado: fila.peso,
          costoCourierEsperado: costoEsperado,
          costoCourierFacturado: costoFactRaw,
          estadoAuditoria: estadoAud,
          facturaCourierRef: referenciaFactura, // Marca para evitar futuros dobles cobros.
          costoAforo,                            // FASE 1: escribimos el delta; NO tocamos precioFactura.
          ...(enPipelineLogistica ? {
            periodoLogistica: periodoFacturaCourier,
            estadoLiquidacionLogistica: EstadoLiquidacion.EN_PROCESO,
          } : {}),
        }
      });

      resultados.aprobadosParaCliente++;
      resultados.procesados++;
    }

    // Sanity IVA post-loop: si el usuario declaró SIN_IVA pero >50% de las rows
    // procesadas por ESCUDO 2 muestran costoFacturado >×1.15 esperado sin subir
    // el peso, es muy probable que el Excel esté CON IVA. Advertimos, no bloqueamos.
    let advertenciaPosibleIva = false;
    if (
      ivaDeclarado === "SIN_IVA" &&
      rowsEnMainBranch > 0 &&
      rowsSospechosasIva * 2 > rowsEnMainBranch
    ) {
      advertenciaPosibleIva = true;
      console.warn(
        `[conciliacion] Posible IVA no declarado: ${rowsSospechosasIva}/${rowsEnMainBranch} filas ` +
        `tienen costoFacturado > costoEsperado ×1.15 sin aumento de peso. Usuario declaró SIN_IVA — ` +
        `verificar si la columna del Excel realmente viene sin IVA.`
      );
    }

    // Persistir la corrida (una fila por POST). El snapshot habilita la reversión
    // vía POST /api/conciliacion/revertir. cantidadEnvios = filas realmente
    // modificadas (contamos snapshot.length, no filasExcel.length).
    const run = await prisma.conciliacionRun.create({
      data: {
        referenciaFactura,
        ivaDeclarado,
        periodoFacturaCourier, // STEP 1: se guarda para trazabilidad de la corrida.
        cantidadEnvios: snapshot.length,
        usuarioEmail: usuarioEmail || null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      success: true,
      runId: run.id,
      ...resultados,
      montoARecuperar: resultados.montoARecuperar.toNumber(),
      advertenciaPosibleIva,
      rowsSospechosasIva,
      rowsEnMainBranch,
    });

  } catch (error) {
    console.error("Error en API Conciliación:", error);
    return NextResponse.json({ error: "Error interno al procesar auditoría" }, { status: 500 });
  }
}