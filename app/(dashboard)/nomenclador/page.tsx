"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Search, Filter, ArrowRightLeft, ShieldAlert, ChevronDown, AlertCircle, Loader2, Check, Truck } from 'lucide-react';
import { ESTADOS_COURIER } from "@/lib/utils/estados";

// F4.1 (2026-06-09): catalogo canonico de estados Shipro courier importado
// de lib/utils/estados.ts. Reemplaza el array hardcoded con prefijo S_*.
// Solo se muestran los 11 estados COURIER (no los 5 internos), porque el
// Nomenclador mapea raws del courier al ciclo del paquete, no a estados
// internos de la Plataforma.
const estadosShipro = (Object.values(ESTADOS_COURIER) as Array<{ key: string; display: string }>).map((e, idx) => ({
  id: e.key,
  nombre: `${idx + 1}. ${e.display}`,
  color: "bg-gray-100 text-gray-700 border-gray-200", // color generico, el admin no usa el color para nada critico
}));

export default function NomencladorEstados() {
  const { data: session } = useSession();
  
  // Ahora el estado inicial es "TODOS"
  const [courierFiltro, setCourierFiltro] = useState<string>("TODOS"); 
  
  const [listaCouriers, setListaCouriers] = useState<any[]>([]);
  const [nomencladores, setNomencladores] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  
  const [menuAbiertoId, setMenuAbiertoId] = useState<number | null>(null);

  // =========================================================
  // FETCH: Buscar estados y couriers reales
  // =========================================================
  const fetchDatos = async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/nomenclador?courierId=${courierFiltro}`);
      if (res.ok) {
        const data = await res.json();
        setListaCouriers(data.couriers);
        setNomencladores(data.nomencladores);
      }
    } catch (error) {
      console.error("Error al cargar datos");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    fetchDatos();
  }, [courierFiltro]);

  // =========================================================
  // GUARDAR: Actualizar la traducción
  // =========================================================
  const guardarMapeo = async (itemCourierId: number, estadoCrudo: string, codigoApi: string, nuevoEstadoShipro: string) => {
    setMenuAbiertoId(null);
    try {
      setNomencladores(prev => 
        prev.map(n => n.estadoCrudo === estadoCrudo && n.courierId === itemCourierId ? { ...n, estadoShipro: nuevoEstadoShipro } : n)
      );

      await fetch('/api/nomenclador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courierId: itemCourierId,
          estadoCrudo: estadoCrudo,
          codigoApi: codigoApi,
          estadoShipro: nuevoEstadoShipro
        })
      });
    } catch (error) {
      console.error("Error al guardar");
      fetchDatos();
    }
  };

  const simularLlegadaDeDatos = async () => {
    const primerCourierId = listaCouriers.length > 0 ? listaCouriers[0].id : 1;
    await fetch('/api/nomenclador', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courierId: primerCourierId, estadoCrudo: "Robo a mano armada", codigoApi: "SIN_ROB_01", estadoShipro: null })
    });
    fetchDatos();
  };

  const esAdminShipro = session?.user?.rol === 'admin_shipro';

  if (!esAdminShipro) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 text-center animate-in fade-in zoom-in-95 duration-300">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Denegado</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          El Nomenclador de Estados (TMS) es una herramienta de configuración de infraestructura de uso exclusivo para el rol de Súper Admin de Shipro.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto pb-[400px]">
      
      {/* ================= CABECERA ================= */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-30 shrink-0 shadow-sm sticky top-0">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-slate-900 rounded-lg">
            <ArrowRightLeft className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 leading-tight">Nomenclador de Estados (TMS)</h2>
            <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Traductor Universal de Couriers</p>
          </div>
        </div>
      </header>

      {/* ================= CONTENIDO ================= */}
      <div className="flex-1 p-8 overflow-visible">
        <div className="max-w-6xl mx-auto space-y-6">
          
          <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between shadow-sm relative z-10 gap-4">
             <div className="flex items-start gap-4">
               <ShieldAlert className="w-6 h-6 text-[#233b6b] shrink-0 mt-0.5" />
               <div>
                 <h3 className="text-sm font-bold text-gray-800 mb-1">Mapeo de Estados Logísticos</h3>
                 <p className="text-xs text-gray-500 leading-relaxed max-w-3xl">
                   Esta herramienta traduce el idioma técnico de cada Courier al estándar de Shipro. Seleccioná un courier específico o mirá todos los estados huérfanos al mismo tiempo.
                 </p>
                 <button onClick={simularLlegadaDeDatos} className="mt-3 text-xs font-bold text-blue-600 hover:text-blue-800 underline">
                   [Solo Testing] Simular estado no mapeado
                 </button>
               </div>
             </div>
             
             {/* Selector DINÁMICO de Courier */}
             <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Courier a configurar</label>
                <select 
                  value={courierFiltro}
                  onChange={(e) => setCourierFiltro(e.target.value)}
                  className="border-2 border-blue-100 rounded-lg px-4 py-2 text-sm bg-blue-50 font-bold text-[#233b6b] focus:outline-none focus:ring-2 focus:ring-[#233b6b] cursor-pointer w-full md:w-56 transition-colors hover:border-blue-300"
                >
                  <option value="TODOS">TODOS LOS COURIERS</option>
                  {listaCouriers.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.nombre} (ID: {c.id})</option>
                  ))}
                </select>
             </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-visible relative z-20 min-h-[400px]">
            <div className="p-4 bg-slate-50 border-b border-gray-200 flex items-center justify-between rounded-t-xl">
              <div className="relative w-80">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Buscar estado crudo o código..." className="w-full pl-9 pr-4 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" />
              </div>
            </div>
            
            <div className="overflow-visible">
              <table className="w-full text-left border-collapse whitespace-nowrap relative">
                <thead>
                  <tr className="bg-white border-b border-gray-200 text-xs uppercase tracking-wider text-gray-400 font-bold">
                    <th className="px-6 py-4 w-1/2">
                      Estado Crudo {courierFiltro !== "TODOS" && `(${listaCouriers.find(c=>c.id === Number(courierFiltro))?.nombre || ''})`}
                    </th>
                    <th className="px-6 py-4 text-center w-16"></th>
                    <th className="px-6 py-4 w-1/2">Estado Shipro (Universal)</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100 relative">
                  
                  {cargando ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        <span className="text-xs font-bold">Cargando diccionario...</span>
                      </td>
                    </tr>
                  ) : nomencladores.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-gray-400">
                        <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <span className="text-sm font-bold block">No hay estados registrados</span>
                        <span className="text-xs mt-1 block">Los couriers aún no han enviado información o el filtro está vacío.</span>
                      </td>
                    </tr>
                  ) : (
                    nomencladores.map((item) => {
                      const estadoAsignado = estadosShipro.find(e => e.id === item.estadoShipro);
                      const isMenuAbierto = menuAbiertoId === item.id;
                      
                      return (
                        <tr key={item.id} className={`transition-colors hover:bg-gray-50 group ${isMenuAbierto ? 'relative z-50' : 'relative z-0'}`}>
                          
                          <td className="px-6 py-4">
                            <div className="flex flex-col items-start gap-1">
                              {/* Si estamos en "TODOS", mostramos de qué courier es este estado */}
                              {courierFiltro === "TODOS" && (
                                <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase flex items-center gap-1 w-fit">
                                  <Truck className="w-3 h-3" /> {item.courier?.nombre || "Desconocido"}
                                </span>
                              )}
                              <span className="font-bold text-gray-800 text-base">{item.estadoCrudo}</span>
                              <span className="text-xs font-medium text-gray-400 font-mono">Código API: {item.codigoApi || 'N/A'}</span>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-center">
                            <ArrowRightLeft className="w-4 h-4 text-gray-300 mx-auto group-hover:text-blue-400 transition-colors" />
                          </td>

                          <td className="px-6 py-4 relative">
                            <div className="relative inline-block w-full max-w-[280px]">
                              
                              <button 
                                onClick={() => setMenuAbiertoId(isMenuAbierto ? null : item.id)}
                                className={`w-full flex items-center justify-between px-3 py-2 border rounded-lg cursor-pointer transition-colors shadow-sm ${
                                  estadoAsignado 
                                  ? estadoAsignado.color 
                                  : 'border-red-300 bg-red-50 text-red-600 hover:border-red-400 animate-pulse'
                                }`}
                              >
                                {estadoAsignado ? (
                                  <span className="text-xs font-bold uppercase tracking-wider">{estadoAsignado.nombre}</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Sin Asignar (Requerido)</span>
                                  </div>
                                )}
                                <ChevronDown className="w-4 h-4 opacity-50" />
                              </button>

                              {isMenuAbierto && (
                                <div className="absolute top-full left-0 mt-2 w-[320px] bg-white border border-gray-200 rounded-xl shadow-2xl z-[999] overflow-hidden flex flex-col max-h-[350px]">
                                  <div className="p-2 bg-slate-50 border-b border-gray-100 shrink-0">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2">Seleccionar traducción oficial</span>
                                  </div>
                                  <div className="overflow-y-auto flex-1 p-1">
                                    {estadosShipro.map(estado => (
                                      <button
                                        key={estado.id}
                                        // IMPORTANTE: Pasamos el item.courierId real para que no se mezcle
                                        onClick={() => guardarMapeo(item.courierId, item.estadoCrudo, item.codigoApi, estado.id)}
                                        className={`w-full text-left px-3 py-2.5 text-xs font-bold rounded-lg mb-1 flex items-center justify-between transition-colors
                                          ${estadoAsignado?.id === estado.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}
                                        `}
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className={`w-2 h-2 rounded-full ${estado.color.split(' ')[0]}`}></div>
                                          {estado.nombre}
                                        </div>
                                        {estadoAsignado?.id === estado.id && <Check className="w-4 h-4 text-blue-500" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}

                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}