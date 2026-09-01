import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { calcularPromesaCalibrada } from "@/lib/utils/promesa-calibrada";
import { calcularFeeOperacion } from "@/lib/utils/operacion-fee";
import {
  resolverMarkupCourierPorcentaje,
  resolverSmoNeto,
  resolverIntermediarioMarkupPorcentaje,
} from "@/lib/utils/resolvers-tarifa";
import type { Paquete } from "@/lib/couriers/CourierInterface";
import { IVA_AR_MULTIPLIER } from "@/lib/constants/iva";

export interface CotizarInput {
  empresaId: number | null;
  // DEUDA 4: opcional. Si no viene, se lee del depósito predeterminado de la
  // empresa. Si la empresa no tiene depósito, se lanza DepositoRequerido.
  // Casos donde el caller pasa cpOrigen explícito:
  // - Cotizador rápido manual donde el operador shipro tipea un CP origen.
  // - Tests / usos administrativos.
  cpOrigen?: string;
  cpDestino: string;
  provinciaDestino?: string;
  paquetes: Paquete[];
  valorCarrito?: number;
  // DEUDA 32+37 (Fase J): contexto de la llamada para el registro de
  // cobertura vacia. Valores tipicos: "dashboard" / "api" / "checkout".
  // Si no se provee, queda null en el registro.
  origen?: string;
}

export interface OpcionTarifa {
  id: string;
  courier: string;
  modalidad: string;
  // DEUDA 144: código canónico del servicio del registry (ej. "entrega_domicilio_estandar").
  // Lo puebla el cotizador resolviendo (courier, tipoEntrega) → el único ServicioCourier de
  // grupo "entrega" activo con esa capacidad (1:1 hoy). El rates callback lo usa para emitir
  // el code ESTABLE (generarCodeServicio) que matchea el pre-registrado como carrier option.
  // Opcional: consumers legacy (crear.ts, dashboard) lo ignoran.
  codigoServicio?: string;
  precioFinal: Prisma.Decimal;
  // DEUDA 156: precio que VE EL COMPRADOR en el checkout de e-commerce (precioFinal con el
  // descuento del cliente aplicado, piso $0). Solo lo consumen canales buyer-facing (Tiendanube,
  // plugins). El dashboard y la facturación usan precioFinal (full). Sin descuento === precioFinal.
  precioFinalBuyer: Prisma.Decimal;
  // DEUDA 158 (2026-08-31): renombrado de precioProveedor (nombre por rol real,
  // "proveedor" era ambiguo — refería al courier físico). Costo courier RAW en
  // forma NATIVA (Andreani con IVA, Mocis sin; no homogéneo cross-courier).
  costoCourierNativo: Prisma.Decimal;
  slaHs: number;
  fechaEstimadaString: string;
  etiquetaSla: string;
  // Desglose del precio computado por aplicarMarkup — se propaga hasta el
  // consumidor para que crear.ts persista el breakdown (feeNeto / cascadaNeto
  // / smoNeto / netoAcumulado) sin recomputar. Opcional para no romper
  // consumidores legacy; los productores del cotizador siempre lo pueblan.
  // DEUDA 153: secoNeto y baseConIntermediario se agregaron al desglose
  // propagado para poblar el audit trail interno de pricing en FinanzasEnvio
  // (tarifaCourierBaseNeta, markupIntermediarioPorcentajeAplicado, baseConIntermediarioAplicado).
  // Rama B: baseConIntermediario === secoNeto (sin intermediario ≡ factor 1).
  desglose?: {
    secoNeto: Prisma.Decimal;
    baseConIntermediario: Prisma.Decimal;
    cascadaNeto: Prisma.Decimal;
    smoNeto: Prisma.Decimal;
    feeNeto: Prisma.Decimal;
    netoAcumulado: Prisma.Decimal;
  };
  // DEUDA 129 (per-courier fallback): true cuando la opción es una tarifa de
  // rescate porque el courier no cotizó (no es una tarifa real del courier).
  // El comprador ve el nombre real del courier (transparencia comercial ausente);
  // la UI + crear.ts pueden distinguir con este flag si necesitan diferenciar.
  esFallback?: boolean;
}

export interface CotizarResult {
  domicilio: OpcionTarifa[];
  sucursal: OpcionTarifa[];
  cambio: any[];
  devolucion: any[];
  metadata?: { reglaEjecutada: string };
  // DEUDA 32+37 (Fase J): true cuando ni un courier pudo cotizar
  // (vacio total). La UI usa este flag para mostrar el banner.
  coberturaVacia?: boolean;
}

// =================================================================
// HELPER: CÁLCULO DE DÍAS HÁBILES (Soporta Feriados DB)
// =================================================================
async function calcularFechaEstimada(horasSla: number): Promise<string> {
  const diasHabilesRequeridos = Math.max(1, Math.ceil(horasSla / 24));

  const feriadosDB = await prisma.feriado.findMany({ where: { activo: true } });
  const fechasFeriados = feriadosDB.map(f => f.fecha.toISOString().split('T')[0]);

  const sumarDiasHabiles = (fechaBase: Date, diasExtras: number) => {
    let fecha = new Date(fechaBase);
    let agregados = 0;
    while (agregados < diasExtras) {
      fecha.setDate(fecha.getDate() + 1);
      const fechaString = fecha.toISOString().split('T')[0];
      const esFinDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6;
      const esFeriado = fechasFeriados.includes(fechaString);
      if (!esFinDeSemana && !esFeriado) agregados++;
    }
    return fecha;
  };

  const hoy = new Date();
  const fechaMin = sumarDiasHabiles(hoy, Math.max(1, diasHabilesRequeridos - 1));
  const fechaMax = sumarDiasHabiles(hoy, diasHabilesRequeridos);

  const opcionesFormato: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

  if (fechaMin.getTime() === fechaMax.getTime() || horasSla <= 24) {
    return `Llega el ${fechaMax.toLocaleDateString('es-AR', opcionesFormato)}`;
  }
  return `Llega entre el ${fechaMin.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' })} y el ${fechaMax.toLocaleDateString('es-AR', opcionesFormato)}`;
}

/**
 * Cotiza tarifas para todos los couriers configurados de la empresa.
 * Si empresaId es null, lanza Error('EmpresaRequerida') — Modo Dios "TODAS"
 * no aplica acá: cada empresa tiene credenciales y reglas distintas.
 *
 * Función pura: no toca Request/Response ni lee de auth context.
 * Si las credenciales propias de un courier están inválidas, ese courier se
 * salta silenciosamente (no aparece en las opciones — política de etiqueta
 * genérica solo aplica al momento de crear el envío real).
 */
/**
 * DEUDA 10 Paso 3a: logica de markup extraida de cotizar() para reuso.
 * Funcion pura: dado el costo seco del courier + la config de pricing de la
 * credencial, devuelve { costoCourierNativo, precioFinal }. Misma formula que
 * usaba la closure local calcularPrecios (sin cambio de comportamiento).
 * La reusa el fallback de precio (lib/utils/precio-fallback.ts) para re-aplicar
 * markup al precio CRUDO historico (D-10-PRICE-READ source 1).
 * NOTA DEUDA 73: aqui se sumaran seguro + descuento cuando se implementen.
 */
export interface ConfigMarkup {
  usaCredencialesPropias: boolean;
  ajusteTarifaPorcentaje: number | null;
  markupFijo: Prisma.Decimal | null;
  tarifaIncluyeIva: boolean;
  // DEUDA 107 capa 1: % del intermediario (Modelo A). null = sin intermediario.
  // Cascada: se aplica ANTES del markup Shipro (Shipro% opera sobre el resultado del intermediario).
  intermediarioMarkupPorcentaje: number | null;
  // DEUDA 73 capa 2: SMO neto (SIN IVA) por courier. Se suma al costoConMarkup ANTES del IVA final.
  // Opcional: callers legacy no lo pasan → default 0 (no cobra SMO).
  smoNeto?: Prisma.Decimal | null;
  // DEUDA 73 capa 2: Fee Shipro neto (SIN IVA), calculado una vez por cotización desde OperacionFee.
  // Se suma al costoConMarkup ANTES del IVA final. Opcional: callers legacy no lo pasan → default 0.
  feeShiproNeto?: Prisma.Decimal | null;
}

/**
 * DEUDA 156: computa el precio que VE EL COMPRADOR en el checkout aplicando el
 * descuento del cliente. NO toca precioFinal (Shipro factura el chain completo
 * igual — el descuento lo absorbe el cliente hacia su comprador). Solo lo
 * consumen los canales buyer-facing (rates callback Tiendanube, plugins).
 *
 * Modo (config.descuentoClienteModo):
 *   - "MONTO"      → descuento = config.descuentoClienteSobreTarifa ($)
 *   - "PORCENTAJE" → descuento = precioFinal × (config.descuentoClientePorcentaje / 100)
 * Piso $0: buyer nunca queda negativo (máximo, envío gratis).
 * Sin descuento configurado (default: modo MONTO + monto=0) → descuento=0 → buyer === precioFinal.
 */
function aplicarDescuentoCliente(
  precioFinal: Prisma.Decimal,
  config: { descuentoClienteModo?: string | null; descuentoClientePorcentaje?: number | null; descuentoClienteSobreTarifa?: Prisma.Decimal | number | null }
): Prisma.Decimal {
  const modo = config?.descuentoClienteModo;
  let descuento = new Prisma.Decimal(0);
  if (modo === "PORCENTAJE") {
    const pct = new Prisma.Decimal(config?.descuentoClientePorcentaje ?? 0);
    if (pct.gt(0)) descuento = precioFinal.mul(pct).div(100);
  } else if (modo === "MONTO") {
    const monto = config?.descuentoClienteSobreTarifa != null
      ? new Prisma.Decimal(config.descuentoClienteSobreTarifa as any)
      : new Prisma.Decimal(0);
    if (monto.gt(0)) descuento = monto;
  }
  const buyer = precioFinal.sub(descuento);
  return buyer.lt(0) ? new Prisma.Decimal(0) : buyer.toDecimalPlaces(2);
}

export function aplicarMarkup(
  costoSecoCourier: Prisma.Decimal | number,
  config: ConfigMarkup
): {
  costoCourierNativo: Prisma.Decimal;
  precioFinal: Prisma.Decimal;
  desglose: {
    secoNeto: Prisma.Decimal;
    baseConIntermediario: Prisma.Decimal;
    cascadaNeto: Prisma.Decimal;
    smoNeto: Prisma.Decimal;
    feeNeto: Prisma.Decimal;
    netoAcumulado: Prisma.Decimal;
  };
} {
  const seco = costoSecoCourier instanceof Prisma.Decimal
    ? costoSecoCourier
    : new Prisma.Decimal(costoSecoCourier);
  const porcentajeMarkup = config.ajusteTarifaPorcentaje || 0;
  const fijoMarkup = config.markupFijo ?? new Prisma.Decimal(0);

  // DEUDA 73 capa 2: STRIP DE IVA AL INTAKE.
  // Si el número del courier viene con IVA (tarifaIncluyeIva=true, ej. Andreani API), dividimos
  // por 1.21 en la puerta para recuperar el neto. Todo lo que sigue trabaja sobre NETOS. El IVA se
  // aplica UNA VEZ al final. Antes (capa 1) se multiplicaba al final SOLO si tarifaIncluyeIva=false;
  // ahora la semántica del flag se invierte: true=número con IVA a extraer, false=ya es neto.
  const secoNeto = config.tarifaIncluyeIva ? seco.div(IVA_AR_MULTIPLIER) : seco;

  // DEUDA 153: baseConIntermediario hoisteada fuera del if/else para que exista
  // coherentemente en AMBAS ramas y se pueda propagar al desglose (audit trail).
  // Rama B: intermediarioMarkupPorcentaje siempre viene null (resolver L146) →
  // factor (1 + 0/100) = 1 → baseConIntermediario === secoNeto (semántica correcta:
  // "sin intermediario" ≡ base = secoNeto). Rama A: idéntica math que antes.
  const baseConIntermediario = secoNeto.mul(
    new Prisma.Decimal(1).add(new Prisma.Decimal(config.intermediarioMarkupPorcentaje ?? 0).div(100))
  );

  let costoConMarkup: Prisma.Decimal;
  if (config.usaCredencialesPropias) {
    // Modelo B: sin intermediario, sin markup %, solo fijo. Se opera sobre el NETO.
    // (baseConIntermediario === secoNeto acá; costoConMarkup queda idéntico al legacy.)
    costoConMarkup = secoNeto.add(fijoMarkup);
  } else {
    // Modelo A: CASCADA sobre el NETO. Primero markup del intermediario (Mocis 10%) sobre la
    // tarifa neta cruda, después markup Shipro (%) sobre el resultado del intermediario, y
    // finalmente markupFijo. DEUDA 107 capa 1.
    costoConMarkup = baseConIntermediario
      .mul(new Prisma.Decimal(1).add(new Prisma.Decimal(porcentajeMarkup).div(100)))
      .add(fijoMarkup);
  }

  // DEUDA 73 capa 2: acumular SMO neto + Fee neto (netos ambos, se pasan como Decimal en la config).
  // Se aplican en AMBAS ramas (A y B) — el SMO cuando el courier lo tiene activo, el Fee siempre
  // que la empresa tenga OperacionFee vigente.
  const smoNeto = config.smoNeto ?? new Prisma.Decimal(0);
  const feeNeto = config.feeShiproNeto ?? new Prisma.Decimal(0);
  const netoAcumulado = costoConMarkup.add(smoNeto).add(feeNeto);

  // IVA aplicado UNA VEZ al total neto acumulado.
  // Redondeo a 2 decimales (half-up) para que el precio cotizado NAZCA en
  // precisión de moneda — coincide byte-a-byte con el valor que Postgres
  // guarda al persistirlo en FinanzasEnvio.tarifaFullCotizada (Decimal(12,2),
  // que redondea half-away-from-zero al write). Sin este redondeo, la
  // cotización mostraba 3 decimales (ej. 10883.015) mientras que el envío
  // creado guardaba 10883.02 — artifact solo de display, pero confuso.
  // Prisma.Decimal usa ROUND_HALF_UP por default (mismo criterio que PG).
  // El desglose queda en precisión completa (auditable); solo el número
  // publicado al cliente se lleva a precisión de moneda.
  const precioFinal = netoAcumulado.mul(IVA_AR_MULTIPLIER).toDecimalPlaces(2);

  return {
    costoCourierNativo: seco, // raw, sin cambios: la conciliación depende de este significado. DEUDA 158: renombrado de precioProveedor.
    precioFinal,
    desglose: {
      secoNeto,
      baseConIntermediario,
      cascadaNeto: costoConMarkup,
      smoNeto,
      feeNeto,
      netoAcumulado,
    },
  };
}

export async function cotizar(input: CotizarInput): Promise<CotizarResult> {
  const { empresaId, cpOrigen: cpOrigenInput, cpDestino, provinciaDestino, paquetes, valorCarrito: bodyValorCarrito } = input;

  // Política de negocio: cotizar requiere una empresa específica.
  // Modo Dios "TODAS" no aplica acá (cada empresa tiene credenciales y reglas distintas).
  if (empresaId === null) {
    throw new Error('EmpresaRequerida: cotizar requiere una empresa específica. Modo Dios sin filtro no aplica acá.');
  }

  const pesoTotal = paquetes.reduce((acc: number, p: any) => acc + (parseFloat(p.pesoKg) || 1), 0);
  const valorCarrito = bodyValorCarrito || paquetes.reduce((acc: number, p: any) => acc + (parseFloat(p.valorDeclarado) || 0), 0);

  // Cargamos empresa + depósitos en una sola query. El predeterminado se usa
  // si el caller no pasó cpOrigen explícito (DEUDA 4).
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: {
      credenciales: { where: { activo: true } },
      reglasRuteo: { where: { activa: true }, orderBy: { prioridad: 'asc' } },
      depositos: {
        where: { eliminado: false, activo: true, esPredeterminado: true },
        take: 1,
      },
    },
  });

  // Resolver cpOrigen efectivo: input explícito > predeterminado de la empresa.
  let cpOrigen = cpOrigenInput;
  if (!cpOrigen) {
    const depositoPred = empresa?.depositos?.[0];
    if (!depositoPred) {
      throw new Error('DepositoRequerido: la empresa no tiene depósito predeterminado activo. Configurá uno en /configuracion/depositos.');
    }
    cpOrigen = depositoPred.codigoPostal;
  }
  const couriersConfigurados: any[] = empresa?.credenciales || [];
  const reglasEmpresa: any[] = empresa?.reglasRuteo || [];
  const motorBase = empresa?.ordenamientoDefault || "MOTOR_PRECIO";

  if (couriersConfigurados.length === 0) {
    // Empresa válida pero sin credenciales configuradas: lista vacía sin error.
    return { domicilio: [], sucursal: [], cambio: [], devolucion: [] };
  }

  // TODO DEUDA 29 Sub-fase 4: pre-filtro real con capacidades del Courier
  // (puedeEntregarDomicilio, puedeEntregarSucursal, y la modalidad de First-Mile
  // resuelta a nivel par via DepositoCourierConfig.recogeViaConsolidador +
  // Deposito.courierRecolectorId).
  const couriersAptos = couriersConfigurados;

  let opcionesDomicilio: OpcionTarifa[] = [];
  let opcionesSucursal: OpcionTarifa[] = [];

  // Torre de Control Metrica 2.3 (DEUDA 39, 2026-06-05): la consulta a
  // MetricaSLA se hace adentro de calcularPromesaCalibrada() como nivel 3
  // de fallback. El cotizador ya no la consulta directamente aqui.
  // (El cron metricas-sla sigue corriendo y poblando MetricaSLA. Se usa
  // como triple fallback dentro del helper.)

  // depositoId del predeterminado activo, si existe. Se usa para nivel 1
  // de calibracion (deposito + courier + provincia). Decision A.2: usamos
  // siempre el predeterminado, sin importar si el caller paso cpOrigen
  // explicito. Funciona para 99% de los flujos (e-commerce usa predeterminado).
  const depositoIdParaCalibracion: number | null = empresa?.depositos?.[0]?.id ?? null;

  // DEUDA 10 Paso 2: resolver nombreCourier -> Courier.id real en UNA query
  // (config.id es CredencialCourier.id, NO Courier.id). Map para el upsert del historico.
  // DEUDA 91 (FILTER): la MISMA query trae los servicios activos+mapeados por courier.
  // Un servicio se poll'ea solo si BOTH: (1) tecnicamente soportado (capacidadTecnicaMapeada
  // != null) AND (2) admin lo prendio (activo=true). Ademas se AND'ea con el flag
  // per-empresa (CredencialCourier.ofrece*), que queda como tercer gate cliente-level.
  const nombresCouriers = couriersAptos.map((c: any) => c.nombreCourier);
  const ahoraCotizacion = new Date();
  const couriersReales = await prisma.courier.findMany({
    where: { nombre: { in: nombresCouriers } },
    include: {
      servicios: {
        where: { activo: true, capacidadTecnicaMapeada: { not: null } },
      },
      // DEUDA 107 capa 1: intermediario activo y vigente al momento de la cotizacion.
      // Se usa en aplicarMarkup para la cascada (Modelo A). Modelo B lo ignora.
      intermediarios: {
        where: {
          activo: true,
          vigenciaDesde: { lte: ahoraCotizacion },
          OR: [
            { vigenciaHasta: null },
            { vigenciaHasta: { gte: ahoraCotizacion } },
          ],
        },
      },
    },
  });
  const mapaCourierIds = new Map<string, number>(couriersReales.map((c) => [c.nombre, c.id]));

  // DEUDA 91 (FILTER): courier canonico -> set de capacidades tecnicas activas+mapeadas.
  // Las capacidades usan el mismo vocabulario que el param tipoEntrega del adapter
  // ("domicilio", "sucursal", "cambio", "devolucion"), asi que la lookup es directa:
  // mapaCapacidades.get(nombreNormalizado)?.has("sucursal").
  const mapaCapacidades = new Map<string, Set<string>>();
  for (const courier of couriersReales) {
    const claveNormalizada = normalizarParaComparacion(courier.nombre);
    const capacidades = new Set<string>();
    for (const servicio of courier.servicios) {
      if (servicio.capacidadTecnicaMapeada) capacidades.add(servicio.capacidadTecnicaMapeada);
    }
    mapaCapacidades.set(claveNormalizada, capacidades);
    if (capacidades.size === 0) {
      console.warn(`[cotizador] Courier ${courier.nombre} sin servicios activos mapeados — no se cotiza.`);
    }
  }

  // DEUDA 144: preserva el codigoServicio canónico por (courier, tipoEntrega), que
  // mapaCapacidades colapsa. 1:1 hoy (un servicio entrega_* activo por capacidad).
  // Filtra grupo="entrega": la logística inversa también mapea a "sucursal" y NO debe
  // resolverse acá. Si algún día hay 2+ entrega_* activos con la misma capacidad, toma
  // el primero (determinista) — registrar deuda para desambiguar entonces.
  const mapaCodigoServicio = new Map<string, { domicilio?: string; sucursal?: string }>();
  for (const courier of couriersReales) {
    const clave = normalizarParaComparacion(courier.nombre);
    const bucket: { domicilio?: string; sucursal?: string } = {};
    for (const s of courier.servicios) {
      if (s.grupo !== "entrega") continue;
      if (s.capacidadTecnicaMapeada === "domicilio" && !bucket.domicilio) bucket.domicilio = s.codigoServicio;
      else if (s.capacidadTecnicaMapeada === "sucursal" && !bucket.sucursal) bucket.sucursal = s.codigoServicio;
    }
    mapaCodigoServicio.set(clave, bucket);
  }

  // DEUDA 10 Paso 2 (fire-and-forget): persiste el ultimo precio CRUDO conocido por
  // (courier, cpOrigen, cpDestino, pesoKg entero, modalidad). Upsert = pisa la fila si existe.
  // No await, no rompe la cotizacion si falla (igual que registroCoberturaVacia).
  const guardarHistorico = (courierIdReal: number | undefined, precioCrudo: number, modalidad: string) => {
    if (!courierIdReal || !cpOrigen) return;
    const pesoEntero = Math.floor(pesoTotal);
    prisma.historicoCotizaciones
      .upsert({
        where: {
          courierId_cpOrigen_cpDestino_pesoKg_modalidad: {
            courierId: courierIdReal,
            cpOrigen: cpOrigen,
            cpDestino: cpDestino,
            pesoKg: pesoEntero,
            modalidad: modalidad,
          },
        },
        update: { precio: precioCrudo, createdAt: new Date() },
        create: {
          courierId: courierIdReal,
          cpOrigen: cpOrigen,
          cpDestino: cpDestino,
          pesoKg: pesoEntero,
          precio: precioCrudo,
          modalidad: modalidad,
        },
      })
      .catch((err) => {
        console.warn("[cotizador] No se pudo guardar historico de cotizacion:", err);
      });
  };

  // DEUDA 73 capa 2: fee Shipro (neto) resuelto UNA VEZ por cotización — es empresa-level,
  // no varía por courier. calcularFeeOperacion es idempotente y devuelve feePreIva (SIN IVA)
  // que aplicarMarkup acumula al netoAcumulado. Para FIJO el basePrecio se ignora, así que
  // pasamos Decimal(0). FOLLOW-UP: si algún día se usa un fee PORCENTAJE, hay que llamarlo
  // por courier con la tarifa neta como base (hoy no aplica — solo FIJO en producción).
  const feeResult = await calcularFeeOperacion(empresaId, new Prisma.Decimal(0));
  const feeShiproNeto = feeResult?.feePreIva ?? new Prisma.Decimal(0);

  // DEUDA 129 + DEUDA 132 Paso 5a (per-courier fallback): construye una OpcionTarifa
  // de rescate para un courier que no pudo cotizar. Resolución de tarifa:
  // CredencialCourier.tarifaPlanaRespaldoCourier > null (no push).
  // SIN fallback a un default per-empresa (el campo legacy per-empresa fue
  // dropeado en Paso 5a): si el courier no tiene tarifa configurada, NO emitimos una opción
  // de rescate para él — skip explícito, más honesto que un placeholder.
  // SLA vía el mismo helper calibrado que el path real (calcularPromesaCalibrada);
  // si el helper también rompe, cae a 72h (nivel 4 del cuádruple fallback).
  // El comprador ve el nombre real del courier — nunca sabe que falló la cotización.
  const construirOpcionFallback = async (
    config: any,
    tipo: "domicilio" | "sucursal"
  ): Promise<OpcionTarifa | null> => {
    const tarifa = config.tarifaPlanaRespaldoCourier as Prisma.Decimal | null | undefined;
    if (!tarifa || !tarifa.gt(0)) return null;

    let slaHorasFallback: number;
    try {
      const promesa = await calcularPromesaCalibrada(
        config.id,
        depositoIdParaCalibracion,
        provinciaDestino,
        config.nombreCourier
      );
      slaHorasFallback = promesa.slaHoras;
    } catch {
      slaHorasFallback = 72;
    }
    const textoFallback = await calcularFechaEstimada(slaHorasFallback);

    return {
      id: `fallback-${config.nombreCourier.toLowerCase()}-${tipo}`,
      courier: config.nombreCourier,
      modalidad: "Estándar",
      precioFinal: tarifa,
      // DEUDA 156: en fallback/rescate NO aplicamos descuento (política simple/segura:
      // el descuento vive sobre la cotización real del courier; sobre una tarifa de
      // rescate ya es un fallback comercial y modificarla puede resultar en $0 al buyer).
      precioFinalBuyer: tarifa,
      costoCourierNativo: new Prisma.Decimal(0),
      slaHs: slaHorasFallback,
      fechaEstimadaString: textoFallback,
      etiquetaSla: "Tiempo estimado",
      esFallback: true,
    };
  };

  for (const config of couriersAptos) {
    try {
      const nombreNormalizado = normalizarParaComparacion(config.nombreCourier);

      // Si el cliente usa credenciales propias inválidas, parsearCredencialesPropias
      // lanza y este courier se salta (no aparece en las opciones).
      // NO hay fallback a Shipro aquí — política de protección financiera.
      const credenciales = config.usaCredencialesPropias
        ? parsearCredencialesPropias(nombreNormalizado, config.credencialesJson)
        : obtenerCredencialesShipro(nombreNormalizado);

      const motorCourier = CourierFactory.crear(nombreNormalizado, credenciales);

      const courierReal = couriersReales.find((c: any) => c.nombre === config.nombreCourier);

      // FASE 2 motor mov 2 (2026-08-03): 3 valores resueltos desde las nuevas
      // fuentes de config (docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md). La
      // cascada de aplicarMarkup queda sync/pure — sólo cambia de dónde vienen
      // sus inputs:
      //   - Markup Shipro (%): MarkupShiproVigencia global vigente, con
      //     resolverMarkupCourierPorcentaje: por courier desde MarkupCourier
      //     (modo HEREDA→global, PROPIO→valor). Rama B gate: sin markup Shipro.
      //     DEUDA 157 Pieza 3 (2026-09-01): reemplaza el path viejo per-credencial.
      //   - SMO (neto): SmoCourier del courier ejecutor, vigente. Sin fila → 0
      //     con warn. NO se dual-read el legacy Courier.smoPrecioAlClienteConIva.
      //   - Intermediario (%): owner-keyed via credencial.propietarioCourierId,
      //     no ejecutor. Fallback ejecutor-keyed para configs legacy sin
      //     propietario seteado (browse/quote no rompe; creación de envío ya
      //     bloquea legacy null-owner Rama A con BLOQUEADO_CREDENCIAL, sub-piece 3).
      // Ver lib/utils/resolvers-tarifa.ts para los contratos completos.
      const markupShiproPorcentaje = courierReal
        ? await resolverMarkupCourierPorcentaje(courierReal.id, config.usaCredencialesPropias)
        : 0;
      const smoNeto = courierReal
        ? await resolverSmoNeto(courierReal.id)
        : new Prisma.Decimal(0);
      const intermediarioMarkupPorcentaje = courierReal
        ? await resolverIntermediarioMarkupPorcentaje(config, courierReal.id)
        : null;

      const calcularPrecios = (costoSecoCourier: number) =>
        aplicarMarkup(costoSecoCourier, {
          usaCredencialesPropias: config.usaCredencialesPropias,
          ajusteTarifaPorcentaje: markupShiproPorcentaje,
          markupFijo: config.markupFijo,
          // DEUDA 123 mov 2 (2026-08-03): la bandera IVA la aporta el ADAPTER,
          // no la credencial. Quien sabe si la API del courier devuelve neto o
          // gross es el adapter (declaración estática, movement 1 commit 88abb30).
          // Elimina el footgun del default true de CredencialCourier.tarifaIncluyeIva
          // que en el deploy FASE 2 causó un ~17% UNDERCHARGE en las credenciales
          // recién creadas fuera del seed.
          tarifaIncluyeIva: motorCourier.tarifaApiIncluyeIva,
          intermediarioMarkupPorcentaje,
          smoNeto,
          feeShiproNeto,
        });

      // Torre de Control Metrica 2.3 (DEUDA 39, 2026-06-05): asignacion de
      // SLA via cuadruple fallback del helper compartido.
      // - Nivel 1: P75 por (deposito, courier, provincia) si muestra >= 10
      // - Nivel 2: P75 por (courier, provincia) si muestra >= 10
      // - Nivel 3: promedio MetricaSLA por (courier, provincia) si existe
      // - Nivel 4: hardcoded por courier (Mocis 24h, resto 72h)
      // Decision B.2: etiqueta UX binaria mantenida. esSlaReal = true si la
      // calibracion es real (nivel 1 o 2), false si es promedio o hardcoded.
      const promesaResult = await calcularPromesaCalibrada(
        config.id,
        depositoIdParaCalibracion,
        provinciaDestino,
        config.nombreCourier
      );
      const slaHorasFinal = promesaResult.slaHoras;
      const esSlaReal = promesaResult.esCalibracionReal;

      const textoUXLlegada = await calcularFechaEstimada(slaHorasFinal);

      // DEUDA 91 (FILTER): tres condiciones deben cumplirse — courier tiene el servicio
      // activo+mapeado (registry/admin), Y el cliente lo tiene habilitado (per-empresa).
      const capacidadesCourier = mapaCapacidades.get(nombreNormalizado);
      const courierPuedeDomicilio = capacidadesCourier?.has("domicilio") ?? false;
      const courierPuedeSucursal = capacidadesCourier?.has("sucursal") ?? false;

      if (config.ofreceDomicilio !== false && courierPuedeDomicilio) {
        try {
          const opciones = await motorCourier.cotizar({ cpOrigen, cpDestino, paquetes, tipoEntrega: 'domicilio' });
          for (const op of opciones) {
            const precios = calcularPrecios(op.precioNeto);
            guardarHistorico(mapaCourierIds.get(config.nombreCourier), op.precioNeto, "domicilio");
            opcionesDomicilio.push({
              id: `dom-${nombreNormalizado}-${op.servicio.replace(/\s/g, '')}`,
              courier: config.nombreCourier.toUpperCase(),
              modalidad: `Entrega a Domicilio (${op.servicio})`,
              codigoServicio: mapaCodigoServicio.get(nombreNormalizado)?.domicilio,
              precioFinal: precios.precioFinal,
              // DEUDA 156: precio buyer-facing con descuento del cliente aplicado
              // (piso $0). precioFinal queda intacto — Shipro factura el chain full.
              precioFinalBuyer: aplicarDescuentoCliente(precios.precioFinal, config),
              costoCourierNativo: precios.costoCourierNativo,
              slaHs: slaHorasFinal,
              fechaEstimadaString: textoUXLlegada,
              etiquetaSla: esSlaReal ? 'Basado en datos reales' : 'Tiempo estimado',
              // Propagar el desglose que ya computó aplicarMarkup — crear.ts
              // lo consume para persistir el breakdown (fee/logistica/IVA)
              // sin recomputar. Único source of truth.
              // DEUDA 153: secoNeto + baseConIntermediario también propagados
              // para el audit trail interno (crear.ts los usa para poblar
              // tarifaCourierBaseNeta / markupIntermediarioPorcentajeAplicado / baseConIntermediarioAplicado).
              desglose: {
                secoNeto: precios.desglose.secoNeto,
                baseConIntermediario: precios.desglose.baseConIntermediario,
                cascadaNeto: precios.desglose.cascadaNeto,
                smoNeto: precios.desglose.smoNeto,
                feeNeto: precios.desglose.feeNeto,
                netoAcumulado: precios.desglose.netoAcumulado,
              },
            });
          }
        } catch (e: any) {
          // DEUDA 129: courier falló al cotizar domicilio. Logueamos la causa
          // (timeout? credencial vencida? body malformado?) y empujamos una
          // opción de rescate con el nombre real del courier + tarifaPlana
          // (per-courier > per-empresa) para que el comprador no perciba el fallo.
          console.warn("[cotizador] courier falló:", e instanceof Error ? e.message : String(e));
          const fb = await construirOpcionFallback(config, "domicilio");
          if (fb) { fb.codigoServicio = mapaCodigoServicio.get(nombreNormalizado)?.domicilio; opcionesDomicilio.push(fb); }
        }
      }

      if (config.ofreceSucursal !== false && courierPuedeSucursal) {
        try {
          const opciones = await motorCourier.cotizar({ cpOrigen, cpDestino, paquetes, tipoEntrega: 'sucursal' });
          for (const op of opciones) {
            const precios = calcularPrecios(op.precioNeto);
            guardarHistorico(mapaCourierIds.get(config.nombreCourier), op.precioNeto, "sucursal");
            opcionesSucursal.push({
              id: `suc-${nombreNormalizado}`,
              courier: config.nombreCourier.toUpperCase(),
              modalidad: `Retiro en Sucursal (${op.servicio})`,
              codigoServicio: mapaCodigoServicio.get(nombreNormalizado)?.sucursal,
              precioFinal: precios.precioFinal,
              // DEUDA 156: precio buyer-facing con descuento del cliente aplicado
              // (piso $0). precioFinal queda intacto — Shipro factura el chain full.
              precioFinalBuyer: aplicarDescuentoCliente(precios.precioFinal, config),
              costoCourierNativo: precios.costoCourierNativo,
              slaHs: slaHorasFinal,
              fechaEstimadaString: textoUXLlegada,
              etiquetaSla: esSlaReal ? 'Basado en datos reales' : 'Tiempo estimado',
              // Propagar el desglose (idem push de domicilio arriba, incluye
              // secoNeto + baseConIntermediario para el audit trail — DEUDA 153).
              desglose: {
                secoNeto: precios.desglose.secoNeto,
                baseConIntermediario: precios.desglose.baseConIntermediario,
                cascadaNeto: precios.desglose.cascadaNeto,
                smoNeto: precios.desglose.smoNeto,
                feeNeto: precios.desglose.feeNeto,
                netoAcumulado: precios.desglose.netoAcumulado,
              },
            });
          }
        } catch (e) {
          // DEUDA 129: courier falló al cotizar sucursal. Misma disciplina que
          // el catch de domicilio: log + fallback con nombre real del courier.
          console.warn("[cotizador] courier falló:", e instanceof Error ? e.message : String(e));
          const fb = await construirOpcionFallback(config, "sucursal");
          if (fb) { fb.codigoServicio = mapaCodigoServicio.get(nombreNormalizado)?.sucursal; opcionesSucursal.push(fb); }
        }
      }
    } catch (errorFatal: any) {
      // DEUDA 129: fallo courier-level ANTES de intentar sucursal o domicilio
      // (ej. credencial malformada, CourierFactory rechazó). Logueamos + pusheamos
      // fallback en AMBAS modalidades habilitadas por el cliente para que el
      // courier no desaparezca del checkout aunque haya caído entero.
      console.warn("[cotizador] courier falló:", errorFatal instanceof Error ? errorFatal.message : String(errorFatal));
      if (config.ofreceDomicilio !== false) {
        const fbDom = await construirOpcionFallback(config, "domicilio");
        if (fbDom) { fbDom.codigoServicio = mapaCodigoServicio.get(normalizarParaComparacion(config.nombreCourier))?.domicilio; opcionesDomicilio.push(fbDom); }
      }
      if (config.ofreceSucursal !== false) {
        const fbSuc = await construirOpcionFallback(config, "sucursal");
        if (fbSuc) { fbSuc.codigoServicio = mapaCodigoServicio.get(normalizarParaComparacion(config.nombreCourier))?.sucursal; opcionesSucursal.push(fbSuc); }
      }
      continue;
    }
  }

  // EL CEREBRO DE RUTEO
  let reglaAplicada: any = null;

  for (const regla of reglasEmpresa) {
    let condicionCumplida = false;
    let valorEval = 0;

    if (regla.condicionVariable === "VALOR_CARRITO") valorEval = valorCarrito;
    if (regla.condicionVariable === "PESO_PAQUETE") valorEval = pesoTotal;

    if (regla.condicionOperador === "MAYOR_A" && valorEval > (regla.condicionValor1 || 0)) condicionCumplida = true;
    if (regla.condicionOperador === "MENOR_A" && valorEval < (regla.condicionValor1 || 0)) condicionCumplida = true;
    if (regla.condicionOperador === "IGUAL_A" && valorEval === (regla.condicionValor1 || 0)) condicionCumplida = true;

    if (condicionCumplida) { reglaAplicada = regla; break; }
  }

  const aplicarEstrategia = (opciones: OpcionTarifa[]) => {
    if (reglaAplicada) {
      if (reglaAplicada.accionTipo === "PRIORIZAR_SLA") return opciones.sort((a, b) => a.slaHs - b.slaHs);
      if (reglaAplicada.accionTipo === "PRIORIZAR_PRECIO") return opciones.sort((a, b) => a.precioFinal.cmp(b.precioFinal));
    }
    if (motorBase === "MOTOR_SLA") return opciones.sort((a, b) => a.slaHs - b.slaHs);
    return opciones.sort((a, b) => a.precioFinal.cmp(b.precioFinal));
  };

  let finalDomicilio = aplicarEstrategia([...opcionesDomicilio]);
  let finalSucursal = aplicarEstrategia([...opcionesSucursal]);

  if (reglaAplicada && reglaAplicada.accionTipo === "FORZAR_COURIER" && reglaAplicada.accionValor) {
    // DEUDA 101: lookup dinamico por id contra couriersReales (ya cargado en L201),
    // en vez del mapeo hardcodeado "1"->ANDREANI/"2"->MOCI'S. Cualquier courier que
    // la empresa tenga activo se puede forzar sin tocar este archivo.
    const idCourierAForzar = parseInt(reglaAplicada.accionValor, 10);
    const courierForzado = Number.isFinite(idCourierAForzar)
      ? couriersReales.find((c) => c.id === idCourierAForzar)
      : null;
    if (courierForzado) {
      const nombreEsperado = courierForzado.nombre.toUpperCase();
      finalDomicilio = finalDomicilio.filter((op) => op.courier === nombreEsperado);
      finalSucursal = finalSucursal.filter((op) => op.courier === nombreEsperado);
    }
  }

  // DEUDA 32+37 (Fase J): deteccion de cobertura vacia (ningun courier pudo
  // cotizar) + registro en BD para auditoria de la red logistica. El insert
  // es best-effort (fire-and-forget): si la BD falla, NO rompemos la
  // cotizacion. Principio operativo: que la venta no se pierda nunca.
  const coberturaVacia = finalDomicilio.length === 0 && finalSucursal.length === 0;

  if (coberturaVacia) {
    const primero = input.paquetes[0];
    prisma.registroCoberturaVacia
      .create({
        data: {
          cpDestino: input.cpDestino,
          pesoKg: pesoTotal,
          largoCm: primero?.largoCm ?? null,
          anchoCm: primero?.anchoCm ?? null,
          altoCm: primero?.altoCm ?? null,
          origen: input.origen ?? null,
          empresaId: input.empresaId,
        },
      })
      .catch((err) => {
        console.warn("[cotizador] No se pudo registrar cobertura vacia:", err);
      });
  }

  return {
    domicilio: finalDomicilio,
    sucursal: finalSucursal,
    cambio: [],
    devolucion: [],
    metadata: { reglaEjecutada: reglaAplicada?.nombre || "Motor Base" },
    coberturaVacia,
  };
}
