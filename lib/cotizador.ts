import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
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
}

export interface OpcionTarifa {
  id: string;
  courier: string;
  modalidad: string;
  precioFinal: number;
  precioProveedor: number;
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
  // (puedeEntregarDomicilio, puedeEntregarSucursal, modoFirstMile + recolector, etc.).
  // El filtro previo por tipoAlcance/provinciasCobertura era inerte (todas vacías) y
  // los campos fueron eliminados del schema en commit 1.A.
  const couriersAptos = couriersConfigurados;

  let opcionesDomicilio: OpcionTarifa[] = [];
  let opcionesSucursal: OpcionTarifa[] = [];

  // Búsqueda de métricas SLA reales pre-calculadas
  const metricasDb = await prisma.metricaSLA.findMany({
    where: { provinciaDestino: provinciaDestino || "" }
  });

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

      let porcentajeMarkup = config.ajusteTarifaPorcentaje || 0;
      let fijoMarkup = config.markupFijo || 0;

      const calcularPrecios = (costoSecoCourier: number) => {
        let costoConMarkup = config.usaCredencialesPropias ? costoSecoCourier + fijoMarkup : costoSecoCourier + (costoSecoCourier * (porcentajeMarkup / 100)) + fijoMarkup;
        return { precioProveedor: costoSecoCourier, precioFinal: config.tarifaIncluyeIva ? costoConMarkup : costoConMarkup * 1.21 };
      };

      // ASIGNACIÓN DE SLA
      let slaHorasFinal = config.slaPromedioHs || (nombreNormalizado === 'mocis' ? 24 : 72);
      let esSlaReal = false;

      const metricaEncontrada = metricasDb.find(m => m.courierId === config.id);
      if (metricaEncontrada && metricaEncontrada.muestraEnvios >= 10) {
        slaHorasFinal = metricaEncontrada.slaPromedioHs;
        esSlaReal = true;
      }

      const textoUXLlegada = await calcularFechaEstimada(slaHorasFinal);

      if (config.ofreceDomicilio !== false) {
        try {
          const opciones = await motorCourier.cotizar({ cpOrigen, cpDestino, paquetes, tipoEntrega: 'domicilio' });
          for (const op of opciones) {
            const precios = calcularPrecios(op.precioNeto);
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

      if (config.ofreceSucursal !== false) {
        try {
          const opciones = await motorCourier.cotizar({ cpOrigen, cpDestino, paquetes, tipoEntrega: 'sucursal' });
          for (const op of opciones) {
            const precios = calcularPrecios(op.precioNeto);
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
      if (reglaAplicada.accionTipo === "PRIORIZAR_PRECIO") return opciones.sort((a, b) => a.precioFinal - b.precioFinal);
    }
    if (motorBase === "MOTOR_SLA") return opciones.sort((a, b) => a.slaHs - b.slaHs);
    return opciones.sort((a, b) => a.precioFinal - b.precioFinal);
  };

  let finalDomicilio = aplicarEstrategia([...opcionesDomicilio]);
  let finalSucursal = aplicarEstrategia([...opcionesSucursal]);

  if (reglaAplicada && reglaAplicada.accionTipo === "FORZAR_COURIER" && reglaAplicada.accionValor) {
    const idCourierAForzar = reglaAplicada.accionValor;
    let nombreEsperado = "";
    if (idCourierAForzar === "1") nombreEsperado = "ANDREANI";
    if (idCourierAForzar === "2") nombreEsperado = "MOCI'S";
    if (nombreEsperado) {
      finalDomicilio = finalDomicilio.filter(op => op.courier === nombreEsperado);
      finalSucursal = finalSucursal.filter(op => op.courier === nombreEsperado);
    }
  }

  return {
    domicilio: finalDomicilio,
    sucursal: finalSucursal,
    cambio: [],
    devolucion: [],
    metadata: { reglaEjecutada: reglaAplicada?.nombre || "Motor Base" }
  };
}
