"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Search, Printer, CheckSquare, Square, FileText, AlertTriangle, X, Loader2, Calendar, ChevronLeft, ChevronRight, Ban, Truck, Building2, Clock, CheckCircle2 } from 'lucide-react';
import AccionesEnvio from '@/components/AccionesEnvio';
import { NOMBRES_DISPLAY } from "@/lib/couriers/serviciosSoportados";

export default function CentroEtiquetas() {
  const { data: session } = useSession();
  const brandColor = '#233b6b';
  
  const [envios, setEnvios] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [imprimiendo, setImprimiendo] = useState(false);
  
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalEnvios, setTotalEnvios] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [busqueda, setBusqueda] = useState("");
  const [filtroCourier, setFiltroCourier] = useState("Todos");
  
  // UX: Pestañas de segmentación
  const [tabActiva, setTabActiva] = useState<'pendientes' | 'historial'>('pendientes');

  // MODO DIOS: Selector de Empresas
  const rolUsuario = session?.user?.rol?.toLowerCase() || '';
  const esEquipoShipro = rolUsuario.includes('admin') || rolUsuario.includes('shipro');
  const [listaClientes, setListaClientes] = useState<any[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<string>("TODAS");

  // Menor 4 (2026-06-04): single source of truth desde NOMBRES_DISPLAY
  // (lib/couriers/serviciosSoportados.ts). Cuando se integre un courier nuevo,
  // el dropdown lo refleja automaticamente sin tocar este archivo.
  const couriersLista = Object.values(NOMBRES_DISPLAY);

  const [seleccionadas, setSeleccionadas] = useState<number[]>([]);
  const [alertaEtiqueta, setAlertaEtiqueta] = useState<{ id: number; motivo: 'impresa' | 'courier' | 'cancelada' } | null>(null);

  useEffect(() => {
    if (esEquipoShipro) {
      fetch("/api/clientes").then(res => res.json()).then(data => setListaClientes(data));
      setFiltroEmpresaId("TODAS");
    } else {
      setFiltroEmpresaId(session?.user?.empresaId?.toString() || "");
    }
  }, [esEquipoShipro, session]);

  const fetchEnvios = async () => {
    if (!filtroEmpresaId) return;
    setCargando(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: filtroEmpresaId,
        rol: session?.user?.rol || "cliente",
        filtroEmpresa: filtroEmpresaId,
        page: page.toString(),
        limit: limit.toString(),
        search: busqueda,
        courier: filtroCourier,
      });

      // LA LÓGICA DE SEGMENTACIÓN PERFECTA
      if (tabActiva === 'pendientes') {
        queryParams.append('estadoExacto', 'Pendiente'); // Solo quiero pendientes
      } else {
        queryParams.append('excluirEstado', 'Pendiente'); // Quiero TODO MENOS pendientes
      }

      const res = await fetch(`/api/envios?${queryParams}`);
      const result = await res.json();
      
      setEnvios(result.data || []);
      setTotalEnvios(result.meta?.total || 0);
      setTotalPages(result.meta?.totalPages || 1);
      
      setSeleccionadas([]);
    } catch (err) {
      console.error("Error al cargar etiquetas");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchEnvios();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [page, limit, busqueda, filtroCourier, filtroEmpresaId, tabActiva]);

  const handleFiltroChange = (setter: any, value: any) => {
    setter(value);
    setPage(1); 
  };

  const formatearFecha = (fechaString: string) => {
    if (!fechaString) return "Sin fecha";
    const fecha = new Date(fechaString);
    return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  const evaluarEstadoEtiqueta = (estado: string | undefined): 'cancelada' | 'courier' | 'impresa' | null => {
    if (!estado) return null;
    const est = estado.toLowerCase();
    
    if (est.includes("cancelad") || est.includes("anulad") || est.includes("rechazad")) return 'cancelada';
    if (["recolectado", "en distribución", "entregado", "en camino", "visitado"].includes(est)) return 'courier';
    
    // UNIFICACIÓN DE CRITERIO "IMPRESA"
    if (est.includes("impres") || est.includes("listo para retirar")) return 'impresa';
    
    return null; 
  };

  const toggleSeleccion = (id: number) => {
    const isSelected = seleccionadas.includes(id);
    const envio = envios.find(e => e.id === id);

    if (!isSelected && envio) {
      const motivoBloqueo = evaluarEstadoEtiqueta(envio.estadoActual);
      if (motivoBloqueo) {
        setAlertaEtiqueta({ id, motivo: motivoBloqueo });
        return; 
      }
    }

    if (isSelected) {
      setSeleccionadas(seleccionadas.filter(item => item !== id));
    } else {
      setSeleccionadas([...seleccionadas, id]);
    }
  };

  const confirmarReimpresionForzada = () => {
    if (alertaEtiqueta !== null) {
      setSeleccionadas([...seleccionadas, alertaEtiqueta.id]);
      setAlertaEtiqueta(null);
    }
  };

  const enviosImprimibles = envios.filter(e => evaluarEstadoEtiqueta(e.estadoActual) === null);
  const seleccionoTodasLasPendientes = enviosImprimibles.length > 0 && enviosImprimibles.every(e => seleccionadas.includes(e.id));

  const toggleTodas = () => {
    if (seleccionoTodasLasPendientes) {
      setSeleccionadas([]); 
    } else {
      const idsImprimibles = enviosImprimibles.map(e => e.id);
      setSeleccionadas(Array.from(new Set([...seleccionadas, ...idsImprimibles])));
    }
  };

  const imprimirSeleccionadas = async () => {
    setImprimiendo(true);
    try {
      const resPdf = await fetch("/api/etiquetas/masiva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: seleccionadas }),
      });

      if (!resPdf.ok) throw new Error("Error al compilar el PDF de etiquetas");

      const blob = await resPdf.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank'); 

      // UNIFICACIÓN DE ESTADO A "Impreso"
      await fetch("/api/envios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: seleccionadas, nuevoEstado: "Impreso" }),
      });
      
      setSeleccionadas([]);
      fetchEnvios(); 
    } catch (err) {
      console.error(err);
      alert("Error al compilar las etiquetas. Verificá la conexión.");
    } finally {
      setImprimiendo(false);
    }
  };

  const renderAlertaContenido = () => {
    if (!alertaEtiqueta) return null;
    const envioObj = envios.find(e => e.id === alertaEtiqueta.id);
    const tracking = envioObj?.trackingNumber || "Desconocido";

    const config = {
      impresa: {
        icono: <AlertTriangle className="w-8 h-8 text-amber-500" />, bg: "bg-amber-50", titulo: "Etiqueta Ya Impresa",
        texto: `El envío <strong>${tracking}</strong> ya fue marcado como impreso y listo para retiro. Reimprimirlo puede causar confusiones operativas.`, btnForce: "bg-amber-600 hover:bg-amber-700"
      },
      courier: {
        icono: <Truck className="w-8 h-8 text-blue-500" />, bg: "bg-blue-50", titulo: "En Poder del Courier",
        texto: `El envío <strong>${tracking}</strong> ya se encuentra en tránsito logístico (${envioObj?.estadoActual}). Imprimir otra etiqueta carece de validez e impacta en facturación.`, btnForce: "bg-blue-600 hover:bg-blue-700"
      },
      cancelada: {
        icono: <Ban className="w-8 h-8 text-red-500" />, bg: "bg-red-50", titulo: "Envío Cancelado",
        texto: `El envío <strong>${tracking}</strong> fue CANCELADO. Despachar esta mercadería resultará en una pérdida directa para la empresa.`, btnForce: "bg-red-600 hover:bg-red-700"
      }
    };

    const actual = config[alertaEtiqueta.motivo];

    return (
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative animate-in zoom-in-95 duration-200">
        <button onClick={() => setAlertaEtiqueta(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        <div className={`w-16 h-16 ${actual.bg} rounded-full flex items-center justify-center mb-6 mx-auto`}>{actual.icono}</div>
        <h3 className="text-xl font-bold text-center text-gray-800 mb-2">{actual.titulo}</h3>
        <p className="text-center text-gray-600 mb-6 text-sm" dangerouslySetInnerHTML={{ __html: actual.texto }}></p>
        <div className="flex gap-3">
          <button onClick={() => setAlertaEtiqueta(null)} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors text-sm">Cancelar</button>
          <button onClick={confirmarReimpresionForzada} className={`flex-1 px-4 py-3 text-white font-bold rounded-xl transition-colors shadow-sm text-sm ${actual.btnForce}`}>Forzar Selección</button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-hidden font-sans">
      
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Printer className="w-5 h-5 text-blue-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Centro de Impresión</h2>
        </div>
      </header>

      {alertaEtiqueta && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          {renderAlertaContenido()}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[90rem] mx-auto w-full space-y-6 pb-32">
          
          {/* BARRA DE FILTROS Y MODO DIOS */}
          <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 items-center">
            
            {esEquipoShipro && (
              <div className="flex-shrink-0 w-full lg:w-64 border-r pr-4">
                <label className="block text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 flex items-center gap-1"><Building2 className="w-3 h-3"/> Viendo envíos de:</label>
                <select value={filtroEmpresaId} onChange={(e) => handleFiltroChange(setFiltroEmpresaId, e.target.value)} className="w-full border border-indigo-200 bg-indigo-50 text-indigo-900 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none cursor-pointer">
                  <option value="TODAS">🌟 TODAS LAS EMPRESAS</option>
                  {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}

            <div className="relative flex-1 w-full">
              <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar por destinatario o tracking..." 
                value={busqueda}
                onChange={(e) => handleFiltroChange(setBusqueda, e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]" 
              />
            </div>
            
            <div className="flex-shrink-0 min-w-[200px] w-full lg:w-auto">
              <select 
                value={filtroCourier}
                onChange={(e) => handleFiltroChange(setFiltroCourier, e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer"
              >
                <option value="Todos">Todos los Couriers</option>
                {couriersLista.map((courier) => <option key={courier} value={courier}>{courier}</option>)}
              </select>
            </div>

            {(busqueda || filtroCourier !== "Todos") && (
              <button 
                onClick={() => { setBusqueda(""); setFiltroCourier("Todos"); setPage(1); }}
                className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full lg:w-auto"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* UX: PESTAÑAS DE SEGMENTACIÓN */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            
            <div className="flex border-b border-gray-200 bg-gray-50/50">
              <button 
                onClick={() => {setTabActiva('pendientes'); setPage(1);}}
                className={`flex-1 sm:flex-none px-6 py-4 text-sm font-black border-b-2 flex items-center justify-center gap-2 transition-colors ${tabActiva === 'pendientes' ? 'border-[#233b6b] text-[#233b6b] bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                <Clock className="w-4 h-4" /> Pendientes de Impresión
              </button>
              <button 
                onClick={() => {setTabActiva('historial'); setPage(1);}}
                className={`flex-1 sm:flex-none px-6 py-4 text-sm font-black border-b-2 flex items-center justify-center gap-2 transition-colors ${tabActiva === 'historial' ? 'border-[#233b6b] text-[#233b6b] bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                <CheckCircle2 className="w-4 h-4" /> Historial de Etiquetas
              </button>
            </div>

            <div className="overflow-x-auto min-h-[400px]">
              {cargando ? (
                <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p className="font-bold text-sm">Consultando Base de Datos...</p>
                </div>
              ) : envios.length === 0 ? (
                <div className="bg-white p-16 text-center flex flex-col items-center">
                  <FileText className="w-12 h-12 text-gray-300 mb-4" />
                  <h3 className="text-lg font-bold text-gray-800">
                    {tabActiva === 'pendientes' ? '¡Excelente! Estás al día.' : 'No hay historial para mostrar'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 max-w-sm">
                    {tabActiva === 'pendientes' 
                      ? 'No tenés etiquetas pendientes de impresión en este momento.' 
                      : 'No se encontraron etiquetas con los filtros aplicados.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-white border-b border-gray-200 text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                      <th className="px-6 py-4 w-10 cursor-pointer text-center" onClick={toggleTodas} title="Seleccionar SOLO pendientes de impresión">
                        {seleccionoTodasLasPendientes ? (
                          <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-300 hover:text-gray-400 transition-colors mx-auto" />
                        )}
                      </th>
                      <th className="px-6 py-4">Trazabilidad</th>
                      <th className="px-6 py-4">Destinatario</th>
                      <th className="px-6 py-4">Courier</th>
                      <th className="px-6 py-4">Generada</th>
                      <th className="px-6 py-4">Est. Operativo</th>
                      <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-gray-100">
                    
                    {envios.map((envio) => {
                      const motivoBloqueo = evaluarEstadoEtiqueta(envio.estadoActual);
                      const esImprimible = motivoBloqueo === null;
                      
                      const destinatario = envio.destino?.nombre || envio.destinatarioNombre || 'Sin Nombre';
                      const cp = envio.destino?.cp || envio.cpDestino || '';

                      return (
                        <tr 
                          key={envio.id} 
                          className={`transition-all duration-200 group 
                            ${motivoBloqueo === 'cancelada' ? 'bg-red-50/50 opacity-60 grayscale-[50%]' : ''}
                            ${(motivoBloqueo === 'impresa' || motivoBloqueo === 'courier') ? 'bg-gray-50/70 opacity-70 grayscale-[30%]' : ''}
                            ${esImprimible ? 'hover:bg-blue-50/30' : ''} 
                            ${seleccionadas.includes(envio.id) ? '!bg-blue-50/80 ring-1 ring-blue-100 inset-0 grayscale-0 opacity-100' : ''}`}
                        >
                          <td className="px-6 py-4 cursor-pointer text-center" onClick={() => toggleSeleccion(envio.id)}>
                            {seleccionadas.includes(envio.id) ? (
                              <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto" />
                            ) : (
                              <Square className={`w-4 h-4 mx-auto transition-colors ${!esImprimible ? 'text-gray-200' : 'text-gray-300 group-hover:text-gray-400'}`} />
                            )}
                          </td>
                          
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1.5 items-start">
                              <div className="flex items-center gap-2" title="Tracking Principal (Last-Mile)">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-14 text-right">Entrega</span>
                                <p className="font-bold text-[#233b6b] text-xs font-mono bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">{envio.trackingNumber}</p>
                              </div>
                              {/* TODO DEUDA 29 Sub-fase 3: mostrar trackings de TramoEnvio (1..N por envío) en lugar del trackingFirstMile legacy. */}
                              {esEquipoShipro && filtroEmpresaId === "TODAS" && (
                                <p className="text-[9px] font-bold text-indigo-500 mt-1 uppercase truncate max-w-[150px] ml-16">De: {envio.empresa?.nombre}</p>
                              )}
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <p className="font-bold text-gray-800 text-xs">{destinatario}</p>
                            <p className="text-[10px] text-gray-500 font-medium">CP: {cp}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border bg-white ${
                                envio.courierId === 1 ? 'text-purple-700 border-purple-200' :
                                envio.courierId === 2 ? 'text-red-700 border-red-200' :
                                'text-yellow-700 border-yellow-200'
                              }`}>
                              {envio.courier?.nombre || 'Genérico'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-500 text-xs font-medium">
                            {formatearFecha(envio.fechaImpresion || envio.createdAt || envio.fechaCreacion)}
                          </td>
                          <td className="px-6 py-4">
                            {motivoBloqueo === 'cancelada' && (
                               <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-2 py-1 rounded shadow-sm"><Ban className="w-3 h-3" /> Cancelada</span>
                            )}
                            {motivoBloqueo === 'courier' && (
                               <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-blue-700 bg-blue-100 border border-blue-200 px-2 py-1 rounded shadow-sm"><Truck className="w-3 h-3" /> En Tránsito</span>
                            )}
                            {motivoBloqueo === 'impresa' && (
                               <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600 bg-gray-100 border border-gray-200 px-2 py-1 rounded shadow-sm"><CheckSquare className="w-3 h-3" /> Ya Impresa</span>
                            )}
                            {esImprimible && (
                              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> Pendiente
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <AccionesEnvio 
                              tracking={envio.trackingNumber} 
                              etiquetaUrl={envio.etiquetaUrl} 
                              estadoInterno={envio.estadoActual} 
                              envioId={envio.id}
                              motivoBloqueo={motivoBloqueo}
                            />
                          </td>
                        </tr>
                      )
                    })}

                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 bg-white border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500">Filas por página:</span>
                <select 
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm font-bold text-gray-700 focus:outline-none cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-500">
                  Página <strong className="text-gray-800">{page}</strong> de <strong className="text-gray-800">{totalPages || 1}</strong>
                </span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || cargando}
                    className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || totalPages === 0 || cargando}
                    className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <div 
        className={`absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.06)] transition-transform duration-300 z-20 flex justify-between items-center px-8
          ${seleccionadas.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-lg font-black text-blue-700">{seleccionadas.length}</span>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-gray-800">Seleccionadas</p>
            <p className="text-xs text-gray-500 font-medium">Listas para compilar y enviar a impresora.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setSeleccionadas([])}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors text-sm shadow-sm"
          >
            Cancelar
          </button>
          
          <button 
            onClick={imprimirSeleccionadas}
            disabled={imprimiendo}
            className="flex items-center gap-2 px-6 py-2.5 text-white font-bold rounded-lg shadow-md hover:opacity-90 transition-opacity text-sm disabled:opacity-50 disabled:cursor-not-allowed" 
            style={{ backgroundColor: brandColor }}>
            {imprimiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Compilar e Imprimir
          </button>
        </div>
      </div>

    </div>
  );
}