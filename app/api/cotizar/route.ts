import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { resolverContext } from "@/lib/auth-context";

// =================================================================
// HELPER: CÁLCULO DE DÍAS HÁBILES (Soporta Feriados DB)
// =================================================================
async function calcularFechaEstimada(horasSla: number) {
  const diasHabilesRequeridos = Math.max(1, Math.ceil(horasSla / 24)); 
  
  // Traemos los feriados cargados en la base de datos
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
          
          if (!esFinDeSemana && !esFeriado) { 
              agregados++;
          }
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
  return `Llega entre el ${fechaMin.toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric'})} y el ${fechaMax.toLocaleDateString('es-AR', opcionesFormato)}`;
}

function obtenerCredencialesShipro(courier: string) {
  const c = courier.toLowerCase().replace(/['\s]/g, ''); 
  if (c === 'andreani') {
    return { 
      username: process.env.ANDREANI_USER?.trim() || '', password: process.env.ANDREANI_PASS?.trim() || '', cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
      id_sucursal_origen: process.env.ANDREANI_SUCURSAL_ORIGEN?.trim() || '', contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || '',
      contrato_sucursal: process.env.ANDREANI_CONTRATO_SUC?.trim() || ''
    };
  }
  if (c === 'mocis') return { clientApi: process.env.MOCIS_CLIENT_API?.trim() || '', clientSecret: process.env.MOCIS_CLIENT_SECRET?.trim() || '' };
  return {};
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = resolverContext(request, body.filtroEmpresa);
    if (ctx instanceof NextResponse) return ctx;

    const { cpOrigen, cpDestino, provinciaDestino, paquetes, valorCarrito: bodyValorCarrito } = body;

    const pesoTotal = paquetes.reduce((acc: number, p: any) => acc + (parseFloat(p.pesoKg) || 1), 0);
    const valorCarrito = bodyValorCarrito || paquetes.reduce((acc: number, p: any) => acc + (parseFloat(p.valorDeclarado) || 0), 0);

    let couriersConfigurados: any[] = [];
    let reglasEmpresa: any[] = [];
    let motorBase = "MOTOR_PRECIO";

    if (ctx.empresaId !== null) {
      const empresa = await prisma.empresa.findUnique({
        where: { id: ctx.empresaId },
        include: { 
          credenciales: { where: { activo: true } },
          reglasRuteo: { where: { activa: true }, orderBy: { prioridad: 'asc' } }
        }
      });
      // @ts-ignore
      couriersConfigurados = empresa?.credenciales || [];
      reglasEmpresa = empresa?.reglasRuteo || [];
      motorBase = empresa?.ordenamientoDefault || "MOTOR_PRECIO";
    }

    if (couriersConfigurados.length === 0) return NextResponse.json({ domicilio: [], sucursal: [], cambio: [], devolucion: [] });

    const couriersAptos = couriersConfigurados.filter(courier => {
      if (courier.tipoAlcance === "NACIONAL" || courier.tipoAlcance === "REGIONAL") {
          if (!provinciaDestino) return true;
          try {
              const provincias = JSON.parse(courier.provinciasCobertura || '[]');
              if (provincias.length === 0) return true; 
              return provincias.includes(provinciaDestino);
          } catch (e) { return true; }
      }
      return true; 
    });

    let opcionesDomicilio: any[] = [];
    let opcionesSucursal: any[] = [];

    // ==========================================================
    // BÚSQUEDA DE MÉTRICA DE VERDAD (Lectura ultrarrápida)
    // ==========================================================
    const metricasDb = await prisma.metricaSLA.findMany({
       where: { provinciaDestino: provinciaDestino || "" }
    });

    for (const config of couriersAptos) {
      try {
        const nombreNormalizado = config.nombreCourier.replace(/['\s]/g, '').toLowerCase();
        
        let credenciales = config.usaCredencialesPropias ? JSON.parse(config.credencialesJson || '{}') : obtenerCredencialesShipro(nombreNormalizado);
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

        const textoUXLlegada = await calcularFechaEstimada(slaHorasFinal); // <- Usamos 'await' por los feriados

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
                  id: `suc-${nombreNormalizado}`, courier: config.nombreCourier.toUpperCase(), modalidad: `Retiro en Sucursal (${op.servicio})`,
                  precioFinal: precios.precioFinal,
                  precioProveedor: precios.precioProveedor,
                  slaHs: slaHorasFinal,
                  fechaEstimadaString: textoUXLlegada,
                  etiquetaSla: esSlaReal ? 'Basado en datos reales' : 'Tiempo estimado'
                });
            }
          } catch (e) {}
        }
      } catch (errorFatal: any) { continue; }
    }

    // EL CEREBRO DE RUTEO 
    let reglaAplicada = null;

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

    const aplicarEstrategia = (opciones: any[]) => {
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

    return NextResponse.json({ 
      domicilio: finalDomicilio, sucursal: finalSucursal, cambio: [], devolucion: [],
      metadata: { reglaEjecutada: reglaAplicada?.nombre || "Motor Base" }
    });

  } catch (error: any) {
    return NextResponse.json({ error: "Falla interna" }, { status: 500 });
  }
}