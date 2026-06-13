"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { 
  LayoutDashboard, AlertCircle, Loader2, Eye, 
  Clock, PackageCheck, Filter, Timer, TrendingDown,
  Map, ArrowRightLeft, Target, Building2, Activity, Box,
  Headset, Truck, Store, MapPin, ZoomIn, X, BarChart, PieChart, 
  HeartHandshake, Smile, Meh, Frown, MessageSquare, ShieldCheck, 
  SearchCode, TrendingUp, Lightbulb, Calendar, CheckCircle2, Scale, Undo2, ListChecks, Check, MapPinned, LifeBuoy
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
  const [npsDimension, setNpsDimension] = useState('courier'); // <-- ACÁ ESTÁ LA VARIABLE CORREGIDA PARA EL M11
  
  const [filtroRuteoDesde, setFiltroRuteoDesde] = useState("");

  // Phase 1.1.d (2026-06-12): nuevo state consumiendo endpoint Torre.
  // El proxy inyecta x-empresa-id de la sesion del usuario.
  // Backend: scope-aware via AuthContext.
  const [fugaRuteoMetrica, setFugaRuteoMetrica] = useState<any>(null);
  const [cargandoFugaRuteo, setCargandoFugaRuteo] = useState(true);
  const [filtroRuteoHasta, setFiltroRuteoHasta] = useState("");
  const [filtroRuteoServicio, setFiltroRuteoServicio] = useState("TODOS");
  const [filtroRuteoCourier, setFiltroRuteoCourier] = useState("TODOS");

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
        const res = await fetch(`/api/dashboard?empresaId=${empresaActivaId}&rango=${filtroTiempo}`);
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

  const ruteoStats = data.ruteoStats || { fugaFinancieraTotal: 0, enviosOptimizados: 0, enviosIneficientes: 0, costoPromedioExtra: 0, topDesvios: [] };
  const aforoStats = data.aforoStats || { fugaTotal: 0, porcentajeFugaPeso: 0, desvioPromedioKg: 0, costoPromedioDesvio: 0, distribucionError: { leve:0, moderado:0, grave:0 }, topEstrictos: [] };
  const efectividadStats = data.efectividadStats || { tasaPrimeraVisita: 0, tasaEntregasForzadas: 0, tasaDevolucion: 0, costoInversaEstimado: 0, topMotivosFalla: [], mapaDevoluciones: [] };
  const soporteStats = data.soporteStats || { tasaSoporte: 0, ticketsAbiertos: 0, tiempoMedioResolucion: "0h", distribucionEstados: { abiertos:0, progreso:0, resueltos:0 }, topMotivos: [], creadorTicket: { clienteAutoServicio:0, shiproRadar:0 } };
  const nps = data.nps || { global: 0, promotores: 0, pasivos: 0, detractores: 0, porCourier: {}, ultimosComentarios: [] };
  
  // ACA INYECTAMOS LA VARIABLE DEL MÓDULO 10
  const slaStats = data.slaStats || { indiceGlobal: 0, promedioPrepNacional: 0, cumplimientoSla: 0, mapaZonas: [] };

  let couriersLista: string[] = [];
  if (data.nombresCouriers) {
    couriersLista = data.nombresCouriers.map((c:any) => c.nombre);
  }

  // M8: CONEXIÓN REAL DE MODALIDADES
  let pctSameDay = 0; let pctSucursal = 0; let pctEstandar = 0;
  const enviosTotales = data.enviosMes || 1;

  if (data.modalidades) {
    const countSameDay = data.modalidades.find((x:any) => x.modalidad === 'Same-Day' || x.modalidad?.includes('Same'))?._count?.modalidad || 0;
    const countSucursal = data.modalidades.find((x:any) => x.modalidad === 'Sucursal' || x.modalidad?.includes('Sucursal'))?._count?.modalidad || 0;
    const countEstandar = data.modalidades.find((x:any) => x.modalidad === 'Estándar' || x.modalidad?.includes('Estándar') || x.modalidad?.includes('domicilio'))?._count?.modalidad || 0;

    pctSameDay = Math.round((countSameDay / enviosTotales) * 100);
    pctSucursal = Math.round((countSucursal / enviosTotales) * 100);
    pctEstandar = Math.round((countEstandar / enviosTotales) * 100);
  }

  // M9: CONEXIÓN REAL DE RIESGO COURIER
  let topCouriers: any[] = [];
  if (data.couriers && data.nombresCouriers) {
    const cList = data.couriers.map((item:any) => {
      const nc = data.nombresCouriers.find((x:any) => String(x.id) === String(item.courierId));
      const nombre = nc ? nc.nombre : (item.courierId || 'Desconocido');
      return { courier: nombre, cantidad: item._count?.courierId || 0 };
    });
    topCouriers = cList.sort((a:any, b:any) => b.cantidad - a.cantidad).slice(0, 3);
  }

  const coloresRiesgo = ['bg-yellow-400', 'bg-red-500', 'bg-purple-500'];

  // INSIGHTS LÓGICOS
  const fugaPeso = aforoStats.porcentajeFugaPeso;
  const efectividadGlobal = efectividadStats.tasaPrimeraVisita;
  const tasaSoporteGlobal = soporteStats.tasaSoporte;

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
     insightAforoP = `Estás subsidiando envíos. Desvío promedio: +${aforoStats.desvioPromedioKg}kg.`;
     insightAforoS = `Recomendamos sumar ${aforoStats.desvioPromedioKg}kg al peso base de tus productos en tu e-commerce.`;
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
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Box className="w-4 h-4 text-gray-400" />
                    <select value={filtroRuteoServicio} onChange={e => setFiltroRuteoServicio(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer">
                      <option value="TODOS">Todas las Modalidades</option>
                      <option value="domicilio">Solo A Domicilio</option>
                      <option value="sucursal">Solo A Sucursal</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Truck className="w-4 h-4 text-gray-400" />
                    <select value={filtroRuteoCourier} onChange={e => setFiltroRuteoCourier(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer">
                      <option value="TODOS">Couriers Evaluados: Todos</option>
                      {couriersLista.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

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
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Truck className="w-4 h-4 text-gray-400" />
                    <select value={filtroRuteoCourier} onChange={e => setFiltroRuteoCourier(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer">
                      <option value="TODOS">Couriers Evaluados: Todos</option>
                      {couriersLista.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Tasa de Inexactitud</h4>
                          <p className="text-4xl font-black text-red-600 mb-1">{aforoStats.porcentajeFugaPeso}%</p>
                          <p className="text-[10px] font-bold text-gray-500">Envíos con aforo final superior al declarado.</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Desvío Promedio</h4>
                          <p className="text-3xl font-black text-orange-600 mb-1 flex justify-center items-center gap-1">+{aforoStats.desvioPromedioKg} <span className="text-lg">kg</span></p>
                          <p className="text-[10px] font-bold text-gray-500">Volumen extra cobrado por el correo.</p>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-full -z-10 opacity-50"></div>
                        <h4 className="text-xs font-black text-red-600 uppercase tracking-widest mb-1 flex items-center gap-2"><Scale className="w-4 h-4"/> Fuga de Capital Acumulada</h4>
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{formatPesos(aforoStats.fugaTotal)}</p>
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
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-yellow-600 flex items-center gap-2">Leve (hasta +1kg)</span><span className="text-yellow-600">{aforoStats.distribucionError.leve}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-yellow-400 h-4 rounded-full transition-all duration-1000" style={{ width: `${aforoStats.distribucionError.leve}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-orange-600 flex items-center gap-2">Moderado (de +1kg a +3kg)</span><span className="text-orange-600">{aforoStats.distribucionError.moderado}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-orange-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${aforoStats.distribucionError.moderado}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2">Grave (+3kg)</span><span className="text-red-600">{aforoStats.distribucionError.grave}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-red-600 h-4 rounded-full transition-all duration-1000" style={{ width: `${aforoStats.distribucionError.grave}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-full">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <Truck className="w-5 h-5 text-gray-500"/> Rigurosidad por Courier
                        </h4>
                        <div className="space-y-4">
                          {aforoStats.topEstrictos.map((c:any, idx:number) => (
                            <div key={`str-${idx}`} className="flex items-center gap-4">
                              <div className="w-24 text-xs font-bold text-gray-700 truncate">{c.courier}</div>
                              <div className="flex-1 bg-gray-100 rounded-full h-2 relative">
                                <div className="bg-gray-400 h-2 rounded-full absolute left-0" style={{ width: `${c.porcentajeAforos}%` }}></div>
                              </div>
                              <div className="w-10 text-right text-xs font-black text-gray-500">{c.porcentajeAforos}%</div>
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
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 relative overflow-hidden">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Efectividad 1ra Visita</h4>
                        <p className="text-6xl font-black text-gray-800 tracking-tighter">{efectividadStats.tasaPrimeraVisita}%</p>
                        <p className="text-xs font-medium text-gray-500 mt-2">Envíos que llegaron a destino con una sola salida a distribución.</p>
                      </div>

                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">Funnel de Última Milla</h4>
                        <div className="space-y-5">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> 1ra Visita Exitosa</span><span className="text-green-700">{efectividadStats.tasaPrimeraVisita}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadStats.tasaPrimeraVisita}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-orange-600 flex items-center gap-2"><Clock className="w-4 h-4"/> Entregas Forzadas (2da+)</span><span className="text-orange-600">{efectividadStats.tasaEntregasForzadas}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-orange-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadStats.tasaEntregasForzadas}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2"><Undo2 className="w-4 h-4"/> Logística Inversa (Devuelto)</span><span className="text-red-600">{efectividadStats.tasaDevolucion}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadStats.tasaDevolucion}%` }}></div></div>
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
                          {efectividadStats.topMotivosFalla.map((falla: any, idx: number) => (
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
                              <Undo2 className="w-5 h-5 text-red-500"/> Mapa de Logística Inversa
                            </h4>
                            <p className="text-xs text-gray-500 mt-1">Zonas con mayor cantidad de paquetes devueltos a origen.</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-red-400 uppercase">Costo Hundido Estimado</p>
                            <p className="text-xl font-black text-red-600">{formatPesos(efectividadStats.costoInversaEstimado)}</p>
                          </div>
                        </div>
                        <div className="space-y-4 mt-6">
                          {efectividadStats.mapaDevoluciones.map((dev:any, idx:number) => (
                            <div key={`map-${idx}`} className="flex items-center gap-4">
                              <div className="w-32 text-xs font-bold text-gray-700 truncate"><MapPin className="w-3 h-3 inline mr-1 text-gray-400"/> {dev.provincia}</div>
                              <div className="flex-1 bg-gray-100 rounded-full h-2 relative">
                                <div className="bg-red-400 h-2 rounded-full absolute left-0 transition-all duration-1000" style={{ width: `${dev.porcentaje}%` }}></div>
                              </div>
                              <div className="w-16 text-right">
                                <span className="text-xs font-black text-gray-800 block">{dev.devoluciones} pqts</span>
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
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 relative overflow-hidden">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tasa de Soporte</h4>
                          <p className="text-5xl font-black text-gray-800 tracking-tighter">{soporteStats.tasaSoporte}%</p>
                          <p className="text-[10px] font-bold text-gray-500 mt-2">Tickets generados cada 100 envíos.</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 relative overflow-hidden">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Resolución Media</h4>
                          <p className="text-4xl font-black text-blue-600 tracking-tighter flex items-center gap-1"><Timer className="w-6 h-6"/> {soporteStats.tiempoMedioResolucion}</p>
                          <p className="text-[10px] font-bold text-gray-500 mt-2">Promedio desde creación al cierre.</p>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="flex justify-between items-center mb-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Distribución de Estados</h4>
                          <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-red-200 animate-pulse">{soporteStats.ticketsAbiertos} Fuegos Abiertos</span>
                        </div>
                        <div className="space-y-5">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> Resueltos / Cerrados</span><span className="text-green-700">{soporteStats.distribucionEstados.resueltos}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${soporteStats.distribucionEstados.resueltos}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-blue-600 flex items-center gap-2"><Activity className="w-4 h-4"/> En Progreso / Espera Courier</span><span className="text-blue-600">{soporteStats.distribucionEstados.progreso}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-blue-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${soporteStats.distribucionEstados.progreso}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Abiertos / Críticos</span><span className="text-red-600">{soporteStats.distribucionEstados.abiertos}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${soporteStats.distribucionEstados.abiertos}%` }}></div></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <ListChecks className="w-5 h-5 text-[#233b6b]"/> Top Motivos de Intervención Manual
                        </h4>
                        <div className="space-y-4">
                          {soporteStats.topMotivos.map((falla: any, idx: number) => (
                            <div key={`sopt-${idx}`} className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex justify-between items-center group transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-black flex items-center justify-center text-xs">#{idx + 1}</div>
                                <div>
                                  <span className="text-sm font-bold text-gray-800 block">{falla.motivo}</span>
                                  <span className="text-[10px] font-bold text-gray-500 flex items-center gap-1 mt-0.5"><Truck className="w-3 h-3"/> {falla.courierAsociado}</span>
                                </div>
                              </div>
                              <span className="text-lg font-black text-gray-600">{falla.porcentaje}%</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-fit">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                              <LifeBuoy className="w-5 h-5 text-green-600"/> Origen de la Solicitud
                            </h4>
                            <p className="text-xs text-gray-500 mt-1">¿Quién detectó y abrió la incidencia?</p>
                          </div>
                        </div>
                        
                        <div className="flex h-12 w-full rounded-xl overflow-hidden shadow-inner border border-gray-200">
                           <div className="bg-green-500 h-full flex flex-col justify-center px-4 transition-all duration-1000" style={{width: `${soporteStats.creadorTicket.clienteAutoServicio}%`}}>
                             <span className="text-white font-black text-sm">{soporteStats.creadorTicket.clienteAutoServicio}%</span>
                             <span className="text-green-100 font-bold text-[9px] uppercase tracking-wider">Auto-Gestión (Cliente)</span>
                           </div>
                           <div className="bg-[#233b6b] h-full flex flex-col justify-center px-4 text-right transition-all duration-1000" style={{width: `${soporteStats.creadorTicket.shiproRadar}%`}}>
                             <span className="text-white font-black text-sm">{soporteStats.creadorTicket.shiproRadar}%</span>
                             <span className="text-blue-200 font-bold text-[9px] uppercase tracking-wider">Radar Shipro (Bot)</span>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Adopción de Modalidades" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10 opacity-50"></div>
                        <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">Volumen Analizado</h4>
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{(enviosTotales || 0).toLocaleString()}</p>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed">Paquetes distribuidos según el servicio elegido en el checkout.</p>
                      </div>

                      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
                        <h4 className="text-xs font-black text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Lightbulb className="w-4 h-4" /> Insight de Conversión
                        </h4>
                        <p className="text-lg font-bold text-gray-800 mb-3 leading-tight">Diversificar eleva las ventas.</p>
                        <p className="text-xs text-blue-700 font-medium leading-relaxed mb-3">Tener habilitado <strong>"Retiro en Sucursal"</strong> reduce la tasa de abandono de carrito en un 15% para clientes que no están en su domicilio durante el día.</p>
                        <p className="text-xs text-blue-700 font-medium leading-relaxed">El <strong>"Same-Day"</strong> aumenta la recompra (LTV) en un 30% al generar gratificación instantánea.</p>
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <Store className="w-5 h-5 text-indigo-500"/> Distribución del Mix Logístico
                        </h4>
                        
                        <div className="space-y-6">
                          <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center"><Truck className="w-5 h-5 text-slate-600"/></div>
                                <div><h5 className="font-bold text-gray-800 text-sm">Domicilio Estándar</h5><p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Logística Tradicional</p></div>
                              </div>
                              <div className="text-right"><p className="text-2xl font-black text-slate-700">{pctEstandar}%</p></div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-slate-600 h-2 rounded-full" style={{ width: `${pctEstandar}%` }}></div></div>
                          </div>

                          <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center"><Activity className="w-5 h-5 text-purple-600"/></div>
                                <div><h5 className="font-bold text-gray-800 text-sm">Same-Day / Flex</h5><p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Gratificación Inmediata</p></div>
                              </div>
                              <div className="text-right"><p className="text-2xl font-black text-purple-700">{pctSameDay}%</p></div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${pctSameDay}%` }}></div></div>
                          </div>

                          <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><Store className="w-5 h-5 text-blue-600"/></div>
                                <div><h5 className="font-bold text-gray-800 text-sm">Punto de Retiro (Sucursal)</h5><p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Conveniencia Horaria</p></div>
                              </div>
                              <div className="text-right"><p className="text-2xl font-black text-blue-700">{pctSucursal}%</p></div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pctSucursal}%` }}></div></div>
                          </div>
                        </div>

                      </div>
                    </div>

                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Concentración Courier" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl mx-auto">
                    
                    <div className="lg:col-span-5 space-y-6">
                      {/* Cálculo de riesgo en vivo */}
                      {(() => {
                        const topShare = topCouriers.length > 0 ? Math.round((topCouriers[0].cantidad / enviosTotales) * 100) : 0; 
                        const esRiesgoAlto = topShare >= 60;
                        const colorRiesgo = esRiesgoAlto ? 'red' : 'green';
                        const tituloRiesgo = esRiesgoAlto ? 'Alta Dependencia (SPOF)' : 'Ecosistema Sano';
                        
                        return (
                          <>
                            <div className={`bg-white p-6 rounded-2xl shadow-sm border border-${colorRiesgo}-100 relative overflow-hidden`}>
                              <div className={`absolute top-0 right-0 w-32 h-32 bg-${colorRiesgo}-50 rounded-bl-full -z-10 opacity-50`}></div>
                              <h4 className={`text-xs font-black text-${colorRiesgo}-600 uppercase tracking-widest mb-1`}>Nivel de Riesgo Operativo</h4>
                              <p className="text-4xl font-black text-gray-800 mb-2 tracking-tighter">{tituloRiesgo}</p>
                              <p className="text-xs font-medium text-gray-500 leading-relaxed">El proveedor principal concentra el <strong className={`text-${colorRiesgo}-600`}>{topShare}%</strong> del volumen.</p>
                            </div>

                            <div className={`bg-${colorRiesgo}-50 p-6 rounded-2xl border border-${colorRiesgo}-100 shadow-sm`}>
                              <h4 className={`text-xs font-black text-${colorRiesgo}-800 uppercase tracking-widest mb-3 flex items-center gap-2`}>
                                <AlertCircle className="w-4 h-4" /> Insight de Continuidad
                              </h4>
                              {esRiesgoAlto ? (
                                <>
                                  <p className="text-lg font-bold text-gray-800 mb-3 leading-tight">Peligro de cuello de botella.</p>
                                  <p className={`text-xs text-${colorRiesgo}-700 font-medium leading-relaxed`}>Concentrar más del 60% de tus envíos en un solo operador te expone a un <strong>Punto Único de Fallo (SPOF)</strong>. Si este courier entra en paro sindical o colapsa, tu operación se detiene. Recomendamos balancear la carga usando las reglas de enrutamiento.</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-lg font-bold text-gray-800 mb-3 leading-tight">Operación resiliente.</p>
                                  <p className={`text-xs text-${colorRiesgo}-700 font-medium leading-relaxed`}>Tu volumen logístico está bien distribuido. Tenés planes de contingencia automáticos si un operador falla, asegurando la continuidad de las entregas.</p>
                                </>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-full">
                        <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2">
                          <PieChart className="w-5 h-5 text-blue-500"/> Share of Wallet (Participación)
                        </h4>
                        
                        <div className="space-y-4">
                          {topCouriers.length === 0 ? (
                            <p className="text-sm font-bold text-gray-400 text-center py-10">Sin datos operativos aún.</p>
                          ) : (
                            topCouriers.map((c: any, idx: number) => {
                              const share = Math.round((c.cantidad / enviosTotales) * 100);
                              const isDominant = share >= 60;
                              return (
                                <div key={`spof-${idx}`} className="p-5 bg-gray-50 border border-gray-200 rounded-xl transition-all shadow-sm">
                                  <div className="flex justify-between items-end mb-3">
                                    <div>
                                      <h5 className="font-black text-gray-800 text-sm flex items-center gap-2">
                                        {c.courier} 
                                        {idx === 0 && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[9px] rounded-full uppercase tracking-widest">Líder</span>}
                                      </h5>
                                    </div>
                                    <div className="text-right">
                                      <p className={`text-2xl font-black ${isDominant ? 'text-red-600' : 'text-gray-700'}`}>{share}%</p>
                                    </div>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div className={`${isDominant ? 'bg-red-500' : 'bg-slate-600'} h-3 rounded-full transition-all duration-1000`} style={{ width: `${share}%` }}></div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                      </div>
                    </div>

                  </div>
                </div>
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
          (zonaSlaSeleccionada?.indice || slaStats.slaHealthIndex) <= 1 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Courier Health Index</h4>
          <p className={`text-6xl font-black ${(zonaSlaSeleccionada?.indice || slaStats.slaHealthIndex) <= 1 ? 'text-green-600' : 'text-red-600'}`}>
            {zonaSlaSeleccionada ? zonaSlaSeleccionada.indice : slaStats.slaHealthIndex}
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
              <p className="text-4xl font-black text-gray-800">{slaStats.cumplimientoE2E}%</p>
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
             <p className="text-2xl font-black text-gray-700">{slaStats.promedioPreparacion} días</p>
           </div>
           <Clock className="w-8 h-8 text-gray-300"/>
        </div>
      </div>

      {/* PANEL DERECHO: RENDIMIENTO POR ZONA */}
      <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-gray-200 overflow-y-auto">
        <h4 className="text-sm font-black mb-6 flex items-center gap-2"><MapPinned className="text-blue-600"/> Rendimiento Geográfico</h4>
        <div className="space-y-3">
          {slaStats.mapaZonas.map((z:any, i:number) => (
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
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Despachos Periodo</p>
            <h3 className="text-3xl font-black text-gray-800">{data.enviosMes || 0} <span className="text-xs text-gray-400">pqts</span></h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Éxito Histórico</p>
            <h3 className="text-3xl font-black text-gray-800">{data.porcentajeExito || 0}% <span className="text-xs text-gray-400">efectividad</span></h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Gasto Logístico</p>
            <h3 className="text-3xl font-black text-gray-800">{formatPesos(data.gastoTotal)}</h3>
          </div>
          <div className="bg-red-50 p-6 rounded-2xl shadow-sm border border-red-200">
            <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertCircle className="w-4 h-4"/> Tickets Abiertos</p>
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
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-purple-500" /> 3. Fuga por Ruteo</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{cargandoFugaRuteo ? '...' : formatPesos(fugaRuteoMetrica?.resumen?.fugaTotal ?? 0)}</h3>
                <p className="text-[10px] font-bold text-purple-500 mb-4">Costo Oportunidad</p>
              </div>
              <button onClick={() => abrirAnalisis("Fuga por Ruteo Ineficiente")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

            {/* M4: Aforo */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${fugaPeso > 20 ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Box className="w-3.5 h-3.5 text-red-500" /> 4. Desvío de Peso</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{fugaPeso}%</h3>
                <p className="text-[10px] font-bold text-red-500 mb-4">Aforos penalizados</p>
              </div>
              <button onClick={() => abrirAnalisis("Desvío Financiero por Peso Volumétrico")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>

            {/* M5: Efectividad */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${efectividadGlobal < 85 ? 'border-orange-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-green-500" /> 5. 1ra Visita</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{efectividadGlobal}%</h3>
                <p className="text-[10px] font-bold text-green-500 mb-4">Efectividad de entrega</p>
              </div>
              <button onClick={() => abrirAnalisis("Efectividad de Entregas en 1ra Visita")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>
            
            {/* M6: Soporte */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full transition-colors ${tasaSoporteGlobal > 5 ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Headset className="w-3.5 h-3.5 text-orange-500" /> 6. Soporte</p>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{tasaSoporteGlobal}%</h3>
                <p className="text-[10px] font-bold text-orange-500 mb-4">Tickets c/ 100 envíos</p>
              </div>
              <button onClick={() => abrirAnalisis("Tasa de Tickets de Mesa de Ayuda")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-blue-50 transition-colors flex justify-center items-center gap-1 mt-auto"><ZoomIn className="w-3.5 h-3.5" /> Analizar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE 3: ANÁLISIS VIVOS (M8, M9, M10) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Store className="w-4 h-4 text-[#233b6b]" /> 8. Modalidades (Real)</span><button onClick={() => abrirAnalisis("Adopción de Modalidades")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="space-y-5 flex-1 flex flex-col justify-center">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Domicilio Estándar</span><span>{pctEstandar}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-slate-700 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctEstandar}%` }}></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Same-Day</span><span className="text-purple-600">{pctSameDay}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-purple-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctSameDay}%` }}></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span className="text-gray-600">Sucursal</span><span className="text-blue-600">{pctSucursal}%</span></div>
                <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${pctSucursal}%` }}></div></div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><PieChart className="w-4 h-4 text-[#233b6b]" /> 9. Riesgo Courier (Real)</span><button onClick={() => abrirAnalisis("Concentración Courier")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 flex flex-col justify-center space-y-4">
              {topCouriers.length === 0 ? <p className="text-sm text-gray-400 text-center font-bold">Sin datos para graficar</p> : (
                topCouriers.map((c: any, i: number) => {
                  const share = Math.round((c.cantidad / enviosTotales) * 100);
                  const colorClass = coloresRiesgo[i] || 'bg-gray-400';

                  return (
                    <div key={`wid-${i}`} className="w-full flex items-center gap-2">
                      <div className="w-full bg-gray-100 rounded-full h-3">
                        <div className={`${colorClass} h-3 rounded-full transition-all duration-1000`} style={{ width: `${Math.min(share, 100)}%` }}></div>
                      </div>
                      <div className="flex flex-col text-right w-16">
                        <span className="text-xs font-black text-gray-800">{share}%</span>
                        <span className="text-[9px] font-bold text-gray-400 uppercase truncate" title={c.courier}>{c.courier}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Map className="w-4 h-4 text-[#233b6b]" /> 10. Mapa SLA (Real)</span><button onClick={() => abrirAnalisis("Mapa de Calor SLA")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            
            {/* TARJETA M10 ACTUALIZADA CON ÍNDICES */}
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 gap-2 text-[10px] font-bold text-center text-white items-center content-start">
              {slaStats.mapaZonas.length === 0 ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Sin datos de SLA finalizados</p> : slaStats.mapaZonas.slice(0, 12).map((z: any, i: number) => {
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
        </div>

        {/* BLOQUE 4: NPS DINÁMICO */}
        <div className="pb-10">
           <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2">
             <HeartHandshake className="w-5 h-5 text-indigo-500" /> 11. Experiencia del Consumidor (NPS Transaccional)
           </h3>
           <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
             
             <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
               <div className="lg:col-span-3 p-8 flex flex-col items-center justify-center bg-gray-50/50">
                 <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">NPS Global</p>
                 <div className={`w-32 h-32 rounded-full border-8 flex items-center justify-center bg-white shadow-inner mb-4 ${nps.global >= 0 ? 'border-green-500' : 'border-red-500'}`}>
                   <span className="text-5xl font-black text-gray-800">{nps.global > 0 ? `+${nps.global}` : nps.global}</span>
                 </div>
                 <div className="w-full space-y-2 mt-2 max-w-[200px]">
                   <div className="flex justify-between text-xs font-bold"><span className="text-green-600 flex items-center gap-1"><Smile className="w-3.5 h-3.5"/> Promotores</span><span>{nps.promotores}%</span></div>
                   <div className="flex justify-between text-xs font-bold"><span className="text-yellow-600 flex items-center gap-1"><Meh className="w-3.5 h-3.5"/> Pasivos</span><span>{nps.pasivos}%</span></div>
                   <div className="flex justify-between text-xs font-bold"><span className="text-red-600 flex items-center gap-1"><Frown className="w-3.5 h-3.5"/> Detractores</span><span>{nps.detractores}%</span></div>
                 </div>
               </div>

               <div className="lg:col-span-6 p-8 flex flex-col">
                 <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
                   <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Motor de Cruces (NPS por Atributo)</h4>
                   <select 
                     value={npsDimension}
                     onChange={(e) => setNpsDimension(e.target.value)}
                     className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold rounded-lg px-3 py-2 outline-none cursor-pointer w-full sm:w-auto"
                   >
                     <option value="courier">Por Courier</option>
                   </select>
                 </div>
                 
                 <div className="space-y-6 flex-1 flex flex-col justify-center">
                   {npsDimension === 'courier' && (
                     Object.keys(nps.porCourier || {}).length === 0 ? (
                       <p className="text-sm text-gray-400 text-center font-bold">Sin datos de encuestas para graficar</p>
                     ) : (
                       Object.entries(nps.porCourier).map(([nombreCourier, stats]: any) => {
                         const maxPosible = 100;
                         const porcentajePositivo = stats.scoreNps > 0 ? Math.min((stats.scoreNps / maxPosible) * 100, 100) : 0;
                         const colorBarra = stats.scoreNps >= 30 ? 'bg-green-500' : stats.scoreNps >= 0 ? 'bg-yellow-400' : 'bg-red-500';
                         const colorTexto = stats.scoreNps >= 30 ? 'text-green-600' : stats.scoreNps >= 0 ? 'text-yellow-600' : 'text-red-600';

                         return (
                           <div key={`nps-${nombreCourier}`}>
                             <div className="flex justify-between text-xs font-bold mb-1">
                               <span>{nombreCourier} <span className="text-gray-400 font-medium text-[10px]">({stats.total} votos)</span></span>
                               <span className={colorTexto}>{stats.scoreNps > 0 ? `+${stats.scoreNps}` : stats.scoreNps}</span>
                             </div>
                             <div className="w-full bg-gray-100 rounded-full h-2">
                               <div className={`${colorBarra} h-2 rounded-full transition-all duration-1000`} style={{ width: `${Math.max(porcentajePositivo, 5)}%` }}></div>
                             </div>
                           </div>
                         );
                       })
                     )
                   )}
                 </div>
               </div>

               <div className="lg:col-span-3 bg-white flex flex-col h-full">
                 <div className="p-4 border-b border-gray-100 shrink-0">
                   <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Últimos Feedbacks</h4>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[300px]">
                    {nps.ultimosComentarios && nps.ultimosComentarios.length > 0 ? (
                      nps.ultimosComentarios.map((comentario: any, idx: number) => (
                        <div key={`com-${idx}`} className={`p-3 rounded-lg border ${comentario.score >= 9 ? 'bg-green-50 border-green-100' : comentario.score >= 7 ? 'bg-yellow-50 border-yellow-100' : 'bg-red-50 border-red-100'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${comentario.score >= 9 ? 'bg-green-100 text-green-700' : comentario.score >= 7 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                              {comentario.score >= 9 ? <Smile className="w-3 h-3"/> : comentario.score >= 7 ? <Meh className="w-3 h-3"/> : <Frown className="w-3 h-3"/>}
                              Score: {comentario.score}
                            </span>
                            <span className="text-[9px] text-gray-400 font-mono truncate max-w-[80px]">{comentario.tracking}</span>
                          </div>
                          <p className="text-xs text-gray-700 font-medium italic">"{comentario.comentario}"</p>
                          <div className="mt-2 text-[10px] font-bold text-gray-400 flex gap-2"><span>{comentario.courier}</span></div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-400 text-center mt-10">Esperando respuestas de usuarios...</p>
                    )}
                 </div>
               </div>

             </div>
           </div>
        </div>

      </div>
    </div>
  );
}