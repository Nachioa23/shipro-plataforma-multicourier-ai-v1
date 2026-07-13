import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import { calcularPromesaCalibrada } from "@/lib/utils/promesa-calibrada";
import type { Paquete } from "@/lib/couriers/CourierInterface";

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
  precioFinal: Prisma.Decimal;
  precioProveedor: Prisma.Decimal;
  slaHs: number;
  fechaEstimadaString: string;
  etiquetaSla: string;
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
 * credencial, devuelve { precioProveedor, precioFinal }. Misma formula que
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
}

const IVA_AR_MULTIPLIER = new Prisma.Decimal("1.21");

export function aplicarMarkup(
  costoSecoCourier: Prisma.Decimal | number,
  config: ConfigMarkup
): { precioProveedor: Prisma.Decimal; precioFinal: Prisma.Decimal } {
  const seco = costoSecoCourier instanceof Prisma.Decimal
    ? costoSecoCourier
    : new Prisma.Decimal(costoSecoCourier);
  const porcentajeMarkup = config.ajusteTarifaPorcentaje || 0;
  const fijoMarkup = config.markupFijo ?? new Prisma.Decimal(0);
  const costoConMarkup = config.usaCredencialesPropias
    ? seco.add(fijoMarkup)
    : seco.add(seco.mul(porcentajeMarkup).div(100)).add(fijoMarkup);
  return {
    precioProveedor: seco,
    precioFinal: config.tarifaIncluyeIva ? costoConMarkup : costoConMarkup.mul(IVA_AR_MULTIPLIER),
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
  const couriersReales = await prisma.courier.findMany({
    where: { nombre: { in: nombresCouriers } },
    include: {
      servicios: {
        where: { activo: true, capacidadTecnicaMapeada: { not: null } },
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

      const calcularPrecios = (costoSecoCourier: number) =>
        aplicarMarkup(costoSecoCourier, {
          usaCredencialesPropias: config.usaCredencialesPropias,
          ajusteTarifaPorcentaje: config.ajusteTarifaPorcentaje,
          markupFijo: config.markupFijo,
          tarifaIncluyeIva: config.tarifaIncluyeIva,
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
              precioFinal: precios.precioFinal,
              precioProveedor: precios.precioProveedor,
              slaHs: slaHorasFinal,
              fechaEstimadaString: textoUXLlegada,
              etiquetaSla: esSlaReal ? 'Basado en datos reales' : 'Tiempo estimado'
            });
          }
        } catch (e: any) { }
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
              precioFinal: precios.precioFinal,
              precioProveedor: precios.precioProveedor,
              slaHs: slaHorasFinal,
              fechaEstimadaString: textoUXLlegada,
              etiquetaSla: esSlaReal ? 'Basado en datos reales' : 'Tiempo estimado'
            });
          }
        } catch (e) { }
      }
    } catch (errorFatal: any) { continue; }
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
