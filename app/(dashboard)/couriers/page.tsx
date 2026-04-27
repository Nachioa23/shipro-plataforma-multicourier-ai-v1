"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Route, MapPin, Truck, Plus, Trash2, Save, ShieldAlert, ArrowRight, Settings2, AlertTriangle, Play, Map, DollarSign, Star, History, Target } from 'lucide-react';

export default function ReglasLogisticas() {
  const brandColor = '#233b6b';
  const { data: session } = useSession();
  
  // ================= SEGURIDAD Y ROLES =================
  const rolActual = session?.user?.rol || 'operador_cliente'; 
  const esEquipoShipro = rolActual === 'operador_shipro' || rolActual === 'admin_shipro';

  const [activeTab, setActiveTab] = useState<'cordones' | 'reglas'>('reglas');

  // Si un cliente intenta entrar, lo bloqueamos
  if (!esEquipoShipro) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 animate-in zoom-in-95 duration-300 text-center">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Restringido</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          El Motor de Ruteo Inteligente es una configuración del núcleo (Core) exclusiva para administradores de Shipro.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto pb-20 font-sans">
      
      {/* ================= CABECERA EXCLUSIVA SHIPRO ================= */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-purple-600/20 border border-purple-500/30">
              <Route className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Motor de Ruteo Inteligente</h2>
              <p className="text-sm font-medium text-slate-400 mt-1 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-yellow-500" /> Algoritmos de decisión basados en valor y comportamiento.
              </p>
            </div>
          </div>
          <button className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors shadow-sm">
            <Save className="w-4 h-4" /> Guardar Motor
          </button>
        </div>

        {/* Solapas (Tabs) */}
        <div className="flex gap-6 mt-8">
          <button 
            onClick={() => setActiveTab('reglas')}
            className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reglas' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <Settings2 className="w-4 h-4" /> Algoritmos de Asignación
          </button>
          <button 
            onClick={() => setActiveTab('cordones')}
            className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'cordones' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <Map className="w-4 h-4" /> Zonas y Cordones
          </button>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">

        {/* ================= SOLAPA 1: REGLAS DE RUTEO (VALUE-DRIVEN) ================= */}
        {activeTab === 'reglas' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 rounded-xl border border-gray-200 shadow-sm gap-4">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-500" /> Jerarquía de Decisión
                </h3>
                <p className="text-xs text-gray-500 mt-1">El motor lee de <strong>arriba hacia abajo</strong>. La primera condición que se cumpla, ejecuta la acción y detiene el análisis.</p>
              </div>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
                <Plus className="w-4 h-4" /> Nuevo Algoritmo
              </button>
            </div>

            {/* REGLA 1: COMPORTAMIENTO PREVIO (Afinidad) */}
            <div className="bg-white border-2 border-l-4 border-l-pink-500 border-gray-200 rounded-xl shadow-sm overflow-hidden group">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="bg-pink-100 text-pink-700 text-xs font-black px-2.5 py-1 rounded">Prioridad 1</span>
                  <h3 className="text-sm font-bold text-gray-800">Fidelización: Memoria de Usuario</h3>
                </div>
                <button className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="p-5 flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-gray-500">SI el comprador</span>
                  <span className="bg-pink-50 text-pink-700 border border-pink-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><History className="w-3.5 h-3.5"/> Ya compró anteriormente</span>
                </div>
                <ArrowRight className="w-6 h-6 text-gray-300 hidden md:block" />
                <div className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center gap-3 shadow-md min-w-[280px]">
                  <Star className="w-5 h-5 text-pink-400 fill-current" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Acción del Motor</p>
                    <p className="text-sm font-black">Sugerir su courier favorito</p>
                  </div>
                </div>
              </div>
            </div>

            {/* REGLA 2: TICKETS ALTOS (Premium) */}
            <div className="bg-white border-2 border-l-4 border-l-yellow-500 border-gray-200 rounded-xl shadow-sm overflow-hidden group">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="bg-yellow-100 text-yellow-700 text-xs font-black px-2.5 py-1 rounded">Prioridad 2</span>
                  <h3 className="text-sm font-bold text-gray-800">Experiencia Wow: Ticket +$200.000</h3>
                </div>
                <button className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="p-5 flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-gray-500">SI el carrito es</span>
                  <span className="bg-yellow-50 text-yellow-700 border border-yellow-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><DollarSign className="w-3.5 h-3.5"/> Mayor a $ 200.000</span>
                </div>
                <ArrowRight className="w-6 h-6 text-gray-300 hidden md:block" />
                <div className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center gap-3 shadow-md min-w-[280px]">
                  <Truck className="w-5 h-5 text-yellow-400" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Acción del Motor</p>
                    <p className="text-sm font-black text-yellow-400">Filtrar por NPS Alto + Same Day</p>
                  </div>
                </div>
              </div>
            </div>

            {/* REGLA 3: TICKETS MEDIOS (SLA) */}
            <div className="bg-white border-2 border-l-4 border-l-blue-500 border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="bg-blue-100 text-blue-700 text-xs font-black px-2.5 py-1 rounded">Prioridad 3</span>
                  <h3 className="text-sm font-bold text-gray-800">Calidad Segura: Ticket Promedio</h3>
                </div>
                <button className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="p-5 flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-gray-500">SI el carrito está</span>
                  <span className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg font-bold">Entre $ 100.000 y $ 200.000</span>
                </div>
                <ArrowRight className="w-6 h-6 text-gray-300 hidden md:block" />
                <div className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center gap-3 shadow-md min-w-[280px]">
                  <ShieldAlert className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Acción del Motor</p>
                    <p className="text-sm font-black">Priorizar Mejor SLA de Entrega</p>
                  </div>
                </div>
              </div>
            </div>

            {/* REGLA 4: TICKETS BAJOS (Costo < 10%) */}
            <div className="bg-white border-2 border-l-4 border-l-emerald-500 border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="bg-emerald-100 text-emerald-700 text-xs font-black px-2.5 py-1 rounded">Prioridad 4</span>
                  <h3 className="text-sm font-bold text-gray-800">Protección de Margen: Tickets Bajos</h3>
                </div>
                <button className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="p-5 flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-gray-500">SI el carrito es</span>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><DollarSign className="w-3.5 h-3.5"/> Menor a $ 100.000</span>
                </div>
                <ArrowRight className="w-6 h-6 text-gray-300 hidden md:block" />
                <div className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center gap-3 shadow-md min-w-[280px]">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Acción del Motor</p>
                    <p className="text-sm font-black text-emerald-400">Tope de Costo (Máx 10% del Ticket)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Regla Catch-all (Default) */}
            <div className="bg-gray-200 border border-gray-300 rounded-xl p-5 flex items-center justify-between opacity-80 mt-8">
              <div>
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-gray-500"/> Regla por Defecto (Fallback)</h3>
                <p className="text-xs text-gray-500 mt-1">Si no se cumple ninguna condición (Ej: Falla la API del E-commerce y no sabemos el precio del carrito), mostrar tarifas estándar ordenadas por precio.</p>
              </div>
            </div>

            {/* Simulador de Ruteo */}
            <div className="mt-8 bg-[#233b6b] rounded-2xl p-6 shadow-lg text-white">
              <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><Play className="w-4 h-4 text-green-400 fill-current"/> Simulador de Motor (Test de Algoritmos)</h3>
              <div className="flex gap-4 items-end flex-wrap">
                <div className="flex-1 min-w-[150px]">
                  <label className="text-xs font-bold text-blue-200 mb-1 block">Valor del Carrito ($)</label>
                  <input type="number" placeholder="Ej: 85000" className="w-full bg-blue-900/50 border border-blue-400/30 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-300 placeholder:text-blue-300/50" />
                </div>
                <div className="flex-1 min-w-[150px]">
                  <label className="text-xs font-bold text-blue-200 mb-1 block">Email del Comprador</label>
                  <input type="email" placeholder="Para test de memoria..." className="w-full bg-blue-900/50 border border-blue-400/30 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-300 placeholder:text-blue-300/50" />
                </div>
                <button className="px-8 py-2.5 bg-green-500 hover:bg-green-400 text-slate-900 font-black rounded-lg shadow-md transition-colors w-full sm:w-auto mt-4 sm:mt-0">
                  Ejecutar Motor
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ================= SOLAPA 2: GESTIÓN DE CORDONES ================= */}
        {activeTab === 'cordones' && (
          <div className="animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-800">Cordones Geográficos Activos</h3>
              <button className="flex items-center gap-2 px-4 py-2 bg-[#233b6b] hover:bg-blue-900 text-white text-xs font-bold rounded-lg transition-colors shadow-sm">
                <Plus className="w-4 h-4" /> Crear Cordón
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col">
                <div className="p-5 border-b border-gray-100">
                  <h4 className="font-black text-gray-800 flex items-center gap-2"><MapPin className="w-4 h-4 text-red-500"/> CABA</h4>
                  <p className="text-xs text-gray-500 mt-1">Ciudad Autónoma de Buenos Aires.</p>
                </div>
                <div className="p-5 flex-1 bg-gray-50/50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Códigos Postales Incluidos</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="bg-white border border-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded shadow-sm">1000 al 1499</span>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-100 flex justify-end">
                  <button className="text-xs font-bold text-[#233b6b] hover:underline">Editar Códigos</button>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col">
                <div className="p-5 border-b border-gray-100">
                  <h4 className="font-black text-gray-800 flex items-center gap-2"><MapPin className="w-4 h-4 text-blue-500"/> AMBA Norte</h4>
                  <p className="text-xs text-gray-500 mt-1">Vicente López, San Isidro, Tigre.</p>
                </div>
                <div className="p-5 flex-1 bg-gray-50/50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Códigos Postales Incluidos</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="bg-white border border-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded shadow-sm">1600 al 1650</span>
                    <span className="bg-white border border-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded shadow-sm">1670</span>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-100 flex justify-end">
                  <button className="text-xs font-bold text-[#233b6b] hover:underline">Editar Códigos</button>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col border-dashed border-2 cursor-pointer group">
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center group-hover:bg-blue-50/50 transition-colors rounded-xl">
                  <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Plus className="w-6 h-6 text-blue-500" />
                  </div>
                  <h4 className="font-bold text-gray-800 text-sm">Nuevo Cordón</h4>
                  <p className="text-xs text-gray-500 mt-1">Agrupá códigos postales para usarlos en el motor.</p>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}