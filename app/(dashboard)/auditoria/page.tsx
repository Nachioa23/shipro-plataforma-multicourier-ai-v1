"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, ShieldAlert, CheckCircle2, X, Search, Filter, MapPin, Save, User, MessageCircle, Store, Clock, BugPlay, Loader2 } from 'lucide-react';

export default function AuditoriaCheckouts() {
  const [ordenes, setOrdenes] = useState<any[]>([]);
  const [selectedOrden, setSelectedOrden] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [simulando, setSimulando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [buscandoCP, setBuscandoCP] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Estados del formulario inteligente
  const [formCP, setFormCP] = useState("");
  const [formProvincia, setFormProvincia] = useState("");
  const [formLocalidadesDisponibles, setFormLocalidadesDisponibles] = useState<string[]>([]);
  const [formLocalidadSeleccionada, setFormLocalidadSeleccionada] = useState("");
  
  // Estados para los campos manuales
  const [formCalle, setFormCalle] = useState("");
  const [formAltura, setFormAltura] = useState("");
  const [formPiso, setFormPiso] = useState("");
  const [formDpto, setFormDpto] = useState("");
  const [formEntrecalles, setFormEntrecalles] = useState("");

  const cargarOrdenes = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/checkouts/pendientes'); 
      const data = await res.json();
      setOrdenes(data);
      if (data.length > 0) seleccionarOrden(data[0]);
      else setSelectedOrden(null);
    } catch (e) { console.error(e); }
    setCargando(false);
  };

  useEffect(() => { cargarOrdenes(); }, []);

  const seleccionarOrden = (orden: any) => {
    setSelectedOrden(orden);
    setFormCP(orden.cp || "");
    setFormCalle(orden.calle || "");
    setFormAltura(orden.altura || "");
    setFormPiso(orden.piso || "");
    setFormDpto(orden.dpto || "");
    setFormEntrecalles(orden.entrecalles || "");
  };

  // ==========================================
  // LA MAGIA REAL: Buscar en tu base de datos
  // ==========================================
  useEffect(() => {
    const buscarDatosGeograficos = async () => {
      if (!formCP || formCP.length < 4) {
        setFormLocalidadesDisponibles([]);
        setFormProvincia("");
        return;
      }

      setBuscandoCP(true);
      try {
        const res = await fetch(`/api/geografia/buscar?cp=${formCP}`);
        if (res.ok) {
          const data = await res.json();
          setFormProvincia(data.provincia);
          setFormLocalidadesDisponibles(data.localidades);
          setFormLocalidadSeleccionada(data.localidades[0]);
        } else {
          setFormLocalidadesDisponibles([]);
          setFormProvincia("");
        }
      } catch (error) {
        console.error("Error buscando CP", error);
      } finally {
        setBuscandoCP(false);
      }
    };

    // Usamos un pequeño "retraso" (debounce) para no saturar la base si tipean rápido
    const timeoutId = setTimeout(() => {
      buscarDatosGeograficos();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [formCP]);

  const simularVentaMala = async () => {
    setSimulando(true);
    try {
      const res = await fetch('/api/checkouts/evaluar', {
        method: 'POST',
        body: JSON.stringify({
          tienda: "Ropa Online S.A.",
          comprador: "Clara Larreguy",
          email: "clara@ejemplo.com",
          telefono: "1166778899",
          direccion: { calle: "Falsa Direccion sin Numero", cp: "123", localidad: "Mordor", provincia: "Buenos Aires" }
        })
      });
      if (res.ok) {
        mostrarToast("¡Venta interceptada por el Peaje!");
        cargarOrdenes();
      }
    } catch (e) { console.error(e); }
    setSimulando(false);
  };

  const guardarCorreccion = async () => {
    setGuardando(true);
    try {
      const res = await fetch('/api/checkouts/resolver', {
        method: 'POST',
        body: JSON.stringify({
          id: selectedOrden.id,
          calle: formCalle, altura: formAltura, piso: formPiso, dpto: formDpto,
          cp: formCP, localidad: formLocalidadSeleccionada, provincia: formProvincia, entrecalles: formEntrecalles
        })
      });
      
      if (res.ok) {
        mostrarToast("Dirección corregida. Etiqueta generada con éxito.");
        cargarOrdenes(); 
      }
    } catch (error) { console.error(error); } finally { setGuardando(false); }
  };

  const mostrarToast = (mensaje: string) => {
    setToastMessage(mensaje);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="flex flex-col h-full relative bg-gray-50">
      
      {toastMessage && (
        <div className="absolute top-20 right-8 z-50 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* CABECERA */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-red-500 rounded-lg"><ShieldAlert className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 leading-tight">Auditoría de Checkouts (Peaje)</h2>
            <p className="text-[11px] font-bold text-red-600 uppercase tracking-wider">Órdenes en Stand-by</p>
          </div>
        </div>
        
        <button onClick={simularVentaMala} disabled={simulando} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-xs border border-blue-200 hover:bg-blue-100 transition-colors">
          {simulando ? <Loader2 className="w-4 h-4 animate-spin" /> : <BugPlay className="w-4 h-4" />}
          [Test] Simular Venta con Error
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* PANEL IZQUIERDO */}
        <div className="w-1/3 min-w-[350px] border-r border-gray-200 bg-white flex flex-col h-full shadow-sm z-10">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-bold text-gray-700 text-sm">Escalado a Operador ({ordenes.length})</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cargando ? (
              <p className="text-center text-gray-400 text-sm py-10">Cargando...</p>
            ) : ordenes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-center px-4">
                 <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-4 border-4 border-green-100"><CheckCircle2 className="w-10 h-10 text-green-500" /></div>
                 <span className="text-base font-black text-gray-700 mb-2">Bandeja Limpia</span>
                 <p className="text-xs font-medium text-gray-500 max-w-[200px] leading-relaxed">No hay checkouts frenados pendientes.</p>
               </div>
            ) : (
              ordenes.map((orden) => (
                <div key={orden.id} onClick={() => seleccionarOrden(orden)} className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedOrden?.id === orden.id ? 'bg-red-50 border-red-300 shadow-sm ring-1 ring-red-100' : 'bg-white border-gray-200 hover:border-red-200 hover:shadow-sm'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded border border-red-200">SCORE: {orden.score}/100</span>
                    <span className="text-[10px] font-bold text-gray-400">{orden.tienda}</span>
                  </div>
                  <h4 className="font-bold text-gray-800 text-sm">{orden.id} - {orden.comprador}</h4>
                </div>
              ))
            )}
          </div>
        </div>

        {/* PANEL DERECHO */}
        <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-y-auto">
          {selectedOrden && (
             <div className="p-8 max-w-4xl mx-auto w-full">
            
             <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm mb-6 relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
               <h3 className="text-xs font-black text-red-500 uppercase mb-2 tracking-widest flex items-center gap-2">
                 <ShieldAlert className="w-4 h-4" /> Dato Crudo (Fallo Detectado)
               </h3>
               <p className="font-mono text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200">{selectedOrden.direccionCruda}</p>
               <p className="text-xs text-red-600 font-bold mt-3">Motivo del freno: {selectedOrden.problemas}</p>
             </div>
 
             {/* FORMULARIO INTELIGENTE CONECTADO A LA DB */}
             <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
               <h3 className="text-xs font-black text-gray-400 uppercase mb-6 tracking-widest flex items-center gap-2"><MapPin className="w-4 h-4" /> Resolución Manual</h3>
               
               <div className="grid grid-cols-12 gap-5 mb-6">
                 
                 {/* --- FILA 1: GEOGRAFÍA --- */}
                 <div className="col-span-12 md:col-span-4">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center justify-between">
                     C.P. (Disparador) {buscandoCP && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                   </label>
                   <input 
                     type="text" 
                     value={formCP} 
                     onChange={(e) => setFormCP(e.target.value)}
                     className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm font-black text-blue-700 focus:border-blue-500 outline-none transition-colors" 
                   />
                 </div>
                 <div className="col-span-12 md:col-span-4">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Provincia (Auto)</label>
                   <div className="relative">
                     <input type="text" value={formProvincia} readOnly placeholder="Esperando CP..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-600 cursor-not-allowed" />
                     {formProvincia && <CheckCircle2 className="w-4 h-4 text-green-500 absolute right-3 top-1/2 -translate-y-1/2" />}
                   </div>
                 </div>
                 <div className="col-span-12 md:col-span-4">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Localidad (Filtrada)</label>
                   <select 
                     value={formLocalidadSeleccionada}
                     onChange={(e) => setFormLocalidadSeleccionada(e.target.value)}
                     disabled={formLocalidadesDisponibles.length === 0}
                     className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                   >
                     {formLocalidadesDisponibles.length === 0 ? <option>Ingresá un CP válido...</option> : formLocalidadesDisponibles.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                   </select>
                 </div>
 
                 {/* --- FILA 2: DIRECCIÓN --- */}
                 <div className="col-span-12 md:col-span-6">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Calle</label>
                   <input type="text" value={formCalle} onChange={e => setFormCalle(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
                 <div className="col-span-4 md:col-span-2">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura</label>
                   <input type="text" value={formAltura} onChange={e => setFormAltura(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
                 <div className="col-span-4 md:col-span-2">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Piso</label>
                   <input type="text" value={formPiso} onChange={e => setFormPiso(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
                 <div className="col-span-4 md:col-span-2">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Dpto</label>
                   <input type="text" value={formDpto} onChange={e => setFormDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
 
                 {/* --- FILA 3: CONTEXTO --- */}
                 <div className="col-span-12">
                   <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Entrecalles / Referencias</label>
                   <input type="text" value={formEntrecalles} onChange={e => setFormEntrecalles(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
 
               </div>
 
               <div className="flex justify-end pt-4 border-t border-gray-100">
                 <button 
                   onClick={guardarCorreccion}
                   disabled={guardando || !formProvincia} // Deshabilita si el CP es malo
                   className="flex items-center justify-center gap-2 px-6 py-3 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-[#1a2c52] transition-all disabled:opacity-50"
                 >
                   {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 
                   Forzar y Generar Etiqueta
                 </button>
               </div>
             </div>
 
           </div>
          )}
        </div>
      </div>
    </div>
  );
}