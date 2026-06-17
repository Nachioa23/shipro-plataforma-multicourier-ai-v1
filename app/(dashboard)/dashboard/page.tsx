"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { 
  LayoutDashboard, AlertCircle, Loader2, Eye, 
  Clock, PackageCheck, Filter, Timer, TrendingDown,
  Map, ArrowRightLeft, Target, Building2, Activity, Box,
  Headset, Truck, Store, MapPin, ZoomIn, X, BarChart, PieChart, 
  HeartHandshake, Smile, Meh, Frown, MessageSquare, ShieldCheck, 
  SearchCode, TrendingUp, Lightbulb, Calendar, CheckCircle2, Scale, Undo2, ListChecks, Check, MapPinned, LifeBuoy, Warehouse
} from 'lucide-react';

export default function Dashboard() {
  const { data: session } = useSession();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // MODO DIOS MEJORADO (Tolerante a Mayúsculas/Minúsculas)
  const rolUsuario = session?.user?.rol?.toLowerCase() || ''; 
  const esEquipoShipro = rolUsuario.includes('admin') || rolUsuario.includes('shipro');
  const tienePermiso = esEquipoShipro || rolUsuario.includes('gerente') || rolUsuario.includes('operador');

  const [empresasLista, setEmpresasLista] = useState<any[]>([]);
  const [empresaActivaId, setEmpresaActivaId] = useState<string | number>(session?.user?.empresaId || "TODAS");
  const [filtroTiempo, setFiltroTiempo] = useState('mes_actual');
  
  // MODAL DRILL-DOWN Y FILTROS INTERNOS
  const [metricaAnalisis, setMetricaAnalisis] = useState<string | null>(null);
  const [zonaSlaSeleccionada, setZonaSlaSeleccionada] = useState<any | null>(null); // ESTADO PARA M10 INTERACTIVO
  // Phase 4.b cleanup: npsDimension state eliminado (sin consumers tras Phase 2.3).
  
  // Phase 4.g cleanup: filtroRuteoDesde + Hasta + Servicio + Courier eliminados
  // (filtros cosmeticos sin wiring). DEUDA 65 documentada para implementacion
  // funcional en sesion separada (requiere decisiones de producto sobre mapping
  // modalidad UI vs schema, encoding tildes, y shape per-modal).

  // Phase 1.1.d (2026-06-12): nuevo state consumiendo endpoint Torre.
  // El proxy inyecta x-empresa-id de la sesion del usuario.
  // Backend: scope-aware via AuthContext.
  const [fugaRuteoMetrica, setFugaRuteoMetrica] = useState<any>(null);
  const [cargandoFugaRuteo, setCargandoFugaRuteo] = useState(true);

  // Phase 1.2.d (2026-06-13): metrica Desvio de Peso migrada al endpoint Torre
  // /api/torre-de-control/desvio-peso (scope-aware: cliente o shipro).
  const [desvioPesoMetrica, setDesvioPesoMetrica] = useState<any>(null);
  const [cargandoDesvioPeso, setCargandoDesvioPeso] = useState(true);

  // Phase 1.3.d (2026-06-13): metrica Efectividad 1ra Visita migrada al endpoint
  // Torre /api/torre-de-control/efectividad-primera-visita (scope-aware).
  const [efectividadMetrica, setEfectividadMetrica] = useState<any>(null);
  const [cargandoEfectividad, setCargandoEfectividad] = useState(true);

  // Phase 1.4.d (2026-06-13): metrica Tiempos Colecta (Card 9 nueva) consume
  // endpoint Torre /api/torre-de-control/tiempos-colecta (scope-aware).
  const [tiemposColectaMetrica, setTiemposColectaMetrica] = useState<any>(null);
  const [cargandoTiemposColecta, setCargandoTiemposColecta] = useState(true);

  // Phase 1.5.d (2026-06-13): metrica Promesa Calibrada (Card 10 nueva) consume
  // endpoint Torre /api/torre-de-control/promesa-calibrada (scope-aware).
  const [promesaCalibradaMetrica, setPromesaCalibradaMetrica] = useState<any>(null);
  const [cargandoPromesaCalibrada, setCargandoPromesaCalibrada] = useState(true);

  // Phase 2.1.d (2026-06-15): metrica Mapa SLA (Card 13) migrada al endpoint
  // Torre /api/torre-de-control/mapa-sla scope-aware (reemplaza slaStats legacy).
  const [mapaSlaMetrica, setMapaSlaMetrica] = useState<any>(null);
  const [cargandoMapaSla, setCargandoMapaSla] = useState(true);

  // Phase 2.2.d (2026-06-15): metrica Modalidades (Card 11 migrada) consume
  // endpoint Torre /api/torre-de-control/modalidades (scope-aware).
  // Card 11 agrupa las 8 canonicas en 3 buckets (Estandar/Same-Day/Sucursal).
  // Modal expande a paridad con Torre (D3): 8 canonicas + tablas porCourier/
  // porProvincia/porMes + Forward/Reverse split + warning Desconocidas.
  const [modalidadesMetrica, setModalidadesMetrica] = useState<any>(null);
  const [cargandoModalidades, setCargandoModalidades] = useState(true);

  // Phase 2.3.d (2026-06-15): metrica NPS Comprador (Card 14 migrada) consume
  // endpoint Torre /api/torre-de-control/nps-comprador (scope-aware).
  // Card 14 widget BLOQUE 4 full-width convertido a mini-Card en BLOQUE 3.
  // Modal nuevo expandido a paridad Torre (D1 gamma): Hero NPS + 3 bars
  // distribucion + Cruce SLA 3-tile + Friccion Entrega + 4 dimensiones
  // (Courier/Provincia/Modalidad/Mes) + topPromotores/topDetractores
  // separados verde/rojo. Legacy nps default L243 preservado (Phase 4 cleanup).
  const [npsCompradorMetrica, setNpsCompradorMetrica] = useState<any>(null);
  const [cargandoNpsComprador, setCargandoNpsComprador] = useState(true);

  // Phase 2.4.d (2026-06-15): metrica Tickets Mesa de Ayuda (Card 8 migrada)
  // consume endpoint Torre /api/torre-de-control/tickets-mesa-ayuda
  // (scope-aware). Card 8 rebindeada via tasaSoporteGlobal derive.
  // Modal Panel expandido a paridad Torre (D2 beta): Hero 2-tile + Distribucion
  // Estados + Origen + Top Motivos + tabla porCourier + Evolucion Mensual.
  // Legacy soporteStats default L268 preservado (Phase 4 cleanup).
  const [ticketsMesaAyudaMetrica, setTicketsMesaAyudaMetrica] = useState<any>(null);
  const [cargandoTicketsMesaAyuda, setCargandoTicketsMesaAyuda] = useState(true);

  // Phase 2.5.d (2026-06-15): metrica Concentracion Courier / Riesgo Courier
  // (Card 12 migrada) consume endpoint Torre
  // /api/torre-de-control/concentracion-courier (scope-aware).
  // Card 12 rebindeada al nuevo state. Deprecadas topCouriers + data.couriers
  // + data.nombresCouriers legacy derives (Phase 4 cleanup global).
  // Modal Panel expandido a paridad Torre: Hero Riesgo + HHI gauge + Insight
  // + Share of Wallet + Evolucion Mensual.
  const [concentracionCourierMetrica, setConcentracionCourierMetrica] = useState<any>(null);
  const [cargandoConcentracionCourier, setCargandoConcentracionCourier] = useState(true);
  // Phase 4.g cleanup: states filtroRuteoHasta + Servicio + Courier eliminados.

  useEffect(() => {
    if (esEquipoShipro) {
      fetch('/api/admin/empresas').then(res => res.json()).then(data => {
        if (Array.isArray(data)) setEmpresasLista(data);
      });
      setEmpresaActivaId("TODAS");
    } else {
      setEmpresaActivaId(session?.user?.empresaId?.toString() || "");
    }
  }, [esEquipoShipro, session]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!empresaActivaId || !tienePermiso) return;
      setLoading(true);
      try {
        // Phase 4.f.e: migrado a /api/torre-de-control/kpis-hero scope-aware.
        // resolverContext deriva empresaId del header x-empresa-id (proxy)
        // automaticamente, no requiere ?empresaId= explicito.
        const res = await fetch(`/api/torre-de-control/kpis-hero?rango=${filtroTiempo}`);
        if (res.ok) setMetrics(await res.json());
      } catch (error) {
        console.error("Error cargando dashboard:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, [empresaActivaId, filtroTiempo, tienePermiso]);

  // Phase 1.1.d (2026-06-12): fetch del endpoint Torre fuga-ruteo.
  // Scope auto-detectado: cliente o shipro segun sesion del proxy.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoFugaRuteo(true);
    fetch("/api/torre-de-control/fuga-ruteo")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setFugaRuteoMetrica(data);
        setCargandoFugaRuteo(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching fuga-ruteo:", err);
        setCargandoFugaRuteo(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 1.2.d: fetch desvio-peso desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoDesvioPeso(true);
    fetch("/api/torre-de-control/desvio-peso")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setDesvioPesoMetrica(data);
        setCargandoDesvioPeso(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching desvio-peso:", err);
        setCargandoDesvioPeso(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 1.3.d: fetch efectividad-primera-visita desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoEfectividad(true);
    fetch("/api/torre-de-control/efectividad-primera-visita")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setEfectividadMetrica(data);
        setCargandoEfectividad(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching efectividad:", err);
        setCargandoEfectividad(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 1.4.d: fetch tiempos-colecta desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoTiemposColecta(true);
    fetch("/api/torre-de-control/tiempos-colecta")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setTiemposColectaMetrica(data);
        setCargandoTiemposColecta(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching tiempos-colecta:", err);
        setCargandoTiemposColecta(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 1.5.d: fetch promesa-calibrada desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoPromesaCalibrada(true);
    fetch("/api/torre-de-control/promesa-calibrada")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setPromesaCalibradaMetrica(data);
        setCargandoPromesaCalibrada(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching promesa-calibrada:", err);
        setCargandoPromesaCalibrada(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 2.1.d: fetch mapa-sla desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoMapaSla(true);
    fetch("/api/torre-de-control/mapa-sla")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setMapaSlaMetrica(data);
        setCargandoMapaSla(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching mapa-sla:", err);
        setCargandoMapaSla(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 2.2.d: fetch modalidades desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoModalidades(true);
    fetch("/api/torre-de-control/modalidades")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setModalidadesMetrica(data);
        setCargandoModalidades(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching modalidades:", err);
        setCargandoModalidades(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 2.3.d: fetch nps-comprador desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoNpsComprador(true);
    fetch("/api/torre-de-control/nps-comprador")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setNpsCompradorMetrica(data);
        setCargandoNpsComprador(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching nps-comprador:", err);
        setCargandoNpsComprador(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 2.4.d: fetch tickets-mesa-ayuda desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoTicketsMesaAyuda(true);
    fetch("/api/torre-de-control/tickets-mesa-ayuda")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setTicketsMesaAyudaMetrica(data);
        setCargandoTicketsMesaAyuda(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching tickets-mesa-ayuda:", err);
        setCargandoTicketsMesaAyuda(false);
      });
  }, [tienePermiso, empresaActivaId]);

  // Phase 2.5.d: fetch concentracion-courier desde endpoint Torre.
  useEffect(() => {
    if (!tienePermiso) return;
    setCargandoConcentracionCourier(true);
    fetch("/api/torre-de-control/concentracion-courier")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setConcentracionCourierMetrica(data);
        setCargandoConcentracionCourier(false);
      })
      .catch(err => {
        console.error("[Panel] error fetching concentracion-courier:", err);
        setCargandoConcentracionCourier(false);
      });
  }, [tienePermiso, empresaActivaId]);

  if (!tienePermiso) {
    return (
      <div className="flex flex-col h-full bg-gray-50 items-center justify-center p-8 text-center">
        <AlertCircle className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800">Acceso Restringido</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-50 items-center justify-center p-8">
        <Loader2 className="w-12 h-12 animate-spin text-[#233b6b] mb-4" />
        <p className="font-bold text-gray-600">Calculando métricas logísticas...</p>
      </div>
    );
  }

  // ================= EXTRACCIÓN DE DATOS =================
  const data = metrics || {};
  const formatPesos = (monto: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(monto || 0);

  // Phase 4.b cleanup: 6 legacy defaults eliminados (ruteoStats, aforoStats,
  // efectividadStats, soporteStats, nps, slaStats — sin consumers JSX tras
  // Phases 1.1-2.4 que migraron al patron scope-aware).
  
  // ACA INYECTAMOS LA VARIABLE DEL MÓDULO 10
  // slaStats legacy default eliminado en Phase 4.b (sin consumers tras Phase 2.1).

  let couriersLista: string[] = [];
  if (data.nombresCouriers) {
    couriersLista = data.nombresCouriers.map((c:any) => c.nombre);
  }

  // M8: CONEXIÓN REAL DE MODALIDADES
  // Phase 4.b cleanup: enviosTotales global derive + pctSameDay/pctSucursal/
  // pctEstandar + data.modalidades parse eliminados. Card 11 + modal
  // Modalidades migrados a modalidadesMetrica scope-aware en Phase 2.2
  // (V2 family pctSameDayV2/pctSucursalV2/pctEstandarV2 consume helper directo).
  // Card 1 Hero usa data.enviosMes directo en L1871.

  // Phase 2.2.d: derivacion nueva basada en modalidadesMetrica (8 canonicas).
  // Mapeo D2: Card 11 agrupa a 3 buckets. Reverse modalidades NO se cuentan
  // en estos buckets (van al widget Forward/Reverse split del modal).
  let pctEstandarV2 = 0; let pctSameDayV2 = 0; let pctSucursalV2 = 0;
  if (modalidadesMetrica?.distribucionGlobal) {
    const dist = modalidadesMetrica.distribucionGlobal;
    const total = modalidadesMetrica.cantidadEnviosTotal || 1;
    const findCount = (name: string) => dist.find((d: any) => d.modalidad === name)?.cantidad || 0;
    const countEstandarV2 = findCount("Entrega a Domicilio (Estandar)") + findCount("Retiro en Punto de Retiro (Estandar)") + findCount("Retiro en e-locker (Estandar)");
    const countSameDayV2 = findCount("Entrega a Domicilio (Same Day)");
    const countSucursalV2 = findCount("Retiro en Sucursal (Estandar)");
    pctEstandarV2 = Math.round((countEstandarV2 / total) * 100);
    pctSameDayV2 = Math.round((countSameDayV2 / total) * 100);
    pctSucursalV2 = Math.round((countSucursalV2 / total) * 100);
  }

  // M9: CONEXIÓN REAL DE RIESGO COURIER
  // Phase 2.5.d: topCouriers legacy derive eliminado. Card 12 + modal
  // consumen concentracionCourierMetrica.shareByCourier directo del helper
  // scope-aware. data.couriers + data.nombresCouriers legacy fields de
  // /api/dashboard sin consumers tras esta migracion (Phase 4 cleanup global).

  const coloresRiesgo = ['bg-yellow-400', 'bg-red-500', 'bg-purple-500'];

  // INSIGHTS LÓGICOS
  const fugaPeso = desvioPesoMetrica?.resumen?.tasaSobreAforados ?? 0;
  const efectividadGlobal = efectividadMetrica?.resumen?.porcentajePrimeraVisita ?? 0;
  // Phase 2.4.d: rebind a nuevo state ticketsMesaAyudaMetrica (helper scope-aware).
  // Legacy soporteStats default L268 preservado (Phase 4 cleanup).
  const tasaSoporteGlobal = ticketsMesaAyudaMetrica?.resumen?.tasaSoporte ?? 0;

  let insightRuteoP = "Enrutamiento 100% optimizado.";
  let insightRuteoS = "Tus envíos están utilizando las tarifas más eficientes. No hay fugas financieras detectadas.";
  let colorRuteo = "green"; let IconoRuteo = CheckCircle2;
  if ((fugaRuteoMetrica?.resumen?.fugaTotal ?? 0) > 0) {
    insightRuteoP = `Se están pagando de más por elección ineficiente en checkout.`;
    insightRuteoS = `Recomendamos activar reglas de Protección de Margen en el módulo Mis Transportes.`;
    colorRuteo = "purple"; IconoRuteo = Lightbulb;
  }

  let insightAforoP = "Aforos bajo control.";
  let insightAforoS = "Tus dimensiones declaradas coinciden con las del correo.";
  let colorAforo = "green"; let IconoAforo = CheckCircle2;
  if(fugaPeso > 20) {
     insightAforoP = `Estás subsidiando envíos. Desvío promedio: +${desvioPesoMetrica?.resumen?.desvioPromedioKg ?? 0}kg.`;
     insightAforoS = `Recomendamos sumar ${desvioPesoMetrica?.resumen?.desvioPromedioKg ?? 0}kg al peso base de tus productos en tu e-commerce.`;
     colorAforo = "red"; IconoAforo = Lightbulb;
  }

  let iEfectividadP = "Alta Efectividad Operativa.";
  let iEfectividadS = "La gran mayoría de tus envíos se entregan en el primer intento.";
  let cEfectividad = "green"; let IconEfectividad = CheckCircle2;
  if (efectividadGlobal < 85 && efectividadGlobal > 0) {
     iEfectividadP = `Fricción en Última Milla: ${100 - efectividadGlobal}% de fallas.`;
     iEfectividadS = `Alta tasa de falla en primer visita. Recomendamos activar notificaciones proactivas al comprador.`;
     cEfectividad = "orange"; IconEfectividad = Lightbulb;
  }

  const abrirAnalisis = (titulo: string) => {
    setMetricaAnalisis(titulo);
    if (titulo !== "Mapa de Calor SLA") setZonaSlaSeleccionada(null); // Resetea el modal M10
  };

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto pb-20 font-sans">
      
      {/* MODAL DRILL-DOWN DINÁMICO */}
      {metricaAnalisis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="bg-slate-900 p-6 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2"><ZoomIn className="w-4 h-4" /> Análisis Profundo (Drill-Down)</h3>
                <h2 className="text-2xl font-black text-white">{metricaAnalisis}</h2>
              </div>
              <button onClick={() => {setMetricaAnalisis(null); setZonaSlaSeleccionada(null);}} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            
            {/* ============================================================== */}
            {/* VISTAS DINÁMICAS SEGÚN MÉTRICA SELECCIONADA */}
            {/* ============================================================== */}
            {metricaAnalisis === "Fuga por Ruteo Ineficiente" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-purple-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-full -z-10 opacity-50"></div>
                        <h4 className="text-xs font-black text-purple-600 uppercase tracking-widest mb-1">Costo de Oportunidad Total</h4>
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{cargandoFugaRuteo ? '...' : formatPesos(fugaRuteoMetrica?.resumen?.fugaTotal ?? 0)}</p>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed">Dinero perdido por no utilizar la tarifa más económica habilitada en Shipro al momento del despacho.</p>
                      </div>

                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">Eficiencia de Enrutamiento</h4>
                        <div className="space-y-5">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> Envíos Optimizados (Ahorro)</span><span className="text-green-700">{fugaRuteoMetrica?.resumen?.tasaOptimizacion ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-green-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${fugaRuteoMetrica?.resumen?.tasaOptimizacion ?? 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Envíos Ineficientes (Fuga)</span><span className="text-red-600">{fugaRuteoMetrica?.resumen?.tasaIneficiencia ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-red-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${fugaRuteoMetrica?.resumen?.tasaIneficiencia ?? 0}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      <div className={`bg-${colorRuteo}-50 p-6 rounded-2xl border border-${colorRuteo}-100 shadow-sm`}>
                        <h4 className={`text-xs font-black text-${colorRuteo}-800 uppercase tracking-widest mb-3 flex items-center gap-2`}>
                          <IconoRuteo className="w-4 h-4" /> Insight de Negocio
                        </h4>
                        <p className="text-lg font-bold text-gray-800 mb-3 leading-tight">{insightRuteoP}</p>
                        <p className={`text-xs text-${colorRuteo}-700 font-medium leading-relaxed`}>{insightRuteoS}</p>
                      </div>
                    </div>

                    <div className="lg:col-span-7">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 h-full flex flex-col">
                        <div className="p-6 border-b border-gray-100">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                            <MapPinned className="w-5 h-5 text-purple-600"/> Alternativas Óptimas Ignoradas
                          </h4>
                          <p className="text-xs text-gray-500 mt-1 font-medium">Desglose de las zonas logísticas con mayor sobreprecio asumido.</p>
                        </div>
                        
                        <div className="p-6 flex-1 space-y-4 overflow-y-auto">
                          {(fugaRuteoMetrica?.topDesviosPorZona?.length ?? 0) === 0 ? (
                            <p className="text-sm font-bold text-gray-400 text-center py-10">No se detectaron fugas de capital en la segmentación actual.</p>
                          ) : (
                            (fugaRuteoMetrica?.topDesviosPorZona ?? []).map((desvio: any, idx: number) => (
                              <div key={`fuga-${idx}`} className="p-5 bg-white border border-gray-200 hover:border-purple-300 rounded-xl transition-all shadow-sm group">
                                <div className="flex justify-between items-start mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 font-black flex items-center justify-center text-xs">#{idx + 1}</div>
                                    <div>
                                      <h5 className="font-bold text-gray-800 text-sm">{desvio.courierMasSugerido}</h5>
                                      <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1 uppercase tracking-wider mt-0.5"><MapPin className="w-3 h-3" /> Zona: {desvio.destino} • {desvio.enviosAfectados} envíos</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-0.5">Ahorro Potencial</p>
                                    <p className="text-lg font-black text-green-700">+{formatPesos(desvio.totalPerdido)}</p>
                                  </div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border border-gray-100">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-8 bg-red-400 rounded-full"></div>
                                    <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Se eligió</p><p className="text-xs font-bold text-gray-700">{desvio.courierMasElegido}</p></div>
                                  </div>
                                  <div className="hidden sm:block text-gray-300"><ArrowRightLeft className="w-4 h-4" /></div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-8 bg-green-500 rounded-full"></div>
                                    <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Se Sugería</p><p className="text-xs font-bold text-gray-700">{desvio.courierMasSugerido}</p></div>
                                  </div>
                                  <div className="bg-white px-3 py-1.5 rounded-md shadow-sm border border-gray-200 text-center w-full sm:w-auto">
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Brecha p/Envío</p>
                                    <p className="text-xs font-black text-purple-700">+{formatPesos(desvio.costoPromedioExtra)}</p>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Desvío Financiero por Peso Volumétrico" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Tasa de Inexactitud</h4>
                          <p className="text-4xl font-black text-red-600 mb-1">{desvioPesoMetrica?.resumen?.tasaSobreAforados ?? 0}%</p>
                          <p className="text-[10px] font-bold text-gray-500">Envíos con aforo final superior al declarado.</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Desvío Promedio</h4>
                          <p className="text-3xl font-black text-orange-600 mb-1 flex justify-center items-center gap-1">+{desvioPesoMetrica?.resumen?.desvioPromedioKg ?? 0} <span className="text-lg">kg</span></p>
                          <p className="text-[10px] font-bold text-gray-500">Volumen extra cobrado por el correo.</p>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-full -z-10 opacity-50"></div>
                        <h4 className="text-xs font-black text-red-600 uppercase tracking-widest mb-1 flex items-center gap-2"><Scale className="w-4 h-4"/> Fuga de Capital Acumulada</h4>
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{formatPesos(desvioPesoMetrica?.resumen?.fugaTotal ?? 0)}</p>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed">Dinero que el e-commerce no le cobró al comprador final, pero que el courier facturó a fin de mes.</p>
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <BarChart className="w-5 h-5 text-red-500"/> Distribución del Error
                        </h4>
                        <div className="space-y-6">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-yellow-600 flex items-center gap-2">Leve (hasta +1kg)</span><span className="text-yellow-600">{desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.leve ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-yellow-400 h-4 rounded-full transition-all duration-1000" style={{ width: `${desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.leve ?? 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-orange-600 flex items-center gap-2">Moderado (de +1kg a +3kg)</span><span className="text-orange-600">{desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.moderado ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-orange-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.moderado ?? 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2">Grave (+3kg)</span><span className="text-red-600">{desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.grave ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-red-600 h-4 rounded-full transition-all duration-1000" style={{ width: `${desvioPesoMetrica?.resumen?.distribucionSeveridadPct?.grave ?? 0}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-full">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <Truck className="w-5 h-5 text-gray-500"/> Tasa de Desvío por Courier
                        </h4>
                        <div className="space-y-4">
                          {(desvioPesoMetrica?.porCourier ?? []).map((c:any, idx:number) => (
                            <div key={`str-${idx}`} className="flex items-center gap-4">
                              <div className="w-24 text-xs font-bold text-gray-700 truncate">{c.nombre}</div>
                              <div className="flex-1 bg-gray-100 rounded-full h-2 relative">
                                <div className="bg-gray-400 h-2 rounded-full absolute left-0" style={{ width: `${c.porcentajeDesvio}%` }}></div>
                              </div>
                              <div className="w-10 text-right text-xs font-black text-gray-500">{c.porcentajeDesvio}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Efectividad de Entregas en 1ra Visita" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 relative overflow-hidden">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Efectividad 1ra Visita</h4>
                        <p className="text-6xl font-black text-gray-800 tracking-tighter">{efectividadMetrica?.resumen?.porcentajePrimeraVisita ?? 0}%</p>
                        <p className="text-xs font-medium text-gray-500 mt-2">Envíos que llegaron a destino con una sola salida a distribución.</p>
                      </div>

                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">Funnel de Última Milla</h4>
                        <div className="space-y-5">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> 1ra Visita Exitosa</span><span className="text-green-700">{efectividadMetrica?.resumen?.porcentajePrimeraVisita ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica?.resumen?.porcentajePrimeraVisita ?? 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-orange-600 flex items-center gap-2"><Clock className="w-4 h-4"/> Entregas Forzadas (2da+)</span><span className="text-orange-600">{efectividadMetrica?.resumen?.porcentajeVisitasForzadas ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-orange-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica?.resumen?.porcentajeVisitasForzadas ?? 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2"><Undo2 className="w-4 h-4"/> Logística Inversa (Devuelto)</span><span className="text-red-600">{efectividadMetrica?.resumen?.porcentajeDevoluciones ?? 0}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica?.resumen?.porcentajeDevoluciones ?? 0}%` }}></div></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <SearchCode className="w-5 h-5 text-orange-500"/> Top Motivos de Falla en Visita
                        </h4>
                        <div className="space-y-4">
                          {(efectividadMetrica?.topMotivosFalla ?? []).map((falla: any, idx: number) => (
                            <div key={`efec-${idx}`} className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl flex justify-between items-center group hover:bg-orange-50 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-black flex items-center justify-center text-xs">#{idx + 1}</div>
                                <span className="text-sm font-bold text-gray-800">{falla.motivo}</span>
                              </div>
                              <span className="text-lg font-black text-orange-600">{falla.porcentaje}%</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-fit">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                              <Undo2 className="w-5 h-5 text-red-500"/> Tasa de Devolución por Provincia
                            </h4>
                            <p className="text-xs text-gray-500 mt-1">Provincias con mayor tasa de devolución sobre envíos completados.</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-red-400 uppercase">Costo Hundido Estimado</p>
                            <p className="text-xl font-black text-red-600">{formatPesos(efectividadMetrica?.resumen?.costoInversaEstimado ?? 0)}</p>
                          </div>
                        </div>
                        <div className="space-y-4 mt-6">
                          {(efectividadMetrica?.porProvincia ?? []).map((dev:any, idx:number) => (
                            <div key={`map-${idx}`} className="flex items-center gap-4">
                              <div className="w-32 text-xs font-bold text-gray-700 truncate"><MapPin className="w-3 h-3 inline mr-1 text-gray-400"/> {dev.provincia}</div>
                              <div className="flex-1 bg-gray-100 rounded-full h-2 relative">
                                <div className="bg-red-400 h-2 rounded-full absolute left-0 transition-all duration-1000" style={{ width: `${dev.porcentajeDevoluciones}%` }}></div>
                              </div>
                              <div className="w-16 text-right">
                                <span className="text-xs font-black text-gray-800 block">{dev.porcentajeDevoluciones}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Tasa de Tickets de Mesa de Ayuda" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoTicketsMesaAyuda ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !ticketsMesaAyudaMetrica || ticketsMesaAyudaMetrica.resumen.totalTickets === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin tickets en la ventana de {ticketsMesaAyudaMetrica?.calidadDatos?.ventanaDias ?? 90} dias.
                    {ticketsMesaAyudaMetrica && (
                      <p className="text-xs text-gray-400 mt-2">{ticketsMesaAyudaMetrica.resumen.totalEnviosEnVentana} envios en la ventana.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* LEFT: Hero 2-tile + Distribucion + Origen */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* Hero 2-tile */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 text-center">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Tasa de Soporte</p>
                          <p className="text-5xl font-black text-gray-800 tracking-tighter">{ticketsMesaAyudaMetrica.resumen.tasaSoporte}%</p>
                          <p className="text-[10px] text-gray-500 mt-2">{ticketsMesaAyudaMetrica.resumen.totalTickets} tickets / {ticketsMesaAyudaMetrica.resumen.totalEnviosEnVentana} envios</p>
                        </div>
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 text-center">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Resolucion Mediana</p>
                          <p className="text-4xl font-black text-blue-600 tracking-tighter flex items-center justify-center gap-1">
                            <Timer className="w-6 h-6"/>
                            {(() => {
                              const d = ticketsMesaAyudaMetrica.resumen.tiempoMedianoResolucion;
                              if (d === null) return "--";
                              if (d < 1) return `${Math.round(d * 24)}h`;
                              return `${d % 1 === 0 ? d : d.toFixed(1)}d`;
                            })()}
                          </p>
                          <p className="text-[10px] text-gray-500 mt-2">de tickets cerrados</p>
                        </div>
                      </div>

                      {/* Distribucion Estados */}
                      <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">Distribucion de Estados</h4>
                          {ticketsMesaAyudaMetrica.resumen.totalActivos > 0 && (
                            <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                              {ticketsMesaAyudaMetrica.resumen.totalActivos} Activos
                            </span>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> Cerrados</span>
                              <span className="text-green-700">{ticketsMesaAyudaMetrica.distribucionEstados.cerrado.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.cerrado.porcentaje}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.cerrado.porcentaje}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-orange-600 flex items-center gap-2"><Activity className="w-4 h-4"/> En Progreso</span>
                              <span className="text-orange-600">{ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.porcentaje}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-orange-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.porcentaje}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-red-600 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Abiertos</span>
                              <span className="text-red-600">{ticketsMesaAyudaMetrica.distribucionEstados.abierto.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.abierto.porcentaje}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-red-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.abierto.porcentaje}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      {/* Origen Tickets */}
                      <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider mb-4">Origen de la Solicitud</h4>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-blue-600">Radar Shipro (Auto-creado)</span>
                              <span className="text-blue-600">{ticketsMesaAyudaMetrica.origen.radarShipro.cantidad} ({ticketsMesaAyudaMetrica.origen.radarShipro.porcentaje}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.origen.radarShipro.porcentaje}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-purple-600">Auto-Gestion Cliente</span>
                              <span className="text-purple-600">{ticketsMesaAyudaMetrica.origen.cliente.cantidad} ({ticketsMesaAyudaMetrica.origen.cliente.porcentaje}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.origen.cliente.porcentaje}%` }}></div></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: Top Motivos + porCourier + porMes */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Top Motivos */}
                      {ticketsMesaAyudaMetrica.topMotivos.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertCircle className="w-5 h-5 text-orange-500" /> Top Motivos de Intervencion</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Motivo</th>
                                <th className="pb-2 font-bold text-right">Cantidad</th>
                                <th className="pb-2 font-bold text-right">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ticketsMesaAyudaMetrica.topMotivos.map((m: any, idx: number) => (
                                <tr key={`mot-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{m.motivo}</td>
                                  <td className="py-2 text-right text-gray-500">{m.cantidad}</td>
                                  <td className="py-2 text-right font-bold text-orange-600">{m.porcentaje}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Tabla por Courier */}
                      {ticketsMesaAyudaMetrica.porCourier.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> Tickets por Courier</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Courier</th>
                                <th className="pb-2 font-bold text-right">Tickets</th>
                                <th className="pb-2 font-bold text-right">Envios</th>
                                <th className="pb-2 font-bold text-right">Tasa</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ticketsMesaAyudaMetrica.porCourier.map((c: any, idx: number) => (
                                <tr key={`cou-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{c.nombre}</td>
                                  <td className="py-2 text-right text-gray-500">{c.cantidad}</td>
                                  <td className="py-2 text-right text-gray-500">{c.enviosTotales}</td>
                                  <td className={`py-2 text-right font-bold ${c.tasaSoporte > 5 ? 'text-red-600' : 'text-gray-700'}`}>{c.tasaSoporte}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Evolucion Mensual */}
                      {ticketsMesaAyudaMetrica.porMes.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-gray-500" /> Evolucion Mensual</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Mes</th>
                                <th className="pb-2 font-bold text-right">Cantidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ticketsMesaAyudaMetrica.porMes.map((m: any) => (
                                <tr key={`mes-${m.mes}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{m.mes}</td>
                                  <td className="py-2 text-right text-gray-500">{m.cantidad}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>

            ) : metricaAnalisis === "Adopción de Modalidades" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoModalidades ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !modalidadesMetrica || modalidadesMetrica.cantidadEnviosTotal === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin envios en la ventana de {modalidadesMetrica?.ventanaDias || 90} dias.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* COLUMNA IZQUIERDA: VOLUMEN + INSIGHT + WARNING */}
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Volumen Analizado</p>
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{modalidadesMetrica.cantidadEnviosTotal.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">Paquetes distribuidos en {modalidadesMetrica.ventanaDias} dias segun modalidad elegida en checkout.</p>
                      </div>
                      <div className="bg-indigo-50 rounded-2xl border border-indigo-200 p-6">
                        <h4 className="text-xs font-black text-indigo-700 uppercase tracking-wider mb-3 flex items-center gap-2"><Lightbulb className="w-4 h-4"/> Insight de Conversion</h4>
                        <ul className="text-sm space-y-2 text-indigo-900">
                          <li className="flex items-start gap-2"><span className="text-indigo-500 font-black">·</span> Mejorar la oferta <strong>Same-Day</strong> puede aumentar el LTV en hasta <strong>30%</strong>.</li>
                          <li className="flex items-start gap-2"><span className="text-indigo-500 font-black">·</span> Una opcion de <strong>Sucursal</strong> robusta reduce el abandono de carrito en un <strong>15%</strong>.</li>
                        </ul>
                      </div>
                      {modalidadesMetrica.cantidadEnviosDesconocida > 0 && (
                        <div className="bg-orange-50 rounded-2xl border border-orange-200 p-4 text-xs text-orange-800">
                          <strong>{modalidadesMetrica.cantidadEnviosDesconocida}</strong> envios no pudieron clasificarse en el catalogo canonico (modalidad legacy o no reconocida). Excluidos de los porcentajes.
                        </div>
                      )}
                    </div>

                    {/* COLUMNA DERECHA: ANALISIS COMPLETO */}
                    <div className="lg:col-span-7 space-y-6">
                      {/* 3-tile Resumen Forward/Reverse */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Total Envios</p>
                          <p className="text-2xl font-black text-gray-800">{modalidadesMetrica.cantidadEnviosTotal}</p>
                          <p className="text-[10px] text-gray-400 mt-1">en {modalidadesMetrica.ventanaDias} dias</p>
                        </div>
                        <div className="bg-white rounded-xl border border-green-200 p-4 text-center">
                          <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Forward</p>
                          <p className="text-2xl font-black text-green-600">{modalidadesMetrica.splitForwardReverse.forward.porcentaje}%</p>
                          <p className="text-[10px] text-gray-400 mt-1">{modalidadesMetrica.splitForwardReverse.forward.cantidad} envios</p>
                        </div>
                        <div className="bg-white rounded-xl border border-orange-200 p-4 text-center">
                          <p className="text-[10px] font-bold text-orange-600 uppercase mb-1">Reverse</p>
                          <p className="text-2xl font-black text-orange-600">{modalidadesMetrica.splitForwardReverse.reverse.porcentaje}%</p>
                          <p className="text-[10px] text-gray-400 mt-1">{modalidadesMetrica.splitForwardReverse.reverse.cantidad} envios</p>
                        </div>
                      </div>

                      {/* Distribucion por Modalidad (8 canonicas) */}
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Store className="w-5 h-5 text-gray-500" /> Distribucion por Modalidad</h4>
                        <div className="space-y-3">
                          {modalidadesMetrica.distribucionGlobal.map((item: any) => (
                            <div key={`mod-${item.modalidad}`}>
                              <div className="flex justify-between text-xs font-bold mb-1">
                                <span className="text-gray-700">{item.modalidad}</span>
                                <span className="text-gray-500">{item.porcentaje}% <span className="text-gray-400">({item.cantidad})</span></span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div className="bg-indigo-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${item.porcentaje}%` }}></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tabla Por Courier */}
                      {modalidadesMetrica.porCourier?.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> Modalidades por Courier</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Courier</th>
                                <th className="pb-2 font-bold text-right">Envios</th>
                                <th className="pb-2 font-bold">Modalidad Dominante</th>
                                <th className="pb-2 font-bold text-right">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalidadesMetrica.porCourier.map((c: any) => {
                                const dom = c.distribucion[0];
                                return (
                                  <tr key={`cou-${c.courierId}`} className="border-b border-gray-100">
                                    <td className="py-2 font-bold text-gray-800">{c.courierNombre}</td>
                                    <td className="py-2 text-right text-gray-500">{c.cantidad}</td>
                                    <td className="py-2 text-gray-700">{dom?.modalidad ?? "--"}</td>
                                    <td className="py-2 text-right font-bold text-indigo-600">{dom?.porcentaje ?? 0}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Tabla Por Provincia top 10 */}
                      {modalidadesMetrica.porProvincia?.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-gray-500" /> Modalidades por Provincia (Top 10)</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Provincia</th>
                                <th className="pb-2 font-bold text-right">Envios</th>
                                <th className="pb-2 font-bold">Modalidad Dominante</th>
                                <th className="pb-2 font-bold text-right">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalidadesMetrica.porProvincia.slice(0, 10).map((p: any, idx: number) => {
                                const dom = p.distribucion[0];
                                return (
                                  <tr key={`prov-${idx}`} className="border-b border-gray-100">
                                    <td className="py-2 font-bold text-gray-800 capitalize">{p.provincia}</td>
                                    <td className="py-2 text-right text-gray-500">{p.cantidad}</td>
                                    <td className="py-2 text-gray-700">{dom?.modalidad ?? "--"}</td>
                                    <td className="py-2 text-right font-bold text-indigo-600">{dom?.porcentaje ?? 0}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Evolucion Mensual */}
                      {modalidadesMetrica.porMes?.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-gray-500" /> Evolucion Mensual</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Mes</th>
                                <th className="pb-2 font-bold text-right">Envios</th>
                                <th className="pb-2 font-bold">Modalidad Dominante</th>
                                <th className="pb-2 font-bold text-right">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalidadesMetrica.porMes.map((m: any) => {
                                const dom = m.distribucion[0];
                                return (
                                  <tr key={`mes-${m.mes}`} className="border-b border-gray-100">
                                    <td className="py-2 font-bold text-gray-800">{m.mes}</td>
                                    <td className="py-2 text-right text-gray-500">{m.cantidad}</td>
                                    <td className="py-2 text-gray-700">{dom?.modalidad ?? "--"}</td>
                                    <td className="py-2 text-right font-bold text-indigo-600">{dom?.porcentaje ?? 0}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>

            ) : metricaAnalisis === "Concentración Courier" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoConcentracionCourier ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !concentracionCourierMetrica || concentracionCourierMetrica.resumen.totalEnvios === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin envios en la ventana de {concentracionCourierMetrica?.calidadDatos?.ventanaDias ?? 90} dias.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* LEFT: Hero Riesgo + HHI gauge + Insight */}
                    <div className="lg:col-span-5 space-y-6">

                      {/* Hero Riesgo Operativo */}
                      <div className={`bg-white rounded-2xl border-2 p-6 text-center ${concentracionCourierMetrica.resumen.esRiesgoAlto ? 'border-red-300' : 'border-green-300'}`}>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Nivel de Riesgo Operativo</p>
                        <p className={`text-6xl font-black tracking-tighter ${concentracionCourierMetrica.resumen.esRiesgoAlto ? 'text-red-600' : 'text-green-700'}`}>
                          {concentracionCourierMetrica.resumen.topShare}%
                        </p>
                        <p className="text-xs text-gray-500 mt-3">
                          Concentracion del courier lider sobre {concentracionCourierMetrica.resumen.totalEnvios} envios totales.
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          Umbral SPOF: {concentracionCourierMetrica.resumen.thresholdSPOF}%
                        </p>
                      </div>

                      {/* HHI Gauge */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Indice HHI</p>
                        <p className="text-4xl font-black text-gray-800 tracking-tighter">{concentracionCourierMetrica.resumen.hhi}</p>
                        <p className={`text-xs font-bold uppercase mt-2 ${
                          concentracionCourierMetrica.resumen.nivelConcentracion === 'alto' ? 'text-red-600' :
                          concentracionCourierMetrica.resumen.nivelConcentracion === 'moderado' ? 'text-orange-600' :
                          'text-green-700'
                        }`}>
                          Nivel {concentracionCourierMetrica.resumen.nivelConcentracion}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-2">
                          Herfindahl-Hirschman Index (0-10000)
                        </p>
                      </div>

                      {/* Insight Continuidad */}
                      <div className={`rounded-2xl border p-6 ${concentracionCourierMetrica.resumen.esRiesgoAlto ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                        <h4 className={`text-xs font-black uppercase tracking-wider mb-3 flex items-center gap-2 ${concentracionCourierMetrica.resumen.esRiesgoAlto ? 'text-red-700' : 'text-green-700'}`}>
                          <Lightbulb className="w-4 h-4"/> Insight de Continuidad
                        </h4>
                        {concentracionCourierMetrica.resumen.esRiesgoAlto ? (
                          <>
                            <p className="text-sm font-bold text-red-800 mb-2">Riesgo de SPOF (Single Point of Failure)</p>
                            <p className="text-xs text-red-700 leading-relaxed">
                              Hay un courier que concentra <strong>{concentracionCourierMetrica.resumen.topShare}%</strong> del volumen. Una falla, huelga o cambio en sus condiciones impactaria masivamente las operaciones.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-bold text-green-800 mb-2">Diversificacion saludable</p>
                            <p className="text-xs text-green-700 leading-relaxed">
                              El portafolio de couriers esta razonablemente distribuido. No hay riesgo de SPOF — una caida puntual no detendria las operaciones.
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* RIGHT: Share of Wallet + Evolucion Mensual */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Share of Wallet */}
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> Share of Wallet</h4>
                        <div className="space-y-4">
                          {concentracionCourierMetrica.shareByCourier.map((c: any, idx: number) => {
                            const barColor = c.porcentaje >= 60 ? 'bg-red-500' : c.porcentaje >= 30 ? 'bg-yellow-500' : 'bg-green-500';
                            return (
                              <div key={`share-${idx}`}>
                                <div className="flex justify-between text-sm font-bold mb-1">
                                  <span className="text-gray-800 flex items-center gap-2">
                                    {c.nombre}
                                    {c.esLider && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black">LIDER</span>}
                                  </span>
                                  <span className="text-gray-700">{c.porcentaje}% <span className="text-gray-400 font-normal">({c.cantidad})</span></span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-3"><div className={`${barColor} h-3 rounded-full transition-all duration-1000`} style={{ width: `${c.porcentaje}%` }}></div></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Evolucion Mensual */}
                      {concentracionCourierMetrica.porMes.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-gray-500" /> Evolucion Mensual</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Mes</th>
                                <th className="pb-2 font-bold">Courier Dominante</th>
                                <th className="pb-2 font-bold text-right">Share</th>
                                <th className="pb-2 font-bold text-right">Envios Total Mes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {concentracionCourierMetrica.porMes.map((m: any) => {
                                const dom = m.distribuciones[0];
                                const total = m.distribuciones.reduce((s: number, d: any) => s + d.cantidad, 0);
                                return (
                                  <tr key={`mes-${m.mes}`} className="border-b border-gray-100">
                                    <td className="py-2 font-bold text-gray-800">{m.mes}</td>
                                    <td className="py-2 text-gray-700">{dom?.nombre ?? "--"}</td>
                                    <td className={`py-2 text-right font-bold ${(dom?.porcentaje ?? 0) >= 60 ? 'text-red-600' : 'text-gray-700'}`}>{dom?.porcentaje ?? 0}%</td>
                                    <td className="py-2 text-right text-gray-500">{total}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>

) : metricaAnalisis === "Mapa de Calor SLA" ? (
  <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden p-8">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto h-full">
      
      {/* PANEL IZQUIERDO: EL DASHBOARD DE CUMPLIMIENTO */}
      <div className="lg:col-span-5 space-y-6">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-black text-gray-800 uppercase">
            {zonaSlaSeleccionada ? `Zona: ${zonaSlaSeleccionada.zona}` : 'Promedio Ecosistema'}
          </h4>
          {zonaSlaSeleccionada && (
            <button onClick={() => setZonaSlaSeleccionada(null)} className="text-[10px] font-bold text-blue-600 px-2 py-1 bg-blue-50 rounded">Ver Global</button>
          )}
        </div>

        {/* MÉTRICA 1: SLA HEALTH INDEX (COURIER) */}
        <div className={`p-6 rounded-3xl border-2 flex flex-col items-center justify-center text-center transition-all ${
          (zonaSlaSeleccionada?.indice || (mapaSlaMetrica?.resumen?.slaHealthIndex ?? 0)) <= 1 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Courier Health Index</h4>
          <p className={`text-6xl font-black ${(zonaSlaSeleccionada?.indice || (mapaSlaMetrica?.resumen?.slaHealthIndex ?? 0)) <= 1 ? 'text-green-600' : 'text-red-600'}`}>
            {zonaSlaSeleccionada ? zonaSlaSeleccionada.indice : (mapaSlaMetrica?.resumen?.slaHealthIndex ?? 0)}
          </p>
          <p className="text-[10px] font-bold text-gray-500 uppercase mt-1">
            Días Reales / Días Pactados
          </p>
        </div>

        {/* MÉTRICA 2: CUMPLIMIENTO E2E (SHIPRO) */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cumplimiento Shipro</h4>
              <p className="text-4xl font-black text-gray-800">{mapaSlaMetrica?.resumen?.cumplimientoE2E ?? 0}%</p>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg"><Target className="w-5 h-5 text-blue-600"/></div>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
            Porcentaje de compradores que recibieron su pedido dentro de la <strong>Promesa de Checkout</strong> (End-to-End).
          </p>
        </div>

        {/* MÉTRICA 3: PREPARACIÓN */}
        <div className="bg-gray-100 p-5 rounded-2xl border border-gray-200 flex justify-between items-center">
           <div>
             <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Demora de Preparación</h4>
             <p className="text-2xl font-black text-gray-700">{mapaSlaMetrica?.resumen?.promedioPreparacion ?? 0} días</p>
           </div>
           <Clock className="w-8 h-8 text-gray-300"/>
        </div>
      </div>

      {/* PANEL DERECHO: RENDIMIENTO POR ZONA */}
      <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-gray-200 overflow-y-auto">
        <h4 className="text-sm font-black mb-6 flex items-center gap-2"><MapPinned className="text-blue-600"/> Rendimiento Geográfico</h4>
        <div className="space-y-3">
          {(mapaSlaMetrica?.mapaZonas ?? []).map((z:any, i:number) => (
            <div 
              key={i} 
              onClick={() => setZonaSlaSeleccionada(z)}
              className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                zonaSlaSeleccionada?.zona === z.zona ? 'border-blue-600 bg-blue-50 shadow-md' : 'border-gray-100 bg-gray-50 hover:bg-white'
              }`}
            >
              <div>
                <p className="font-black text-gray-800 text-sm">{z.zona}</p>
                <p className="text-[9px] font-bold text-gray-400 uppercase">{z.volumen} envíos medidos</p>
              </div>
              <div className="flex gap-8">
                <div className="text-right">
                  <p className="text-[8px] font-bold text-gray-400 uppercase">Tránsito Real</p>
                  <p className="text-sm font-black text-gray-700">{z.transitoReal}d</p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-bold text-gray-400 uppercase">SLA Index</p>
                  <p className={`text-sm font-black ${z.indice <= 1 ? 'text-green-600' : 'text-red-600'}`}>{z.indice}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>

            ) : metricaAnalisis === "Tiempos Colecta" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoTiemposColecta ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !tiemposColectaMetrica || tiemposColectaMetrica.cantidadEnviosValidos === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin envios con fecha de colecta en la ventana de {tiemposColectaMetrica?.ventanaDias || 30} dias.
                    {tiemposColectaMetrica?.cantidadEnviosSinFechaColecta > 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        Hay {tiemposColectaMetrica.cantidadEnviosSinFechaColecta} envios sin fecha de colecta poblada todavia.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* 3-tile Resumen */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Mediana (P50)</p>
                        <p className="text-3xl font-black text-blue-600">
                          {tiemposColectaMetrica.estadisticosGlobales.p50 < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p50)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.p50 / 24).toFixed(1)} dias`}
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Promedio</p>
                        <p className="text-3xl font-black text-gray-800">
                          {tiemposColectaMetrica.estadisticosGlobales.promedio < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.promedio)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.promedio / 24).toFixed(1)} dias`}
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">P95 (Cola lenta)</p>
                        <p className="text-3xl font-black text-orange-600">
                          {tiemposColectaMetrica.estadisticosGlobales.p95 < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p95)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.p95 / 24).toFixed(1)} dias`}
                        </p>
                      </div>
                    </div>

                    {/* Calidad de datos */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs text-gray-600">
                      <span className="font-bold text-gray-900">{tiemposColectaMetrica.cantidadEnviosValidos}</span> envios validos
                      {" "}de <span className="font-bold text-gray-900">{tiemposColectaMetrica.cantidadEnviosTotal}</span> en ventana de {tiemposColectaMetrica.ventanaDias} dias.
                      {tiemposColectaMetrica.cantidadEnviosSinFechaColecta > 0 && (
                        <span className="ml-2 text-gray-500">
                          ({tiemposColectaMetrica.cantidadEnviosSinFechaColecta} sin fecha de colecta)
                        </span>
                      )}
                    </div>

                    {/* Tabla Por Deposito */}
                    {tiemposColectaMetrica.porDeposito?.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Warehouse className="w-5 h-5 text-gray-500" /> Por Deposito</h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                              <th className="pb-2 font-bold">Deposito</th>
                              <th className="pb-2 font-bold text-right">Mediana</th>
                              <th className="pb-2 font-bold text-right">Promedio</th>
                              <th className="pb-2 font-bold text-right">P95</th>
                              <th className="pb-2 font-bold text-right">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porDeposito.map((d: any) => (
                              <tr key={`dep-${d.depositoId}`} className="border-b border-gray-100">
                                <td className="py-2 font-bold text-gray-800">{d.depositoNombre}</td>
                                <td className="py-2 text-right text-gray-700">{d.medianaHoras < 48 ? `${Math.round(d.medianaHoras)}h` : `${(d.medianaHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{d.promedioHoras < 48 ? `${Math.round(d.promedioHoras)}h` : `${(d.promedioHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{d.p95Horas < 48 ? `${Math.round(d.p95Horas)}h` : `${(d.p95Horas / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-500">{d.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Tabla Por Courier */}
                    {tiemposColectaMetrica.porCourier?.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> Por Courier</h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                              <th className="pb-2 font-bold">Courier</th>
                              <th className="pb-2 font-bold text-right">Mediana</th>
                              <th className="pb-2 font-bold text-right">Promedio</th>
                              <th className="pb-2 font-bold text-right">P95</th>
                              <th className="pb-2 font-bold text-right">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porCourier.map((c: any) => (
                              <tr key={`cou-${c.courierId}`} className="border-b border-gray-100">
                                <td className="py-2 font-bold text-gray-800">{c.courierNombre}</td>
                                <td className="py-2 text-right text-gray-700">{c.medianaHoras < 48 ? `${Math.round(c.medianaHoras)}h` : `${(c.medianaHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{c.promedioHoras < 48 ? `${Math.round(c.promedioHoras)}h` : `${(c.promedioHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{c.p95Horas < 48 ? `${Math.round(c.p95Horas)}h` : `${(c.p95Horas / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-500">{c.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Tabla Por Dia Semana */}
                    {tiemposColectaMetrica.porDiaSemana?.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-gray-500" /> Por Dia de Semana</h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                              <th className="pb-2 font-bold">Dia</th>
                              <th className="pb-2 font-bold text-right">Mediana</th>
                              <th className="pb-2 font-bold text-right">Promedio</th>
                              <th className="pb-2 font-bold text-right">P95</th>
                              <th className="pb-2 font-bold text-right">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porDiaSemana.map((d: any) => (
                              <tr key={`dia-${d.diaSemana}`} className="border-b border-gray-100">
                                <td className="py-2 font-bold text-gray-800">{d.diaSemanaNombre}</td>
                                <td className="py-2 text-right text-gray-700">{d.medianaHoras < 48 ? `${Math.round(d.medianaHoras)}h` : `${(d.medianaHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{d.promedioHoras < 48 ? `${Math.round(d.promedioHoras)}h` : `${(d.promedioHoras / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-700">{d.p95Horas < 48 ? `${Math.round(d.p95Horas)}h` : `${(d.p95Horas / 24).toFixed(1)}d`}</td>
                                <td className="py-2 text-right text-gray-500">{d.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                  </div>
                )}
              </div>
            ) : metricaAnalisis === "Promesa Calibrada" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoPromesaCalibrada ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !promesaCalibradaMetrica || promesaCalibradaMetrica.cantidadEnviosValidos === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin envios entregados en la ventana de {promesaCalibradaMetrica?.ventanaDias || 90} dias.
                    {promesaCalibradaMetrica?.cantidadEnviosSinDatos > 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        Hay {promesaCalibradaMetrica.cantidadEnviosSinDatos} envios sin datos completos en la ventana.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* 4-tile Resumen */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Mediana (P50)</p>
                        <p className="text-3xl font-black text-gray-800">
                          {promesaCalibradaMetrica.estadisticosGlobales.p50Dias} dias
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p50Horas}h · caso tipico
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-blue-200 p-5 bg-blue-50">
                        <p className="text-xs font-bold text-blue-600 uppercase mb-2">Promesa Calibrada (P75)</p>
                        <p className="text-3xl font-black text-blue-600">
                          {promesaCalibradaMetrica.estadisticosGlobales.p75Dias ?? "--"} dias
                        </p>
                        <p className="text-xs text-blue-500 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p75Horas !== null
                            ? `${promesaCalibradaMetrica.estadisticosGlobales.p75Horas}h · lo que prometemos`
                            : "Sin muestra suficiente"}
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Promedio</p>
                        <p className="text-3xl font-black text-gray-800">
                          {promesaCalibradaMetrica.estadisticosGlobales.promedioDias} dias
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.promedioHoras}h
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-orange-200 p-5">
                        <p className="text-xs font-bold text-orange-600 uppercase mb-2">P95 (Cola lenta)</p>
                        <p className="text-3xl font-black text-orange-600">
                          {promesaCalibradaMetrica.estadisticosGlobales.p95Dias} dias
                        </p>
                        <p className="text-xs text-orange-500 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p95Horas}h · 95% por debajo
                        </p>
                      </div>
                    </div>

                    {/* Cumplimiento Historico */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-500" /> Cumplimiento Historico</h4>
                      {promesaCalibradaMetrica.tasaCumplimientoGlobal !== null ? (
                        <div className="flex items-baseline gap-3">
                          <p className={`text-4xl font-black ${promesaCalibradaMetrica.tasaCumplimientoGlobal >= 0.9 ? 'text-green-600' : promesaCalibradaMetrica.tasaCumplimientoGlobal >= 0.7 ? 'text-orange-500' : 'text-red-600'}`}>
                            {(promesaCalibradaMetrica.tasaCumplimientoGlobal * 100).toFixed(1)}%
                          </p>
                          <div className="text-xs text-gray-600">
                            <p>de envios cumplidos dentro de promesa</p>
                            <p>{promesaCalibradaMetrica.cantidadEnviosConPromesa} envios evaluados</p>
                            <p className="text-gray-400">(de {promesaCalibradaMetrica.cantidadEnviosValidos} entregados)</p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">
                          Sin datos de cumplimiento aun.
                          <p className="text-xs text-gray-400 mt-1">La promesa al checkout empezara a registrarse cuando se procesen pedidos con cotizador activo.</p>
                        </div>
                      )}
                    </div>

                    {/* Calidad de datos */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs text-gray-600">
                      <span className="font-bold text-gray-900">{promesaCalibradaMetrica.cantidadEnviosValidos}</span> envios entregados validos
                      {" "}de <span className="font-bold text-gray-900">{promesaCalibradaMetrica.cantidadEnviosTotal}</span> en ventana de {promesaCalibradaMetrica.ventanaDias} dias.
                      <span className="ml-2 text-gray-500">
                        Umbral muestra confiable: {promesaCalibradaMetrica.umbralMuestraMinima} envios.
                      </span>
                    </div>

                    {/* Tabla combinaciones */}
                    {promesaCalibradaMetrica.combinaciones?.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> Promesa por Ruta (Deposito x Courier x Provincia)</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Deposito</th>
                                <th className="pb-2 font-bold">Courier</th>
                                <th className="pb-2 font-bold">Provincia</th>
                                <th className="pb-2 font-bold text-right">P75 Promesa</th>
                                <th className="pb-2 font-bold text-right">P50</th>
                                <th className="pb-2 font-bold text-right">P90</th>
                                <th className="pb-2 font-bold text-right">Envios</th>
                                <th className="pb-2 font-bold text-right">Cumplim.</th>
                                <th className="pb-2 font-bold text-right">Confiable</th>
                              </tr>
                            </thead>
                            <tbody>
                              {promesaCalibradaMetrica.combinaciones.map((c: any, idx: number) => (
                                <tr key={`combo-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{c.depositoNombre}</td>
                                  <td className="py-2 text-gray-700">{c.courierNombre}</td>
                                  <td className="py-2 text-gray-700 capitalize">{c.provinciaDestino}</td>
                                  <td className="py-2 text-right font-bold text-blue-600">{c.p75Dias} d</td>
                                  <td className="py-2 text-right text-gray-700">{c.p50Dias} d</td>
                                  <td className="py-2 text-right text-gray-700">{c.p90Dias} d</td>
                                  <td className="py-2 text-right text-gray-500">{c.cantidad}</td>
                                  <td className="py-2 text-right">
                                    {c.tasaCumplimiento !== null
                                      ? <span className={c.tasaCumplimiento >= 0.9 ? 'text-green-600 font-bold' : c.tasaCumplimiento >= 0.7 ? 'text-orange-500' : 'text-red-600 font-bold'}>{(c.tasaCumplimiento * 100).toFixed(0)}%</span>
                                      : <span className="text-gray-400">--</span>}
                                  </td>
                                  <td className="py-2 text-right">
                                    {c.muestraConfiable
                                      ? <span className="text-green-600 font-bold text-xs">SI</span>
                                      : <span className="text-orange-500 font-bold text-xs">NO</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            ) : metricaAnalisis === "Experiencia del Consumidor" ? (
              <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
                {cargandoNpsComprador ? (
                  <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando metrica...</div>
                ) : !npsCompradorMetrica || npsCompradorMetrica.resumen.totalEncuestas === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    Sin encuestas en la ventana de {npsCompradorMetrica?.calidadDatos?.ventanaDias ?? 90} dias.
                    {npsCompradorMetrica && (
                      <p className="text-xs text-gray-400 mt-2">{npsCompradorMetrica.calidadDatos.totalEntregados} envios entregados en la ventana.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* LEFT: Hero + Distribucion + Cruce SLA */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* Hero NPS Score */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">NPS Score</p>
                        <div className={`w-32 h-32 rounded-full border-8 flex items-center justify-center bg-white shadow-inner mb-4 mx-auto ${
                          npsCompradorMetrica.resumen.npsScore >= 50 ? 'border-green-500' :
                          npsCompradorMetrica.resumen.npsScore >= 0 ? 'border-yellow-500' :
                          'border-red-500'
                        }`}>
                          <span className="text-5xl font-black text-gray-800">
                            {npsCompradorMetrica.resumen.npsScore > 0 ? `+${npsCompradorMetrica.resumen.npsScore}` : npsCompradorMetrica.resumen.npsScore}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Escala -100 a +100. Score promedio: <span className="font-bold">{npsCompradorMetrica.resumen.scorePromedio}/10</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                          {npsCompradorMetrica.resumen.totalEncuestas} encuestas · tasa respuesta {npsCompradorMetrica.resumen.tasaRespuesta ?? '-'}% sobre {npsCompradorMetrica.calidadDatos.totalEntregados} entregas
                        </p>
                      </div>

                      {/* Distribucion 3 bars */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-6">
                        <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider mb-4">Distribucion</h4>
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1">
                              <span className="text-green-700 flex items-center gap-1"><Smile className="w-3.5 h-3.5"/> Promotores</span>
                              <span className="text-green-700">{npsCompradorMetrica.resumen.promotores} ({npsCompradorMetrica.resumen.promotoresPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.promotoresPct}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1">
                              <span className="text-yellow-600 flex items-center gap-1"><Meh className="w-3.5 h-3.5"/> Pasivos</span>
                              <span className="text-yellow-600">{npsCompradorMetrica.resumen.pasivos} ({npsCompradorMetrica.resumen.pasivosPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-yellow-400 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.pasivosPct}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-bold mb-1">
                              <span className="text-red-600 flex items-center gap-1"><Frown className="w-3.5 h-3.5"/> Detractores</span>
                              <span className="text-red-600">{npsCompradorMetrica.resumen.detractores} ({npsCompradorMetrica.resumen.detractoresPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-500 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.detractoresPct}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      {/* Cruce SLA 3-tile */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-6">
                        <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider mb-4">NPS Segun Cumplimiento SLA</h4>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div className="text-center p-3 rounded-lg bg-gray-50">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Con SLA Cumplido</p>
                            <p className={`text-2xl font-black ${
                              npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore >= 50 ? 'text-green-700' :
                              npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore >= 0 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore > 0 ? `+${npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore}` : npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore}
                            </p>
                            <p className="text-xs text-gray-400">{npsCompradorMetrica.cruceSLA.conSlaCumplido.totalEncuestas} encuestas</p>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-gray-50">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Sin SLA Cumplido</p>
                            <p className={`text-2xl font-black ${
                              npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore >= 50 ? 'text-green-700' :
                              npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore >= 0 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore > 0 ? `+${npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore}` : npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore}
                            </p>
                            <p className="text-xs text-gray-400">{npsCompradorMetrica.cruceSLA.sinSlaCumplido.totalEncuestas} encuestas</p>
                          </div>
                        </div>
                        {npsCompradorMetrica.cruceSLA.sinDatoSLA > 0 && (
                          <p className="text-xs text-gray-400 text-center">{npsCompradorMetrica.cruceSLA.sinDatoSLA} encuestas sin dato de SLA</p>
                        )}
                      </div>
                    </div>

                    {/* RIGHT: Friccion + Tablas + Comentarios */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Friccion Entrega */}
                      {npsCompradorMetrica.friccionEntrega.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertCircle className="w-5 h-5 text-orange-500" /> Friccion en la Entrega</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Motivo</th>
                                <th className="pb-2 font-bold text-right">Cantidad</th>
                                <th className="pb-2 font-bold text-right">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {npsCompradorMetrica.friccionEntrega.map((f: any, idx: number) => (
                                <tr key={`fric-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{f.motivo}</td>
                                  <td className="py-2 text-right text-gray-500">{f.cantidad}</td>
                                  <td className="py-2 text-right font-bold text-orange-600">{f.porcentaje}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Tabla por Courier */}
                      {npsCompradorMetrica.porCourier.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-gray-500" /> NPS por Courier</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Courier</th>
                                <th className="pb-2 font-bold text-right">Encuestas</th>
                                <th className="pb-2 font-bold text-right">NPS Score</th>
                                <th className="pb-2 font-bold text-right">Score Prom.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {npsCompradorMetrica.porCourier.map((c: any, idx: number) => (
                                <tr key={`cou-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{c.nombre}</td>
                                  <td className="py-2 text-right text-gray-500">{c.totalEncuestas}</td>
                                  <td className={`py-2 text-right font-bold ${c.npsScore >= 50 ? 'text-green-700' : c.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>{c.npsScore > 0 ? `+${c.npsScore}` : c.npsScore}</td>
                                  <td className="py-2 text-right text-gray-700">{c.scorePromedio}/10</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Tabla por Provincia */}
                      {npsCompradorMetrica.porProvincia.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-gray-500" /> NPS por Provincia (Top 10)</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Provincia</th>
                                <th className="pb-2 font-bold text-right">Encuestas</th>
                                <th className="pb-2 font-bold text-right">NPS Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {npsCompradorMetrica.porProvincia.slice(0, 10).map((p: any, idx: number) => (
                                <tr key={`prov-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800 capitalize">{p.nombre}</td>
                                  <td className="py-2 text-right text-gray-500">{p.totalEncuestas}</td>
                                  <td className={`py-2 text-right font-bold ${p.npsScore >= 50 ? 'text-green-700' : p.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>{p.npsScore > 0 ? `+${p.npsScore}` : p.npsScore}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Tabla por Modalidad */}
                      {npsCompradorMetrica.porModalidad.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Store className="w-5 h-5 text-gray-500" /> NPS por Modalidad</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Modalidad</th>
                                <th className="pb-2 font-bold text-right">Encuestas</th>
                                <th className="pb-2 font-bold text-right">NPS Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {npsCompradorMetrica.porModalidad.map((m: any, idx: number) => (
                                <tr key={`mod-${idx}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{m.nombre}</td>
                                  <td className="py-2 text-right text-gray-500">{m.totalEncuestas}</td>
                                  <td className={`py-2 text-right font-bold ${m.npsScore >= 50 ? 'text-green-700' : m.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>{m.npsScore > 0 ? `+${m.npsScore}` : m.npsScore}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Evolucion Mensual */}
                      {npsCompradorMetrica.porMes.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-gray-500" /> Evolucion Mensual</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                                <th className="pb-2 font-bold">Mes</th>
                                <th className="pb-2 font-bold text-right">Encuestas</th>
                                <th className="pb-2 font-bold text-right">NPS Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {npsCompradorMetrica.porMes.map((m: any) => (
                                <tr key={`mes-${m.mes}`} className="border-b border-gray-100">
                                  <td className="py-2 font-bold text-gray-800">{m.mes}</td>
                                  <td className="py-2 text-right text-gray-500">{m.totalEncuestas}</td>
                                  <td className={`py-2 text-right font-bold ${m.npsScore >= 50 ? 'text-green-700' : m.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>{m.npsScore > 0 ? `+${m.npsScore}` : m.npsScore}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Top Promotores (verde) */}
                      {npsCompradorMetrica.topPromotores.length > 0 && (
                        <div className="bg-green-50 rounded-xl border border-green-200 p-5">
                          <h4 className="text-sm font-black text-green-700 uppercase tracking-wider mb-4 flex items-center gap-2"><Smile className="w-5 h-5" /> Top Promotores ({npsCompradorMetrica.topPromotores.length})</h4>
                          <div className="space-y-3">
                            {npsCompradorMetrica.topPromotores.map((p: any) => (
                              <div key={`prom-${p.envioId}`} className="bg-white rounded-lg p-3 border border-green-100">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="text-xs font-bold text-green-700">Score: {p.score}/10</span>
                                  <span className="text-[10px] text-gray-400">{p.courierNombre ?? '--'}</span>
                                </div>
                                <p className="text-sm text-gray-700 italic">"{p.comentario}"</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Top Detractores (rojo) */}
                      {npsCompradorMetrica.topDetractores.length > 0 && (
                        <div className="bg-red-50 rounded-xl border border-red-200 p-5">
                          <h4 className="text-sm font-black text-red-700 uppercase tracking-wider mb-4 flex items-center gap-2"><Frown className="w-5 h-5" /> Top Detractores ({npsCompradorMetrica.topDetractores.length})</h4>
                          <div className="space-y-3">
                            {npsCompradorMetrica.topDetractores.map((d: any) => (
                              <div key={`det-${d.envioId}`} className="bg-white rounded-lg p-3 border border-red-100">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="text-xs font-bold text-red-700">Score: {d.score}/10</span>
                                  <span className="text-[10px] text-gray-400">{d.courierNombre ?? '--'}</span>
                                </div>
                                <p className="text-sm text-gray-700 italic">"{d.comentario}"</p>
                                {d.sugerenciaMejora && (
                                  <p className="text-xs text-gray-500 mt-2"><strong>Sugerencia:</strong> {d.sugerenciaMejora}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>
            ) : (
              // FALLBACK (Para métricas que aún no diseñamos)
              <div className="flex-1 p-8 overflow-y-auto bg-gray-50 flex flex-col items-center justify-center text-center">
                <BarChart className="w-24 h-24 text-gray-200 mb-4" />
                <h3 className="text-xl font-bold text-gray-800 mb-2">Módulo en Desarrollo</h3>
                <p className="text-gray-500 max-w-md">La interfaz visual de <strong>"{metricaAnalisis}"</strong> está siendo construida.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CABECERA DASHBOARD */}
      <header className={esEquipoShipro ? "bg-white border-b border-gray-200 px-8 py-6 z-10 shrink-0 shadow-sm" : "bg-white border-b border-gray-200 px-8 py-6 z-10 shrink-0 shadow-sm sticky top-0"}>
        {esEquipoShipro && (
          <div className="absolute top-0 left-0 w-full bg-red-600 text-white px-8 py-1.5 flex items-center justify-between text-[10px] font-black tracking-widest uppercase shadow-inner z-50">
            <div className="flex items-center gap-2"><Eye className="w-3 h-3" /> MODO AUDITORÍA (SÚPER ADMIN)</div>
            <div className="flex items-center gap-3">
              <span className="font-medium">Viendo cuenta:</span>
              <select value={empresaActivaId} onChange={e => setEmpresaActivaId(e.target.value)} className="bg-red-900 border-none text-white rounded px-2 py-0.5 outline-none cursor-pointer">
                <option value="TODAS">Todo el Ecosistema</option>
                {empresasLista.map(emp => <option key={`emp-${emp.id}`} value={emp.id}>{emp.nombre}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${esEquipoShipro ? 'mt-4' : ''}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600/10 border border-blue-500/20">
              <LayoutDashboard className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Panel de Control Operativo</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">Métricas logísticas de tu negocio.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
            <Filter className="w-4 h-4 text-gray-400 ml-2" />
            <select value={filtroTiempo} onChange={(e) => setFiltroTiempo(e.target.value)} className="bg-transparent text-sm font-bold text-gray-700 px-3 py-1.5 outline-none cursor-pointer">
              <option value="hoy">Hoy</option>
              <option value="semana">Últimos 7 días</option>
              <option value="mes_actual">Mes Actual</option>
              <option value="trimestre">Últimos 90 días</option>
            </select>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
        
        {/* BLOQUE 1: KPIs CORE */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">1. Despachos Periodo</p>
            <h3 className="text-3xl font-black text-gray-800">{data.enviosMes || 0} <span className="text-xs text-gray-400">pqts</span></h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">2. Éxito Histórico</p>
            <h3 className="text-3xl font-black text-gray-800">{data.porcentajeExito || 0}% <span className="text-xs text-gray-400">efectividad</span></h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">3. Gasto Logístico</p>
            <h3 className="text-3xl font-black text-gray-800">{formatPesos(data.gastoTotal)}</h3>
          </div>
          <div className="bg-red-50 p-6 rounded-2xl shadow-sm border border-red-200">
            <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertCircle className="w-4 h-4"/> 4. Tickets Abiertos</p>
            <h3 className="text-3xl font-black text-red-600">{data.ticketsActivos || 0} <span className="text-xs text-red-400">incidencias</span></h3>
          </div>
        </div>

        {/* BLOQUE 2: FUGAS FINANCIERAS (M3 y M4) */}
        <div>
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" /> Rendimiento y Fugas (M3 - M6)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* M3: Ruteo */}
            <div className={`bg-white border rounded-xl p-5 shadow-sm flex flex-col h-full transition-colors ${(fugaRuteoMetrica?.resumen?.fugaTotal ?? 0) > 0 ? 'border-purple-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-purple-500" /> 5. Fuga por Ruteo</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{cargandoFugaRuteo ? '...' : formatPesos(fugaRuteoMetrica?.resumen?.fugaTotal ?? 0)}</h3>
                <p className="text-[10px] font-bold text-purple-500 mb-4">Costo Oportunidad</p>
              </div>
              <button onClick={() => abrirAnalisis("Fuga por Ruteo Ineficiente")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

            {/* M4: Aforo */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${fugaPeso > 20 ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Box className="w-3.5 h-3.5 text-red-500" /> 6. Desvío de Peso</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{cargandoDesvioPeso ? '...' : `${fugaPeso}%`}</h3>
                <p className="text-[10px] font-bold text-red-500 mb-4">Aforos penalizados</p>
              </div>
              <button onClick={() => abrirAnalisis("Desvío Financiero por Peso Volumétrico")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

            {/* M5: Efectividad */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${efectividadGlobal < 85 ? 'border-orange-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-green-500" /> 7. Primera Visita</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{cargandoEfectividad ? '...' : `${efectividadGlobal}%`}</h3>
                <p className="text-[10px] font-bold text-green-500 mb-4">Efectividad de entrega</p>
              </div>
              <button onClick={() => abrirAnalisis("Efectividad de Entregas en 1ra Visita")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>
            
            {/* M6: Soporte */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${tasaSoporteGlobal > 5 ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Headset className="w-3.5 h-3.5 text-orange-500" /> 8. Soporte</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{tasaSoporteGlobal}%</h3>
                <p className="text-[10px] font-bold text-orange-500 mb-4">Tickets c/ 100 envíos</p>
              </div>
              <button onClick={() => abrirAnalisis("Tasa de Tickets de Mesa de Ayuda")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE Velocidad Operativa (Phase 1.4.d, 2026-06-13) */}
        <div>
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><TrendingDown className="w-5 h-5 text-blue-600" /> Velocidad Operativa</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* M2.1: Tiempos Colecta */}
            <div className="bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors border-gray-200">
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5 text-blue-500" /> 9. Tiempos Colecta</p>
                {cargandoTiemposColecta ? (
                  <h3 className="text-3xl font-black text-gray-800 mb-1">...</h3>
                ) : tiemposColectaMetrica?.estadisticosGlobales?.p50 == null ? (
                  <>
                    <h3 className="text-3xl font-black text-gray-400 mb-1">--</h3>
                    <p className="text-[10px] font-bold text-gray-500 mb-4">Sin data en ventana</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-3xl font-black text-gray-800 mb-1">
                      {tiemposColectaMetrica.estadisticosGlobales.p50 < 48
                        ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p50)}`
                        : (tiemposColectaMetrica.estadisticosGlobales.p50 / 24).toFixed(1)}
                      <span className="text-lg font-bold text-gray-400">{" "}{tiemposColectaMetrica.estadisticosGlobales.p50 < 48 ? "h" : "dias"}</span>
                    </h3>
                    <p className="text-[10px] font-bold text-blue-500 mb-4">Mediana de colecta</p>
                  </>
                )}
              </div>
              <button onClick={() => abrirAnalisis("Tiempos Colecta")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

            {/* M2.3: Promesa Calibrada (Phase 1.5.d, 2026-06-13) */}
            <div className="bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors border-gray-200">
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-blue-500" /> 10. Promesa Calibrada</p>
                {cargandoPromesaCalibrada ? (
                  <h3 className="text-3xl font-black text-gray-800 mb-1">...</h3>
                ) : promesaCalibradaMetrica?.estadisticosGlobales?.p75Dias == null || (promesaCalibradaMetrica?.cantidadEnviosValidos ?? 0) === 0 ? (
                  <>
                    <h3 className="text-3xl font-black text-gray-400 mb-1">--</h3>
                    <p className="text-[10px] font-bold text-gray-500 mb-4">Sin envios entregados</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-3xl font-black text-gray-800 mb-1">
                      {promesaCalibradaMetrica.estadisticosGlobales.p75Dias}
                      <span className="text-lg font-bold text-gray-400"> dias</span>
                    </h3>
                    <p className="text-[10px] font-bold text-blue-500 mb-4">
                      {promesaCalibradaMetrica.tasaCumplimientoGlobal !== null
                        ? `Cumplimiento ${(promesaCalibradaMetrica.tasaCumplimientoGlobal * 100).toFixed(0)}%`
                        : "Sin promesa registrada"}
                      {" "}· {promesaCalibradaMetrica.cantidadEnviosValidos} envios
                    </p>
                  </>
                )}
              </div>
              <button onClick={() => abrirAnalisis("Promesa Calibrada")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

          </div>
        </div>

        {/* BLOQUE 3: ANÁLISIS VIVOS — grid 4-col para acomodar Cards 11-14 alineadas. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Store className="w-4 h-4 text-[#233b6b]" /> 11. Modalidades (Real)</span><button onClick={() => abrirAnalisis("Adopción de Modalidades")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="space-y-5 flex-1 flex flex-col justify-center">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Domicilio Estándar</span><span>{pctEstandarV2}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-slate-700 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctEstandarV2}%` }}></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Same-Day</span><span className="text-purple-600">{pctSameDayV2}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-purple-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctSameDayV2}%` }}></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Sucursal</span><span className="text-blue-600">{pctSucursalV2}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctSucursalV2}%` }}></div></div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><PieChart className="w-4 h-4 text-[#233b6b]" /> 12. Riesgo Courier (Real)</span><button onClick={() => abrirAnalisis("Concentración Courier")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 flex flex-col justify-center space-y-4">
              {cargandoConcentracionCourier ? (
                <p className="text-sm text-gray-400 text-center font-bold">Cargando...</p>
              ) : !concentracionCourierMetrica || concentracionCourierMetrica.shareByCourier.length === 0 ? (
                <p className="text-sm text-gray-400 text-center font-bold">Sin datos para graficar</p>
              ) : (
                concentracionCourierMetrica.shareByCourier.slice(0, 3).map((c: any, i: number) => {
                  const share = c.porcentaje;
                  const barColor = share >= 60 ? 'bg-red-500' : share >= 30 ? 'bg-yellow-500' : 'bg-green-500';
                  return (
                    <div key={`risk-${i}`}>
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-gray-700 flex items-center gap-1">
                          {c.nombre}
                          {c.esLider && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black">LIDER</span>}
                        </span>
                        <span className="text-gray-600">{share}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2"><div className={`${barColor} h-2 rounded-full transition-all duration-1000`} style={{ width: `${share}%` }}></div></div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Map className="w-4 h-4 text-[#233b6b]" /> 13. Mapa SLA (Real)</span><button onClick={() => abrirAnalisis("Mapa de Calor SLA")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            
            {/* TARJETA M10 ACTUALIZADA CON ÍNDICES */}
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 gap-2 text-[10px] font-bold text-center text-white items-center content-start">
              {cargandoMapaSla ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Cargando...</p> : (mapaSlaMetrica?.mapaZonas?.length ?? 0) === 0 ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Sin datos de SLA finalizados</p> : (mapaSlaMetrica?.mapaZonas ?? []).slice(0, 12).map((z: any, i: number) => {
                const color = z.indice <= 0.8 ? 'bg-green-500' : z.indice <= 1 ? 'bg-blue-500' : 'bg-red-500';
                return (
                  <div key={`cajita-${i}`} className={`${color} rounded p-2 flex flex-col items-center justify-center shadow-sm hover:scale-105 transition-transform`} title={z.zona}>
                    <span className="truncate w-full block uppercase">{z.zona.substring(0,6)}</span>
                    <span className="text-[9px] text-white/90 block">Ix: {z.indice}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CARD 14: NPS Comprador (mini) — Phase 2.3.d */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><HeartHandshake className="w-4 h-4 text-indigo-500" /> 14. Experiencia (NPS)</span><button onClick={() => abrirAnalisis("Experiencia del Consumidor")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            {cargandoNpsComprador ? (
              <p className="text-gray-400 text-sm text-center py-8">Cargando...</p>
            ) : !npsCompradorMetrica || npsCompradorMetrica.resumen.totalEncuestas === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm text-center py-4">
                <p>Sin encuestas en la ventana de {npsCompradorMetrica?.calidadDatos?.ventanaDias ?? 90} dias.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center flex-1">
                <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center bg-white shadow-inner mb-3 ${
                  npsCompradorMetrica.resumen.npsScore >= 50 ? 'border-green-500' :
                  npsCompradorMetrica.resumen.npsScore >= 0 ? 'border-yellow-500' :
                  'border-red-500'
                }`}>
                  <span className="text-3xl font-black text-gray-800">
                    {npsCompradorMetrica.resumen.npsScore > 0 ? `+${npsCompradorMetrica.resumen.npsScore}` : npsCompradorMetrica.resumen.npsScore}
                  </span>
                </div>
                <div className="w-full space-y-2 mt-2">
                  <div className="flex justify-between text-xs font-bold"><span className="text-green-600 flex items-center gap-1"><Smile className="w-3.5 h-3.5"/> Promotores</span><span>{npsCompradorMetrica.resumen.promotoresPct}%</span></div>
                  <div className="flex justify-between text-xs font-bold"><span className="text-yellow-600 flex items-center gap-1"><Meh className="w-3.5 h-3.5"/> Pasivos</span><span>{npsCompradorMetrica.resumen.pasivosPct}%</span></div>
                  <div className="flex justify-between text-xs font-bold"><span className="text-red-600 flex items-center gap-1"><Frown className="w-3.5 h-3.5"/> Detractores</span><span>{npsCompradorMetrica.resumen.detractoresPct}%</span></div>
                </div>
                <p className="text-[10px] text-gray-400 mt-3">{npsCompradorMetrica.resumen.totalEncuestas} encuestas / {npsCompradorMetrica.calidadDatos.totalEntregados} entregas</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}