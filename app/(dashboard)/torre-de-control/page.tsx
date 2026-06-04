"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { AlertCircle, Clock, Map, ArrowRightLeft, Target, Building2, Activity, Box, SlidersHorizontal, PackageCheck, Headset, TrendingDown, Truck, Store, MapPin, ZoomIn, X, BarChart, PieChart, HeartHandshake, Smile, Meh, Frown, MessageSquare, ShieldAlert, Loader2, Check, ShieldCheck, MapPinned, SearchCode, DollarSign, TrendingUp, Lightbulb, Calendar, CheckCircle2, Scale, Undo2, LifeBuoy, ListChecks, Timer, Star, Repeat, Wallet, Warehouse } from 'lucide-react';
import Link from "next/link"; 

export default function TorreDeControl() {
  const { data: session } = useSession();
  const [showFiltros, setShowFiltros] = useState(false);
  const [metricaAnalisis, setMetricaAnalisis] = useState<string | null>(null);
  const [zonaSlaSeleccionada, setZonaSlaSeleccionada] = useState<any | null>(null);

  // Selector del M11
  const [npsDimension, setNpsDimension] = useState('courier');

  const [metricas, setMetricas] = useState<any>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  // Torre de Control Metrica 1.1 (2026-06-04): endurecido el chequeo de rol Shipro.
  // Antes: includes('admin') || includes('shipro') — permitia false positives en roles
  // futuros tipo admin_cliente o admin_finanzas. Ahora: solo los dos roles canonicos
  // de equipo Shipro pasan. Alineado con resolverContext del server-side y con la
  // politica declarada: clientes NO entran a Torre de Control (tienen Panel de Control).
  const rolUsuario = session?.user?.rol || '';
  const esEquipoShipro = rolUsuario.startsWith('admin_shipro') || rolUsuario.startsWith('operador_shipro');
  const [listaClientes, setListaClientes] = useState<any[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<string>("TODAS");

  const [filtroRuteoDesde, setFiltroRuteoDesde] = useState("");
  const [filtroRuteoHasta, setFiltroRuteoHasta] = useState("");
  const [filtroRuteoServicio, setFiltroRuteoServicio] = useState("TODOS");
  const [filtroRuteoCourier, setFiltroRuteoCourier] = useState("TODOS");

  // Contadores globales de envíos bloqueados (DEUDA 16 saldo + DEUDA 27 depósito). Modo Dios.
  // Cards independientes: cada métrica tiene valor diagnóstico por separado.
  const [bloqueadosSaldoCount, setBloqueadosSaldoCount] = useState(0);
  const [bloqueadosDepositoCount, setBloqueadosDepositoCount] = useState(0);

  // Torre de Control Metrica 1.1 "Resolver Nomenclador" (DEUDA 39, 2026-06-04).
  // Datos del endpoint /api/torre-de-control/resolver-nomenclador. Sin scope
  // por empresa: el nomenclador es global a la plataforma.
  const [nomencladorMetrica, setNomencladorMetrica] = useState<any>(null);
  const [cargandoNomenclador, setCargandoNomenclador] = useState(true);

  useEffect(() => {
    if (!filtroEmpresaId) return;
    const baseParams = { filtroEmpresa: filtroEmpresaId, page: "1", limit: "1" };
    const paramsSaldo = new URLSearchParams({ ...baseParams, estado: "BloqueadosSaldo" });
    const paramsDeposito = new URLSearchParams({ ...baseParams, estado: "BloqueadosDeposito" });

    Promise.all([
      fetch(`/api/envios?${paramsSaldo}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
      fetch(`/api/envios?${paramsDeposito}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
    ])
      .then(([saldoData, depositoData]) => {
        setBloqueadosSaldoCount(saldoData.meta?.total || 0);
        setBloqueadosDepositoCount(depositoData.meta?.total || 0);
      })
      .catch(() => {
        setBloqueadosSaldoCount(0);
        setBloqueadosDepositoCount(0);
      });
  }, [filtroEmpresaId]);

  useEffect(() => {
    if (esEquipoShipro) {
      fetch("/api/clientes").then(res => res.json()).then(data => setListaClientes(data));
      setFiltroEmpresaId("TODAS");
    } else {
      setFiltroEmpresaId(session?.user?.empresaId?.toString() || "");
    }
  }, [esEquipoShipro, session]);

  useEffect(() => {
    const fetchMetricas = async () => {
      if (!filtroEmpresaId) return;
      setCargandoDatos(true);
      try {
        const params = new URLSearchParams();
        params.append("filtroEmpresa", filtroEmpresaId);
        if (filtroRuteoDesde) params.append("desde", filtroRuteoDesde);
        if (filtroRuteoHasta) params.append("hasta", filtroRuteoHasta);

        const res = await fetch(`/api/metricas?${params.toString()}`);
        const data = await res.json();
        setMetricas(data);
      } catch (err) {
        console.error("Error al cargar datos");
      } finally {
        setCargandoDatos(false);
      }
    };
    fetchMetricas();
  }, [filtroEmpresaId, filtroRuteoDesde, filtroRuteoHasta]);

  // Torre de Control Metrica 1.1: fetch del endpoint dedicado.
  // Sin dependencia de filtroEmpresaId porque el nomenclador es global.
  // El guard esEquipoShipro garantiza que solo Shipro haga la llamada
  // (igual el endpoint server-side rechaza no-Shipro con 403).
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoNomenclador(true);
    fetch("/api/torre-de-control/resolver-nomenclador")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setNomencladorMetrica(data);
        setCargandoNomenclador(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching resolver-nomenclador:", err);
        setCargandoNomenclador(false);
      });
  }, [esEquipoShipro]);

  const totalEnvios = metricas?.totalEnvios || 1;
  const tiempoColectaDias = metricas?.tiempoColectaPromedioDias ?? null;
  // Torre de Control Metrica 1.1 (2026-06-04): cambio de fuente.
  // Antes: metricas?.estadosSinMapear ?? 0 (endpoint generico /api/metricas).
  // Ahora: nomencladorMetrica?.cantidadNoMapeados ?? 0 (endpoint dedicado
  // /api/torre-de-control/resolver-nomenclador, ver useEffect arriba).
  const estadosHuerfanos = nomencladorMetrica?.cantidadNoMapeados ?? 0;
  const tasaSoporte = metricas?.tasaSoporte ?? 0;
  
  const nps = metricas?.nps || { global: 0, promotores: 0, pasivos: 0, detractores: 0, porCourier: {}, friccionEntrega: [], ultimosComentarios: [] };
  const slaStats = metricas?.slaStats || { indiceGlobal: 0, promedioPrepNacional: 0, cumplimientoE2E: 0, promedioPreparacion: 0, slaHealthIndex: 0, mapaZonas: [] };

  let couriersLista: string[] = [];
  if (metricas && metricas.nombresCouriers) {
    couriersLista = metricas.nombresCouriers.map((c:any) => c.nombre);
  }

  let pctSameDay = 0; let pctSucursal = 0; let pctEstandar = 0;
  if (metricas && metricas.modalidades) {
    const countSameDay = metricas.modalidades.find((x:any) => x.modalidad === 'Same-Day' || x.modalidad?.includes('Same'))?._count?.modalidad || 0;
    const countSucursal = metricas.modalidades.find((x:any) => x.modalidad === 'Sucursal' || x.modalidad?.includes('Sucursal'))?._count?.modalidad || 0;
    const countEstandar = metricas.modalidades.find((x:any) => x.modalidad === 'Estándar' || x.modalidad?.includes('Estándar') || x.modalidad?.includes('domicilio'))?._count?.modalidad || 0;

    pctSameDay = Math.round((countSameDay / totalEnvios) * 100);
    pctSucursal = Math.round((countSucursal / totalEnvios) * 100);
    pctEstandar = Math.round((countEstandar / totalEnvios) * 100);
  }

  let topCouriers: any[] = [];
  if (metricas && metricas.couriers) {
    const cList = metricas.couriers.map((item:any) => {
      const nc = metricas.nombresCouriers?.find((x:any) => String(x.id) === String(item.courierId));
      const nombre = nc ? nc.nombre : (item.courierId || 'Desconocido');
      return { courier: nombre, cantidad: item._count?.courierId || 0 };
    });
    topCouriers = cList.sort((a:any, b:any) => b.cantidad - a.cantidad).slice(0, 3);
  }

  const coloresRiesgo = ['bg-yellow-400', 'bg-red-500', 'bg-purple-500'];

  if (!esEquipoShipro) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 text-center animate-in zoom-in-95 duration-300">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Denegado</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          La Torre de Control Analítica es una herramienta exclusiva para el equipo directivo de Shipro.
        </p>
      </div>
    );
  }

  const abrirAnalisis = (titulo: string) => {
    setMetricaAnalisis(titulo);
    if (titulo !== "Mapa de Calor SLA") setZonaSlaSeleccionada(null); 
  };

  const auditoriaStats = metricas?.auditoriaStats || { totalRetenidos: 0, porcentajeFallaOrigen: 0, tasaAutoGestion: 0, tasaSoporte: 0, tiempoMedioCorreccion: "-", topProblemas: [] };
  const ruteoStats = metricas?.ruteoStats || { fugaFinancieraTotal: 0, enviosOptimizados: 0, enviosIneficientes: 0, costoPromedioExtra: 0, topDesvios: [] };
  const aforoStats = metricas?.aforoStats || { fugaTotal: 0, porcentajeFugaPeso: 0, desvioPromedioKg: 0, costoPromedioDesvio: 0, distribucionError: { leve: 0, moderado: 0, grave: 0 }, topEstrictos: [] };
  const efectividadStats = metricas?.efectividadStats || { tasaPrimeraVisita: 0, tasaEntregasForzadas: 0, tasaDevolucion: 0, costoInversaEstimado: 0, topMotivosFalla: [], mapaDevoluciones: [] };
  const soporteStats = metricas?.soporteStats || { tasaSoporte: 0, ticketsAbiertos: 0, tiempoMedioResolucion: "0h", distribucionEstados: { abiertos: 0, progreso: 0, resueltos: 0 }, topMotivos: [], creadorTicket: { clienteAutoServicio: 0, shiproRadar: 0 } };

  const fugaPeso = aforoStats.porcentajeFugaPeso;
  const efectividadGlobal = efectividadStats.tasaPrimeraVisita;
  const tasaSoporteGlobal = soporteStats.tasaSoporte;
  const formatPesos = (valor: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(valor);

  let insightRuteoP = "Enrutamiento 100% optimizado.";
  let insightRuteoS = "Tus envíos están utilizando las tarifas más eficientes disponibles. No se detectaron fugas de capital en el período y segmentación seleccionada.";
  let colorRuteo = "green"; let IconoRuteo = CheckCircle2;
  if (ruteoStats.fugaFinancieraTotal > 0 && ruteoStats.topDesvios.length > 0) {
    const peorFuga = ruteoStats.topDesvios[0];
    insightRuteoP = `Se están pagando ~${formatPesos(ruteoStats.costoPromedioExtra)} de más por paquete ineficiente.`;
    insightRuteoS = `Recomendamos ajustar reglas: priorizar "${peorFuga.sugerido}" para la zona de ${peorFuga.destino}.`;
    colorRuteo = "indigo"; IconoRuteo = Lightbulb;
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto pb-20 font-sans">
      
      {/* ============================================================== */}
      {/* MODAL DE ANÁLISIS PROFUNDO (DRILL-DOWN) COMPLETO */}
      {/* ============================================================== */}
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
            
            {metricaAnalisis === "Resolucion de Nomenclador" ? (
              <div className="p-8 space-y-6">
                {cargandoNomenclador ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando metrica...
                  </div>
                ) : !nomencladorMetrica ? (
                  <div className="text-gray-500">No se pudo cargar la metrica. Reintenta en unos segundos.</div>
                ) : (
                  <>
                    {/* RESUMEN AGREGADO */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Cobertura simple</p>
                        <p className="text-2xl font-black text-gray-900">
                          {nomencladorMetrica.porcentajeCoberturaSimple?.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {nomencladorMetrica.totalEstadosCrudos - nomencladorMetrica.cantidadNoMapeados} de {nomencladorMetrica.totalEstadosCrudos} estados mapeados
                        </p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Cobertura ponderada (ult. {nomencladorMetrica.ventanaDias} dias)</p>
                        {nomencladorMetrica.eventosConDato && nomencladorMetrica.porcentajeCoberturaPonderada !== null ? (
                          <>
                            <p className="text-2xl font-black text-gray-900">
                              {nomencladorMetrica.porcentajeCoberturaPonderada.toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">
                              {nomencladorMetrica.totalEventos - nomencladorMetrica.eventosSinMapeo} de {nomencladorMetrica.totalEventos} eventos cubiertos
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-400 mt-2">Aun sin datos suficientes.</p>
                            <p className="text-[10px] text-gray-400 mt-1">El campo se llenara con eventos nuevos del cron rastreo.</p>
                          </>
                        )}
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Estados sin mapear</p>
                        <p className="text-2xl font-black text-red-600">
                          {nomencladorMetrica.cantidadNoMapeados}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          Total catalogo: {nomencladorMetrica.totalEstadosCrudos}
                        </p>
                      </div>
                    </div>

                    {/* TOP ESTADOS SIN MAPEAR */}
                    {nomencladorMetrica.topEstadosSinMapear?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><ListChecks className="w-4 h-4" /> Top estados sin mapear</h3>
                          <Link href="/nomenclador" className="text-xs font-black text-blue-600">Ir a mapear &rarr;</Link>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Estado crudo</th>
                              <th className="text-left p-3 font-semibold">Courier</th>
                              <th className="text-right p-3 font-semibold">Frecuencia (ult. {nomencladorMetrica.ventanaDias}d)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {nomencladorMetrica.topEstadosSinMapear.map((item: any, idx: number) => (
                              <tr key={`${item.courierId}-${item.estadoCrudo}-${idx}`} className="border-t border-gray-100">
                                <td className="p-3 font-mono text-xs text-gray-700">{item.estadoCrudo}</td>
                                <td className="p-3 text-gray-700">{item.courierNombre}</td>
                                <td className="p-3 text-right font-bold text-gray-900">{item.frecuenciaEnVentana}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* DESGLOSE POR COURIER */}
                    {nomencladorMetrica.desglosePorCourier?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><SearchCode className="w-4 h-4" /> Cobertura por courier</h3>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Courier</th>
                              <th className="text-right p-3 font-semibold">Total estados</th>
                              <th className="text-right p-3 font-semibold">Sin mapear</th>
                              <th className="text-right p-3 font-semibold">Cobertura</th>
                            </tr>
                          </thead>
                          <tbody>
                            {nomencladorMetrica.desglosePorCourier.map((d: any) => (
                              <tr key={d.courierId} className="border-t border-gray-100">
                                <td className="p-3 font-semibold text-gray-900">{d.courierNombre}</td>
                                <td className="p-3 text-right text-gray-700">{d.totalEstadosCrudos}</td>
                                <td className={`p-3 text-right font-bold ${d.estadosNoMapeados > 0 ? 'text-red-600' : 'text-gray-400'}`}>{d.estadosNoMapeados}</td>
                                <td className="p-3 text-right text-gray-900">{d.porcentajeCobertura.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Auditoría de Direcciones (Peaje)" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-y-auto">
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                    <span className="text-gray-400 text-xs font-bold">a</span>
                    <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"/>
                  </div>
                </div>
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Tasa de Falla en Origen</h4>
                        <p className="text-4xl font-black text-red-600 mb-1">{auditoriaStats.porcentajeFallaOrigen}%</p>
                        <p className="text-[10px] font-bold text-gray-500">De los envíos totales entraron retenidos.</p>
                      </div>
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-center text-center">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Tiempo de Resolución</h4>
                        <p className="text-3xl font-black text-blue-600 mb-1 flex justify-center items-center gap-2"><Clock className="w-6 h-6" /> {auditoriaStats.tiempoMedioCorreccion}</p>
                        <p className="text-[10px] font-bold text-gray-500">Desde que se retiene hasta que se libera.</p>
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                      <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between">Origen de la Resolución</h4>
                      <div className="space-y-6">
                        <div>
                          <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><ShieldCheck className="w-4 h-4"/> Auto-Gestión (Comprador)</span><span className="text-green-700">{auditoriaStats.tasaAutoGestion}%</span></div>
                          <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${auditoriaStats.tasaAutoGestion}%` }}></div></div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm font-bold mb-2"><span className="text-orange-700 flex items-center gap-2"><Headset className="w-4 h-4"/> Soporte (Operador Shipro)</span><span className="text-orange-700">{auditoriaStats.tasaSoporte}%</span></div>
                          <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-orange-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${auditoriaStats.tasaSoporte}%` }}></div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
                      <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center gap-2"><SearchCode className="w-4 h-4 text-red-500"/> Top Motivos de Retención</h4>
                      <div className="space-y-4">
                        {auditoriaStats.topProblemas.length === 0 ? <p className="text-sm font-bold text-gray-400 text-center py-10">Sin datos operativos aún.</p> : auditoriaStats.topProblemas.map((prob:any, idx:number) => (
                             <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg flex justify-between items-center"><span className="text-xs font-bold text-red-800">{prob.motivo}</span><span className="text-xs font-black text-red-600 bg-white px-2 py-1 rounded-md shadow-sm">{prob.cant}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            ) : metricaAnalisis === "Fuga por Ruteo Ineficiente" ? (
              <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
                <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center shrink-0 shadow-sm z-10">
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{formatPesos(ruteoStats.fugaFinancieraTotal)}</p>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed">Dinero perdido por no utilizar la tarifa más económica habilitada en Shipro al momento del despacho.</p>
                      </div>

                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">Eficiencia de Enrutamiento</h4>
                        <div className="space-y-5">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> Envíos Optimizados (Ahorro)</span><span className="text-green-700">{ruteoStats.enviosOptimizados}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-green-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${ruteoStats.enviosOptimizados}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-2"><span className="text-red-600 flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Envíos Ineficientes (Fuga)</span><span className="text-red-600">{ruteoStats.enviosIneficientes}%</span></div>
                            <div className="w-full bg-gray-100 rounded-full h-4"><div className="bg-red-500 h-4 rounded-full transition-all duration-1000" style={{ width: `${ruteoStats.enviosIneficientes}%` }}></div></div>
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
                          {ruteoStats.topDesvios.length === 0 ? (
                            <p className="text-sm font-bold text-gray-400 text-center py-10">No se detectaron fugas de capital en la segmentación actual.</p>
                          ) : (
                            ruteoStats.topDesvios.map((desvio: any, idx: number) => (
                              <div key={`fuga-${idx}`} className="p-5 bg-white border border-gray-200 hover:border-purple-300 rounded-xl transition-all shadow-sm group">
                                <div className="flex justify-between items-start mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 font-black flex items-center justify-center text-xs">#{idx + 1}</div>
                                    <div>
                                      <h5 className="font-bold text-gray-800 text-sm">{desvio.sugerido}</h5>
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
                                    <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Se eligió</p><p className="text-xs font-bold text-gray-700">{desvio.elegidos}</p></div>
                                  </div>
                                  <div className="hidden sm:block text-gray-300"><ArrowRightLeft className="w-4 h-4" /></div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-8 bg-green-500 rounded-full"></div>
                                    <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Se Sugería</p><p className="text-xs font-bold text-gray-700">{desvio.sugerido}</p></div>
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
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                        <p className="text-5xl font-black text-gray-800 mb-2 tracking-tighter">{(totalEnvios || 0).toLocaleString()}</p>
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
                  {esEquipoShipro && (
                    <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50/50">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer max-w-[180px] truncate">
                        <option value="TODAS">Todo el Ecosistema</option>
                        {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  )}
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
                        const topShare = topCouriers.length > 0 ? Math.round((topCouriers[0].cantidad / totalEnvios) * 100) : 0; 
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
                              const nombre = c.courier || c[0];
                              const share = Math.round((c.cantidad / totalEnvios) * 100);
                              const isDominant = share >= 60;
                              return (
                                <div key={`spof-${idx}`} className="p-5 bg-gray-50 border border-gray-200 rounded-xl transition-all shadow-sm">
                                  <div className="flex justify-between items-end mb-3">
                                    <div>
                                      <h5 className="font-black text-gray-800 text-sm flex items-center gap-2">
                                        {nombre} 
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
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-6 shrink-0 sticky top-0 z-30 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-600/20 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
              <Activity className="w-7 h-7 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Torre de Control Shipro</h2>
              <p className="text-sm font-medium text-slate-400 mt-1">Inteligencia logística y rendimiento del ecosistema.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {cargandoDatos ? (
              <div className="px-4 py-2.5 rounded-lg text-sm font-bold bg-slate-800 border border-slate-700 text-blue-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Procesando base de datos...
              </div>
            ) : (
              <div className="px-4 py-2.5 rounded-lg text-sm font-bold bg-green-500/20 border border-green-500/30 text-green-400 flex items-center gap-2">
                <PackageCheck className="w-4 h-4" /> {totalEnvios.toLocaleString()} Envíos
              </div>
            )}
            <button onClick={() => setShowFiltros(!showFiltros)} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all border flex-1 sm:flex-none ${showFiltros ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
              <SlidersHorizontal className="w-4 h-4" /> Filtros Globales
            </button>
            <select className="px-4 py-2.5 border border-slate-700 rounded-lg text-sm font-bold text-white bg-slate-800 outline-none cursor-pointer appearance-none flex-1 sm:flex-none text-center sm:text-left">
              <option>Todo el Histórico</option>
              <option>Últimos 30 días</option>
              <option>Este mes</option>
            </select>
          </div>
        </div>

        {showFiltros && (
          <div className="mt-6 pt-6 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-4 fade-in duration-200">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Cliente / Cuenta</label>
              <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg p-2.5 outline-none cursor-pointer">
                <option value="TODAS">Todo el ecosistema (Global)</option>
                {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Courier</label>
              <select className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg p-2.5 outline-none"><option>Todos los couriers</option></select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Rango Fecha</label>
              <div className="flex gap-2">
                 <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="w-1/2 bg-slate-800 border border-slate-700 text-white text-[10px] rounded-lg p-2"/>
                 <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="w-1/2 bg-slate-800 border border-slate-700 text-white text-[10px] rounded-lg p-2"/>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-8">

        {/* Card de envíos bloqueados por saldo (DEUDA 16) — visibilidad operacional Modo Dios. */}
        {bloqueadosSaldoCount > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Wallet className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-900">
                  <span className="font-black">{bloqueadosSaldoCount}</span> envíos bloqueados por saldo
                  {filtroEmpresaId === "TODAS" ? " en el ecosistema" : " en esta empresa"}
                </p>
                <p className="text-xs text-amber-700">Esperan que el cliente recargue saldo. Se procesan automáticamente al recargar.</p>
              </div>
            </div>
            <Link href="/" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Ver bandeja →
            </Link>
          </div>
        )}

        {/* Card de envíos bloqueados por depósito (DEUDA 27) — visibilidad operacional Modo Dios. */}
        {bloqueadosDepositoCount > 0 && (
          <div className="bg-indigo-50 border border-indigo-300 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Warehouse className="w-5 h-5 text-indigo-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-indigo-900">
                  <span className="font-black">{bloqueadosDepositoCount}</span> envíos bloqueados por depósito
                  {filtroEmpresaId === "TODAS" ? " en el ecosistema" : " en esta empresa"}
                </p>
                <p className="text-xs text-indigo-700">Pendiente de configuración cliente. Se procesan automáticamente al configurar depósito predeterminado.</p>
              </div>
            </div>
            <Link href="/" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Ver bandeja →
            </Link>
          </div>
        )}

        {/* BLOQUE 1: TRIAGE */}
        <div>
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-500" /> Triage de Excepciones</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`bg-white border rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col h-full ${estadosHuerfanos > 0 ? 'border-red-300' : 'border-gray-200'}`}>
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><ArrowRightLeft className={estadosHuerfanos > 0 ? 'text-red-500' : 'text-gray-400'} /> 1. Resolver Nomenclador</h4>
              {cargandoNomenclador ? (
                <p className="text-xs text-gray-400 mb-4 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Cargando metrica...</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-1">
                    {estadosHuerfanos === 0
                      ? "Todos los codigos API mapeados."
                      : <span className="font-bold text-red-600">{estadosHuerfanos} codigos sin mapear.</span>}
                  </p>
                  {nomencladorMetrica && (
                    <p className="text-[10px] text-gray-400 mb-3">
                      Cobertura simple: {nomencladorMetrica.porcentajeCoberturaSimple?.toFixed(1)}%
                      {nomencladorMetrica.eventosConDato && nomencladorMetrica.porcentajeCoberturaPonderada !== null && (
                        <> · Ponderada: {nomencladorMetrica.porcentajeCoberturaPonderada.toFixed(1)}%</>
                      )}
                      {!nomencladorMetrica.eventosConDato && (
                        <> · Ponderada: aun sin datos</>
                      )}
                    </p>
                  )}
                </>
              )}
              <div className="mt-auto flex items-center gap-3">
                <button onClick={() => abrirAnalisis("Resolucion de Nomenclador")} className="text-xs font-black text-blue-600">Analizar</button>
                {estadosHuerfanos > 0 && <Link href="/nomenclador" className="text-xs font-black text-red-600">Mapear ahora</Link>}
              </div>
            </div>
            <div className={`bg-white border rounded-xl p-5 shadow-sm relative flex flex-col h-full ${auditoriaStats.totalRetenidos > 0 ? 'border-orange-300' : 'border-gray-200'}`}>
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><MapPinned className={auditoriaStats.totalRetenidos > 0 ? 'text-orange-500' : 'text-gray-400'} /> 2. Auditar Checkouts</h4>
              <p className="text-xs text-gray-500 mb-4 font-bold text-orange-600">{auditoriaStats.totalRetenidos} envíos retenidos.</p>
              <button onClick={() => abrirAnalisis("Auditoría de Direcciones (Peaje)")} className="text-xs font-black text-blue-600 text-left mt-auto">Analizar</button>
            </div>
            <div className="bg-white border border-purple-200 rounded-xl p-5 shadow-sm relative flex flex-col h-full">
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><Target className="text-purple-500" /> 3. Fuga por Ruteo</h4>
              <p className="text-xs text-gray-500 mb-4 font-black text-purple-700">{formatPesos(ruteoStats.fugaFinancieraTotal)}</p>
              <button onClick={() => abrirAnalisis("Fuga por Ruteo Ineficiente")} className="text-xs font-black text-blue-600 text-left mt-auto">Analizar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE 2: KPIs */}
        <div>
           <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600" /> Rendimiento Core</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${fugaPeso > 20 ? 'border-red-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Box className="text-red-500" /> 4. Desvío de Peso</p>
              <h3 className="text-3xl font-black mb-1">{fugaPeso}%</h3>
              <button onClick={() => abrirAnalisis("Desvío Financiero por Peso Volumétrico")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${efectividadGlobal < 85 ? 'border-orange-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><PackageCheck className="text-green-500" /> 5. Efec. 1ra Visita</p>
              <h3 className="text-3xl font-black mb-1">{efectividadGlobal}%</h3>
              <button onClick={() => abrirAnalisis("Efectividad de Entregas en 1ra Visita")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${tasaSoporteGlobal > 5 ? 'border-red-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Headset className="text-orange-500" /> 6. Carga de Soporte</p>
              <h3 className="text-3xl font-black mb-1">{tasaSoporteGlobal}%</h3>
              <button onClick={() => abrirAnalisis("Tasa de Tickets de Mesa de Ayuda")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><TrendingDown className="text-blue-500" /> 7. Tiempos Colecta</p>
              <h3 className="text-3xl font-black mb-1">{tiempoColectaDias !== null ? tiempoColectaDias : '...'} <span className="text-lg font-bold text-gray-400">días</span></h3>
              <button onClick={() => abrirAnalisis("Demora de Colecta en Origen")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE 3: ANÁLISIS VIVOS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase mb-6 flex items-center justify-between"><span><Store className="w-4 h-4 text-[#233b6b] inline mr-2" /> 8. Modalidades</span><button onClick={() => abrirAnalisis("Adopción de Modalidades")} className="p-1.5 bg-gray-50 hover:bg-blue-50 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="space-y-5 flex-1">
              <div><div className="flex justify-between text-xs font-bold mb-1"><span>Estándar</span><span>{pctEstandar}%</span></div><div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-slate-700 h-1.5 rounded-full" style={{ width: `${pctEstandar}%` }}></div></div></div>
              <div><div className="flex justify-between text-xs font-bold mb-1"><span>Same-Day</span><span className="text-purple-600">{pctSameDay}%</span></div><div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${pctSameDay}%` }}></div></div></div>
              <div><div className="flex justify-between text-xs font-bold mb-1"><span>Sucursal</span><span className="text-blue-600">{pctSucursal}%</span></div><div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pctSucursal}%` }}></div></div></div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase mb-6 flex items-center justify-between"><span><PieChart className="w-4 h-4 text-[#233b6b] inline mr-2" /> 9. Riesgo Courier</span><button onClick={() => abrirAnalisis("Concentración Courier")} className="p-1.5 bg-gray-50 hover:bg-blue-50 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 flex flex-col justify-center space-y-4">
              {topCouriers.length === 0 ? <p className="text-xs text-gray-400 text-center font-bold">Sin datos para graficar</p> : topCouriers.map((c: any, i: number) => (
                <div key={i} className="w-full flex items-center gap-2">
                  <div className="w-full bg-gray-100 rounded-full h-3"><div className={`${coloresRiesgo[i] || 'bg-gray-400'} h-3 rounded-full`} style={{ width: `${Math.round((c.cantidad / totalEnvios) * 100)}%` }}></div></div>
                  <div className="flex flex-col text-right w-16"><span className="text-xs font-black text-gray-800">{Math.round((c.cantidad / totalEnvios) * 100)}%</span><span className="text-[9px] text-gray-400 uppercase truncate" title={c.courier}>{c.courier}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Map className="w-4 h-4 text-[#233b6b]" /> 10. Mapa SLA (Real)</span><button onClick={() => abrirAnalisis("Mapa de Calor SLA")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 gap-2 text-[10px] font-bold text-center text-white items-center content-start">
              {slaStats.mapaZonas.length === 0 ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Sin datos de SLA finalizados</p> : slaStats.mapaZonas.slice(0, 12).map((z: any, i: number) => {
                const color = z.indice <= 0.8 ? 'bg-green-500' : z.indice <= 1 ? 'bg-blue-500' : 'bg-red-500';
                return (
                  <div key={i} className={`${color} rounded p-2 flex flex-col items-center justify-center shadow-sm hover:scale-105 transition-transform`} title={z.zona}>
                    <span className="truncate w-full block uppercase">{z.zona.substring(0,6)}</span>
                    <span className="text-[9px] text-white/90 block">Ix: {z.indice}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* BLOQUE 4: NPS DINÁMICO (MATRIZ COMPLETA PARA SUPER ADMIN) */}
        <div className="pb-10">
           <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2">
             <HeartHandshake className="w-5 h-5 text-indigo-500" /> 11. Experiencia del Consumidor (NPS Analítico)
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

               <div className="lg:col-span-5 p-8 flex flex-col">
                 <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
                   <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Motor de Cruces</h4>
                   <select 
                     value={npsDimension}
                     onChange={(e) => setNpsDimension(e.target.value)}
                     className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold rounded-lg px-3 py-2 outline-none cursor-pointer w-full sm:w-auto"
                   >
                     <option value="courier">Desglose por Courier</option>
                     <option value="friccion">Fricción de Entrega</option>
                   </select>
                 </div>
                 
                 <div className="space-y-6 flex-1 flex flex-col justify-center">
                   {npsDimension === 'courier' && (
                     Object.keys(nps.porCourier || {}).length === 0 ? (
                       <p className="text-sm text-gray-400 text-center font-bold">Sin datos de encuestas para graficar</p>
                     ) : (
                       Object.entries(nps.porCourier).map(([nombreCourier, stats]: any, idx) => {
                         const maxPosible = 100;
                         const porcentajePositivo = stats.scoreNps > 0 ? Math.min((stats.scoreNps / maxPosible) * 100, 100) : 0;
                         const colorBarra = stats.scoreNps >= 30 ? 'bg-green-500' : stats.scoreNps >= 0 ? 'bg-yellow-400' : 'bg-red-500';
                         const colorTexto = stats.scoreNps >= 30 ? 'text-green-600' : stats.scoreNps >= 0 ? 'text-yellow-600' : 'text-red-600';

                         return (
                           <div key={`nps-${idx}`}>
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

                   {npsDimension === 'friccion' && (
                     nps.friccionEntrega.length === 0 ? (
                       <p className="text-sm text-gray-400 text-center font-bold">Sin datos sobre la experiencia de entrega</p>
                     ) : (
                       nps.friccionEntrega.map((item: any, idx: number) => {
                         const max = nps.friccionEntrega[0].cantidad;
                         const pct = Math.round((item.cantidad / max) * 100);
                         const esMalo = item.motivo.toLowerCase().includes("tarde") || item.motivo.toLowerCase().includes("problemas") || item.motivo.toLowerCase().includes("dañado");
                         
                         return (
                           <div key={`fric-${idx}`}>
                             <div className="flex justify-between text-xs font-bold mb-1">
                               <span className="text-gray-600 truncate max-w-[80%]">{item.motivo}</span>
                               <span className="text-gray-800">{item.cantidad}</span>
                             </div>
                             <div className="w-full bg-gray-100 rounded-full h-2">
                               <div className={`${esMalo ? 'bg-orange-500' : 'bg-blue-500'} h-2 rounded-full transition-all duration-1000`} style={{ width: `${pct}%` }}></div>
                             </div>
                           </div>
                         );
                       })
                     )
                   )}
                 </div>
               </div>

               <div className="lg:col-span-4 bg-white flex flex-col h-full border-l border-gray-200">
                 <div className="p-4 border-b border-gray-100 shrink-0 flex justify-between items-center">
                   <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Últimos Feedbacks</h4>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[350px]">
                    {nps.ultimosComentarios && nps.ultimosComentarios.length > 0 ? (
                      nps.ultimosComentarios.map((c: any, idx: number) => (
                        <div key={`com-${idx}`} className={`p-3 rounded-xl border ${c.score >= 9 ? 'bg-green-50/50 border-green-100' : c.score >= 7 ? 'bg-yellow-50/50 border-yellow-100' : 'bg-red-50/50 border-red-100'}`}>
                          
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1 ${c.score >= 9 ? 'bg-green-100 text-green-700' : c.score >= 7 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                              NPS: {c.score}
                            </span>
                            <span className="text-[9px] text-gray-400 font-mono">{c.tracking}</span>
                          </div>
                          
                          <p className="text-xs text-gray-700 font-medium italic mb-2">"{c.comentario}"</p>
                          
                          <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-200/50">
                            {c.satisfaccionProducto && (
                              <div className="flex items-center gap-1" title="Satisfacción de Producto">
                                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500"/>
                                <span className="text-[10px] font-bold text-gray-600">{c.satisfaccionProducto}/5</span>
                              </div>
                            )}
                            {c.recompra !== null && (
                              <div className="flex items-center gap-1" title="Intención de Recompra">
                                <Repeat className="w-3 h-3 text-blue-500"/>
                                <span className="text-[10px] font-bold text-gray-600">{c.recompra}/10</span>
                              </div>
                            )}
                            <div className="ml-auto text-[9px] font-black text-gray-400 uppercase">{c.courier}</div>
                          </div>
                          
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