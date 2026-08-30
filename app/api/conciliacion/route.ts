import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, EstadoLiquidacion } from "@prisma/client";
import { aplicarMarkup, type ConfigMarkup } from "@/lib/cotizador";
import { calcularFeeOperacion } from "@/lib/utils/operacion-fee";
import {
  resolverMarkupShiproPorcentaje,
  resolverSmoNeto,
  resolverIntermediarioMarkupPorcentaje,
} from "@/lib/utils/resolvers-tarifa";
import { evaluarSuspension, suspenderEmpresa, reactivarEmpresa } from "@/lib/utils/suspension-cuenta";
import { IVA_AR_MULTIPLIER } from "@/lib/constants/iva";

// STEP 2b: IVA aplicado UNA vez sobre el aforo NETO (fix 5764287).
// IVA: fuente única en lib/constants/iva.ts (consolidación 2026-07-31).

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
        // PASO 2b (2026-07-27): registro auditable de si la conciliación creó
        // un débito prepago real-time para este envío + su monto (con IVA).
        // La reversión primaria usa la FK conciliacionRunId; este campo es
        // belt-and-suspenders para inspección manual del snapshot.
        aforoDebitadoConIva?: string | null;
      };
    };
    const snapshot: SnapshotEntry[] = [];

    // PASO 2b: creamos la corrida ANTES del loop para poder atar los
    // MovimientoFinanciero al run.id. cantidadEnvios y snapshot se actualizan
    // al final vía un update.
    //
    // PASO 2b: empresas que recibieron débito prepago en este run. Al final
    // del loop, evaluamos suspensión (o reactivación, defensivo) UNA vez por
    // empresa sobre el saldo final. Handler-scope: el post-tx suspension eval
    // (POST commit) lo lee.
    const empresasTocadas = new Set<number>();

    // Sanity check para posible IVA mal declarado (solo warn, no bloquea).
    // Contamos rows donde costoFacturado > costoEsperado * 1.15 SIN aumento de
    // peso. Si esa fracción supera 50% del universo procesado por ESCUDO 2 y
    // el usuario declaró SIN_IVA, es probable que el Excel esté CON IVA.
    // Handler-scope: la respuesta JSON post-tx los lee.
    let rowsEnMainBranch = 0;
    let rowsSospechosasIva = 0;
    let advertenciaPosibleIva = false;

    // ATOMICIDAD (2026-07-29): la corrida ENTERA (ConciliacionRun.create +
    // el loop entero + el snapshot final) corre en UN interactive tx externo.
    // Si algo tira mid-loop, la $transaction rollbackea TODO — la
    // ConciliacionRun no queda huérfana con snapshot vacío, los
    // DEBITO_AJUSTE_AFORO no se committean, el saldo no se mueve. La eval de
    // suspensión queda POST-tx (mirror crear.ts: una notificación fallida no
    // revierte plata ya committeada). Timeout amplio: un Excel real de ~500-1000
    // rows puede tomar 30-90s con las 2-6 queries por row; el default de Prisma
    // (5s) sería insuficiente. maxWait 10s cubre picos de cola.
    const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.conciliacionRun.create({
      data: {
        referenciaFactura,
        ivaDeclarado,
        periodoFacturaCourier, // STEP 1: se guarda para trazabilidad de la corrida.
        cantidadEnvios: 0,
        usuarioEmail: usuarioEmail || null,
        snapshot: [] as unknown as Prisma.InputJsonValue,
      },
    });
    const runId = run.id;

    // ==========================================================================
    // FASE 1 FIX (post-DEUDA 73/107): conciliación rebuild
    //
    // ANTES: este endpoint sobrescribia FinanzasEnvio.tarifaFullCotizada con la
    // formula pre-FASE-1 (ajusteTarifaPorcentaje + markupFijo, sin cascada, sin
    // SMO, sin Fee, sin IVA). Rompía silenciosamente la autoridad de tarifaFullCotizada
    // sembrada por lib/envios/crear.ts.
    //
    // AHORA: tarifaFullCotizada queda CONGELADO en lo que se cotizó/debitó al alta.
    // El desvío se guarda en FinanzasEnvio.costoAforo. El total-al-cliente en la
    // liquidación mensual sigue siendo (tarifaFullCotizada + costoAforo), tal como ya
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
    // FASE 2 motor mov 2 (2026-08-03): el intermediarioCache anterior estaba
    // keyed por envio.courierId (ejecutor). Con lookup owner-keyed (resolver)
    // la clave debería incluir credencial.propietarioTipo/CourierId — para
    // mantener simple el path se llama al resolver por envío en la rama
    // subioPeso (que es un subconjunto de los envíos de la corrida). Si
    // llegara a hacer falta perf, cachear por credencial.id en su momento.
    let credencialMissingWarned = false;
    const ahora = new Date();

    for (const fila of filasExcel) {
      // 1. Buscamos el envío
      const envio = await tx.envio.findUnique({
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
      // Un tracking ya fue conciliado si (y SOLO si) la vía LOGÍSTICA fue cerrada
      // (LIQUIDADO) o si ya tiene la marca de factura del courier (facturaCourierRef,
      // seteada por esta misma conciliación en L399/L446 — es el marker autoritativo
      // de "conciliación ya ejecutada sobre este tracking").
      //
      // La vía FEE es un evento contable INDEPENDIENTE (proforma mensual documental)
      // y NO gatea el débito de aforo. Anteriormente el escudo también atrapaba
      // `estadoLiquidacionFee === LIQUIDADO`, pero la proforma FEE flippa ese flag
      // para TODOS los envíos del mes sin depender de conciliación; si el operador
      // emitía la proforma FEE antes de cargar el Excel del courier (ordering B, sin
      // orden garantizado), el escudo disparaba falso positivo y el aforo se PERDÍA
      // silenciosamente (bug agregado en 0d6fd7b DEUDA 73, corregido acá).
      if (
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
            aforoDebitadoConIva: null, // DOBLE_COBRO branch nunca debita
          },
        });

        await tx.finanzasEnvio.update({
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
          // fijos y ya viven adentro de tarifaFullCotizada original → cancelan en
          // la resta. El delta viene de la cascada porcentual + IVA.
          //
          // Cargamos Fee neto y % intermediario (cacheados por proceso) para
          // que la config coincida byte-a-byte con la que uso crear.ts al alta.

          let feeShiproNeto = feeShiproNetoCache.get(envio.empresaId);
          if (feeShiproNeto === undefined) {
            const feeRes = await calcularFeeOperacion(envio.empresaId, new Prisma.Decimal(0), tx);
            feeShiproNeto = feeRes?.feePreIva ?? new Prisma.Decimal(0);
            feeShiproNetoCache.set(envio.empresaId, feeShiproNeto);
          }

          // FASE 2 motor mov 2 (2026-08-03): pivote de las 3 fuentes a los
          // resolvers (mismo camino que cotización + fallback en crear.ts).
          // Owner-keyed intermediario / SmoCourier vigente / MarkupShiproVigencia
          // global con override. Ver lib/utils/resolvers-tarifa.ts.
          // La ausencia de deltas espurios entre cotización y conciliación
          // depende de que ambas usen la MISMA fuente — de ahí la pivote acá.
          const intermediarioMarkupPorcentaje = await resolverIntermediarioMarkupPorcentaje(
            credencial,
            envio.courierId,
            tx
          );

          const smoNeto: Prisma.Decimal = await resolverSmoNeto(envio.courierId, tx);

          const markupShiproPorcentaje = await resolverMarkupShiproPorcentaje(
            credencial.ajusteTarifaPorcentaje,
            tx
          );

          const config: ConfigMarkup = {
            usaCredencialesPropias: credencial.usaCredencialesPropias,
            ajusteTarifaPorcentaje: markupShiproPorcentaje,
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

          // 2026-07-27: costoAforo se persiste en NETO (regla plataforma: todo neto,
          // IVA aplicado UNA sola vez al leer, en la proforma). Sus vecinos
          // (logisticaNetaFacturada, feeNetoFacturado) también son NETO — invariante
          // STEP 1: logisticaNeta + feeNeto + ivaFacturado = tarifaFullCotizada →
          // logisticaNeta + feeNeto = netoAcumulado_original. Byte-perfect via
          // el desglose ya propagado por cotizador (Opción A). Sin ÷1.21.
          const desgloseNuevo = aplicarMarkup(costoFactRaw, config).desglose;
          const netoNuevo: Prisma.Decimal = desgloseNuevo.netoAcumulado;
          // PASO 3 PIECE 2 — guard de factura tardía sobre etiqueta ya barrida:
          // Si el sweep de 6 meses ya corrió sobre esta etiqueta (logisticaDevuelta=
          // true), el flete estimado (logisticaNetaFacturada × 1.21) YA se devolvió
          // al saldo del cliente vía CREDITO_LOGISTICA_NO_FACTURADA. En ese momento
          // el saldo del cliente sólo refleja el Fee cobrado. Cobrar SÓLO el delta
          // (netoNuevo − (logisticaNeta + feeNeto)) subcobraría exactamente lo
          // devuelto por el sweep — el flete nunca vuelve al saldo.
          //
          // Solución: para etiquetas barridas, netoOriginal = feeNetoFacturado SOLO,
          // así costoAforo = netoNuevo − feeNeto = el flete REAL completo (recomputado
          // con el costo del courier). El débito ×1.21 recupera exactamente lo que el
          // sweep devolvió, PLUS cualquier aumento de aforo automático.
          //
          // Caso clave: el courier factura EXACTAMENTE el estimado (mismo peso, mismo
          // costo). Con la fórmula normal deltaNeto=0 → no habría débito → el flete
          // devuelto por el sweep queda regalado. Con este guard, deltaNeto = flete
          // completo → se re-cobra correctamente.
          //
          // logisticaDevuelta NO se muta acá — queda en true como marca histórica
          // ("esta etiqueta fue barrida y luego re-cobrada"). El sweep no la re-toma
          // porque el downstream flippa estado a EN_PROCESO; el shield la bloquea de
          // reimports vía facturaCourierRef.
          const netoOriginal: Prisma.Decimal = envio.finanzas.logisticaDevuelta
            ? (envio.finanzas.feeNetoFacturado ?? new Prisma.Decimal(0))
            : (envio.finanzas.logisticaNetaFacturada ?? new Prisma.Decimal(0))
                .add(envio.finanzas.feeNetoFacturado ?? new Prisma.Decimal(0));
          const deltaNeto = netoNuevo.sub(netoOriginal);
          // DECISIÓN DE NEGOCIO (Nacho, ratificada): el clamp a 0 ES la regla
          // (no hay acreditaciones al cliente). Si por la razón que fuere el
          // recálculo diera un delta negativo (por ej. una tarifa vigente más
          // barata que la del alta), el cliente NO recibe crédito: la diferencia
          // a favor queda para Shipro. NO convertir esto en un valor con signo
          // — no es un guard defensivo, es la política de negocio.
          costoAforo = deltaNeto.gt(0) ? deltaNeto : new Prisma.Decimal(0);
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

      // STEP 1 (dos-vías-liquidación): Rama A avanza la vía LOGISTICA a EN_PROCESO
      // y se sella el período de la factura del courier. Rama B: NO se toca
      // (queda NO_APLICA — Shipro nunca recibe factura del courier en Rama B).
      // Los envíos sin credencial reconocible tampoco se tocan (defensivo).
      const enPipelineLogistica = credencial != null && credencial.usaCredencialesPropias === false;

      // 2026-07-28: UNIFICACIÓN — el ajuste por aforo debita el saldo AL CONCILIAR
      // para ambos modelos de pago (prepago y postpago). Antes solo prepago debitaba
      // acá; postpago debitaba al emitir la proforma logística. Ahora la proforma es
      // documental (no mueve plata) y el saldo se realinea en un solo lugar. Postpago
      // simplemente se hace más negativo contra su limiteDescubierto; si cruza el
      // umbral, evaluarSuspension al final del loop lo suspende como corresponde.
      // Solo Rama A con costoAforo > 0 dispara débito (Rama B no aplica; sin credencial
      // tampoco, defensivo).
      const debeAforoDebit = enPipelineLogistica && costoAforo.gt(0);

      let aforoDebitadoConIvaStr: string | null = null;

      // ATOMICIDAD 2026-07-29: cuando corresponde débito de aforo, el write set
      // (finanzas.update + movimientoFinanciero.create + empresa.saldoActivo.update)
      // corre bajo el tx externo del handler — antes tenía su propia
      // $transaction anidada, dissolvida porque el tx exterior ya provee
      // atomicidad y Prisma no soporta interactive tx anidados.
      if (debeAforoDebit) {
        const aforoConIva = costoAforo.mul(IVA_AR_MULTIPLIER);
        aforoDebitadoConIvaStr = aforoConIva.toString();

        await tx.finanzasEnvio.update({
          where: { id: envio.finanzas!.id },
          data: {
            pesoAforado: fila.peso,
            costoCourierEsperado: costoEsperado,
            costoCourierFacturado: costoFactRaw,
            estadoAuditoria: estadoAud,
            facturaCourierRef: referenciaFactura,
            costoAforo,
            periodoLogistica: periodoFacturaCourier,
            estadoLiquidacionLogistica: EstadoLiquidacion.EN_PROCESO,
          },
        });

        // Refetch saldoActivo dentro del tx externo: el mismo Excel puede tocar N
        // envíos de la misma empresa; siempre partimos del saldo autoritativo
        // más actualizado (evita drift con el envio.empresa cacheado del find).
        const empFresh = await tx.empresa.findUnique({
          where: { id: envio.empresaId },
          select: { saldoActivo: true },
        });
        if (!empFresh) throw new Error(`Empresa ${envio.empresaId} no encontrada (concurrencia).`);

        const nuevoSaldo = empFresh.saldoActivo.sub(aforoConIva);

        await tx.movimientoFinanciero.create({
          data: {
            empresaId: envio.empresaId,
            tipo: "DEBITO_AJUSTE_AFORO",
            monto: aforoConIva.neg(),
            saldoPosterior: nuevoSaldo,
            referencia: `FC-${referenciaFactura} / ${envio.trackingNumber}`,
            descripcion: `Ajuste por aforo (conciliación ${referenciaFactura}) — envío ${envio.trackingNumber}`,
            envioId: envio.id,
            conciliacionRunId: runId,
          },
        });

        await tx.empresa.update({
          where: { id: envio.empresaId },
          data: { saldoActivo: nuevoSaldo },
        });

        empresasTocadas.add(envio.empresaId);
      } else {
        // Camino POSTPAGO / Rama B / sin credencial / sin aforo: solo finanzas.update.
        await tx.finanzasEnvio.update({
          where: { id: envio.finanzas!.id },
          data: {
            pesoAforado: fila.peso,
            costoCourierEsperado: costoEsperado,
            costoCourierFacturado: costoFactRaw,
            estadoAuditoria: estadoAud,
            facturaCourierRef: referenciaFactura, // Marca para evitar futuros dobles cobros.
            costoAforo,                            // FASE 1: escribimos el delta; NO tocamos tarifaFullCotizada.
            ...(enPipelineLogistica ? {
              periodoLogistica: periodoFacturaCourier,
              estadoLiquidacionLogistica: EstadoLiquidacion.EN_PROCESO,
            } : {}),
          }
        });
      }

      // Snapshot DESPUÉS del write (para reflejar el débito prepago si ocurrió).
      // El shape "prior" sigue capturando los valores ANTES del update — el
      // aforoDebitadoConIva es la única entrada que refleja la corrida en sí.
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
          aforoDebitadoConIva: aforoDebitadoConIvaStr,
        },
      });

      resultados.aprobadosParaCliente++;
      resultados.procesados++;
    }

    // Sanity IVA post-loop: si el usuario declaró SIN_IVA pero >50% de las rows
    // procesadas por ESCUDO 2 muestran costoFacturado >×1.15 esperado sin subir
    // el peso, es muy probable que el Excel esté CON IVA. Advertimos, no bloqueamos.
    // advertenciaPosibleIva vive en el handler-scope (arriba); acá solo se asigna.
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

    // PASO 2b: cerramos la corrida creada al inicio con el snapshot final +
    // cantidadEnvios. La corrida ya existe (creada antes del loop para atar
    // los MovimientoFinanciero al run.id). Al ser el ÚLTIMO write del tx
    // externo, el snapshot y las mutaciones commitean juntos o rollbackean juntos.
    await tx.conciliacionRun.update({
      where: { id: runId },
      data: {
        cantidadEnvios: snapshot.length,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    return runId;
    }, { timeout: 120_000, maxWait: 10_000 });

    // PASO 2b: evaluar suspensión (o reactivación defensiva) POST-tx por cada
    // empresa que recibió débito prepago. Mirror del pattern crear.ts:855-865:
    // una falla acá NO revierte los débitos ya committeados.
    for (const empresaId of empresasTocadas) {
      try {
        const emp = await prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { saldoActivo: true, limiteDescubierto: true, suspendida: true },
        });
        if (!emp) continue;
        const { debeSuspender, debeReactivar } = evaluarSuspension(
          emp.saldoActivo,
          emp.limiteDescubierto ?? new Prisma.Decimal(0),
          emp.suspendida
        );
        if (debeSuspender) {
          await suspenderEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        } else if (debeReactivar) {
          // Un débito no reactiva, pero la evaluación es simétrica y barata.
          await reactivarEmpresa(empresaId, null, emp.saldoActivo, emp.limiteDescubierto ?? new Prisma.Decimal(0));
        }
      } catch (suspErr) {
        console.error(`[PASO 2b] evaluación suspensión post-tx falló empresa=${empresaId}:`, suspErr);
      }
    }

    return NextResponse.json({
      success: true,
      runId,
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