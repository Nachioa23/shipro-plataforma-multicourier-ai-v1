"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { 
  Settings2, Truck, Route, Plus, Save, ShieldAlert, 
  Edit3, Mail, Trash2, ArrowRight, Target, 
  AlertTriangle, X, Loader2, Globe, Building,
  Power, GitMerge, Calendar, Info, CheckCircle2
} from 'lucide-react';
import CourierDrawer, { CourierEditable } from "@/components/admin-couriers/CourierDrawer";
import IntegrarCourierDrawer from "@/components/admin-couriers/IntegrarCourierDrawer";

export default function AdminCouriersMaestro() {
  const { data: session } = useSession();

  // ================= ESTADOS GENERALES =================
  const [activeTab, setActiveTab] = useState<'flota' | 'reglas' | 'feriados'>('flota');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensajeGlobal, setMensajeGlobal] = useState<{texto: string, tipo: 'ok'|'error'} | null>(null);

  // ================= SEGURIDAD DE ROL =================
  const rolActual = session?.user?.rol || '';
  const esSuperAdmin = rolActual === 'admin_shipro';

  // ================= ESTADOS: FLOTA (ABM) =================
  // DEUDA 32+37: couriers ahora tiene tipo (los servicios vienen incluidos en
  // el GET /api/admin/couriers). integrables son los couriers con adapter pero
  // sin fila en BD — los usa el asistente de alta (Fase I).
  const [couriers, setCouriers] = useState<CourierEditable[]>([]);
  // DEUDA 32+37 (Fase I): cada integrable es { canonico, display }. El canonico
  // se manda al POST; el display se muestra al admin en el asistente de alta.
  const [integrables, setIntegrables] = useState<{ canonico: string; display: string }[]>([]);
  const [courierEditando, setCourierEditando] = useState<CourierEditable | null>(null);
  // DEUDA 32+37 (Fase I): apertura del asistente de alta de courier.
  const [mostrarIntegrar, setMostrarIntegrar] = useState(false);

  // ================= ESTADOS: REGLAS (MOTOR) =================
  const [reglas, setReglas] = useState<any[]>([]);
  const [nombreRegla, setNombreRegla] = useState("");
  const [condicionVariable, setCondicionVariable] = useState("VALOR_CARRITO");
  const [condicionOperador, setCondicionOperador] = useState("MAYOR_A");
  const [condicionValor1, setCondicionValor1] = useState("");
  const [condicionValor2, setCondicionValor2] = useState("");
  const [accionTipo, setAccionTipo] = useState("FORZAR_COURIER");
  const [accionValor, setAccionValor] = useState("");

  // ================= ESTADOS: FERIADOS =================
  const [feriados, setFeriados] = useState<any[]>([]);
  const [inputFechas, setInputFechas] = useState("");

  // ================= CARGA INICIAL DE DATOS =================
  const cargarTodo = async () => {
    setCargando(true);
    try {
      // 1. Cargar Couriers (shape: { couriers, integrables }).
      const resCouriers = await fetch("/api/admin/couriers");
      if (resCouriers.ok) {
        const data = await resCouriers.json();
        setCouriers(data.couriers || []);
        setIntegrables(data.integrables || []);
      }

      // 2. Cargar Reglas Maestras
      const resReglas = await fetch('/api/admin/reglas');
      const dataReglas = await resReglas.json();
      if (Array.isArray(dataReglas)) setReglas(dataReglas);

      // 3. Cargar Feriados
      const resFeriados = await fetch('/api/admin/feriados');
      const dataFeriados = await resFeriados.json();
      if (Array.isArray(dataFeriados)) setFeriados(dataFeriados);

    } catch (error) {
      console.error("Error al cargar el cuartel general:", error);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (esSuperAdmin) cargarTodo();
  }, [esSuperAdmin]);

  // ================= FUNCIONES: FLOTA =================
  const handleToggleCourier = async (courier: any) => {
    setCouriers(couriers.map(c => c.id === courier.id ? { ...c, activo: !c.activo } : c));
    try {
      await fetch("/api/admin/couriers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: courier.id, activo: !courier.activo })
      });
    } catch (e) {
      cargarTodo(); // Revertir si falla
    }
  };

  // ================= FUNCIONES: REGLAS =================
  const crearRegla = async () => {
    if (!nombreRegla || !condicionValor1 || !accionValor) return alert("Completá los campos obligatorios");
    setGuardando(true);
    await fetch('/api/admin/reglas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombreRegla, condicionVariable, condicionOperador, condicionValor1, condicionValor2, accionTipo, accionValor
      })
    });
    setNombreRegla(""); setCondicionValor1(""); setCondicionValor2(""); setAccionValor("");
    await cargarTodo();
    setGuardando(false);
    mostrarMensaje("Regla creada exitosamente", "ok");
  };

  const toggleRegla = async (id: number, estadoActual: boolean) => {
    await fetch('/api/admin/reglas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, activa: !estadoActual })
    });
    cargarTodo();
  };

  const borrarRegla = async (id: number) => {
    if(!confirm("¿Seguro que querés borrar esta regla?")) return;
    await fetch(`/api/admin/reglas?id=${id}`, { method: 'DELETE' });
    cargarTodo();
  };

  // ================= FUNCIONES: FERIADOS =================
  const handleGuardarFeriados = async () => {
    if (!inputFechas) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/admin/feriados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fechasRaw: inputFechas })
      });
      if (res.ok) {
        mostrarMensaje("Calendario de feriados actualizado", "ok");
        setInputFechas("");
        await cargarTodo();
      }
    } catch (e) {
      mostrarMensaje("Error al guardar feriados", "error");
    }
    setGuardando(false);
  };

  // ================= UTILIDADES =================
  const mostrarMensaje = (texto: string, tipo: 'ok'|'error') => {
    setMensajeGlobal({texto, tipo});
    setTimeout(() => setMensajeGlobal(null), 3000);
  };

  // ================= RENDER DE SEGURIDAD =================
  if (!esSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 text-center animate-in zoom-in-95 duration-300">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Denegado</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          Esta consola maestra solo es accesible para el Súper Administrador de Shipro.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-hidden font-sans">
      
      {/* ================= CABECERA MAESTRA ================= */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-6 shrink-0 sticky top-0 z-30 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30">
              <Settings2 className="w-7 h-7 text-violet-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Centro de Mando Logístico</h2>
              <p className="text-sm font-medium text-slate-400 mt-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-blue-400" /> Control global de integraciones, algoritmos y calendario.
              </p>
            </div>
          </div>
          {mensajeGlobal && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold animate-in slide-in-from-top-2 ${mensajeGlobal.tipo === 'ok' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
              <CheckCircle2 className="w-4 h-4" /> {mensajeGlobal.texto}
            </div>
          )}
        </div>

        {/* NAVEGACIÓN POR SOLAPAS */}
        <div className="flex gap-8 mt-8">
          <button onClick={() => setActiveTab('flota')} className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'flota' ? 'border-violet-400 text-violet-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Truck className="w-4 h-4" /> Flota Global (ABM)
          </button>
          <button onClick={() => setActiveTab('reglas')} className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reglas' ? 'border-violet-400 text-violet-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <GitMerge className="w-4 h-4" /> Motor de Ruteo
          </button>
          <button onClick={() => setActiveTab('feriados')} className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'feriados' ? 'border-violet-400 text-violet-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Calendar className="w-4 h-4" /> Calendario y Feriados
          </button>
        </div>
      </header>

      {/* ================= CUERPO PRINCIPAL ================= */}
      <div className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-7xl mx-auto">

          {cargando ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-500" />
              <span className="text-sm font-bold">Iniciando sistemas del Cuartel General...</span>
            </div>
          ) : (
            <>
              {/* ================= TAB 1: FLOTA GLOBAL (ABM) ================= */}
              {activeTab === 'flota' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Operadores Logísticos Habilitados</h3>
                        <p className="text-xs text-gray-500 font-medium">Activá integraciones para que estén disponibles en las cuentas de tus clientes.</p>
                    </div>
                    <button
                      onClick={() => setMostrarIntegrar(true)}
                      disabled={integrables.length === 0}
                      title={integrables.length === 0 ? "No hay couriers integrables. Todos los adapters disponibles ya estan en uso." : "Integrar un nuevo courier"}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-black rounded-lg hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-4 h-4" /> Integrar Nuevo Courier
                    </button>
                  </div>

                  <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden min-h-[300px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-400 font-black">
                          <th className="px-8 py-5">Nombre del Courier</th>
                          <th className="px-8 py-5">Email Soporte (Tickets)</th>
                          <th className="px-8 py-5">WhatsApp / Cel</th>
                          <th className="px-8 py-5 text-center">Estado Global</th>
                          <th className="px-8 py-5 text-right">Configuración</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {couriers.map((courier) => (
                          <tr key={courier.id} className="hover:bg-gray-50/50 transition-colors group">
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center font-black text-gray-400">
                                    {courier.nombre.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-bold text-gray-800">{courier.nombre}</p>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">ID: {courier.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-5">
                              {courier.emailSoporte ? (
                                <span className="text-sm font-medium text-gray-600 flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-blue-500"/> {courier.emailSoporte}</span>
                              ) : (
                                <span className="text-xs font-bold text-red-400 flex items-center gap-1.5 italic"><AlertTriangle className="w-3.5 h-3.5"/> Sin configurar</span>
                              )}
                            </td>
                            <td className="px-8 py-5 text-gray-600 font-medium">
                              {courier.telefonoSoporte || '-'}
                            </td>
                            <td className="px-8 py-5 text-center">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={courier.activo} onChange={() => handleToggleCourier(courier)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                              </label>
                            </td>
                            <td className="px-8 py-5 text-right">
                                <button onClick={() => setCourierEditando({ ...courier })} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all border border-transparent hover:border-blue-200">
                                  <Edit3 className="w-5 h-5" />
                                </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ================= TAB 2: MOTOR DE ASIGNACIÓN ================= */}
              {activeTab === 'reglas' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
                  
                  {/* PANEL DE CREACIÓN */}
                  <div className="lg:col-span-1 bg-white border border-gray-200 shadow-sm rounded-2xl p-6 h-fit">
                    <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <Plus className="w-4 h-4" /> Crear Regla Maestra
                    </h2>
                    
                    <div className="space-y-5">
                      <div>
                        <label className="text-xs font-bold text-gray-600 uppercase">Nombre de la Estrategia</label>
                        <input type="text" placeholder="Ej: Proteger margen..." className="w-full mt-1 border border-gray-300 rounded-lg text-sm p-2 bg-gray-50 focus:bg-white outline-none" value={nombreRegla} onChange={e => setNombreRegla(e.target.value)} />
                      </div>

                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-4">
                        <span className="text-[10px] font-black bg-gray-200 text-gray-600 px-2 py-1 rounded uppercase">1. Condición (Si...)</span>
                        <select className="w-full border border-gray-300 rounded-lg text-sm p-2 outline-none" value={condicionVariable} onChange={e => setCondicionVariable(e.target.value)}>
                          <option value="VALOR_CARRITO">Valor del Carrito ($)</option>
                          <option value="PESO_PAQUETE">Peso del Paquete (Kg)</option>
                          <option value="PROVINCIA_DESTINO">Provincia de Destino</option>
                        </select>
                        <select className="w-full border border-gray-300 rounded-lg text-sm p-2 outline-none" value={condicionOperador} onChange={e => setCondicionOperador(e.target.value)}>
                          <option value="MAYOR_A">Es Mayor a</option>
                          <option value="MENOR_A">Es Menor a</option>
                          <option value="IGUAL_A">Es Igual a</option>
                          <option value="ENTRE">Está Entre</option>
                        </select>
                        <div className="flex gap-2">
                          <input type="text" placeholder="Valor 1" className="w-full border border-gray-300 rounded-lg text-sm p-2 outline-none" value={condicionValor1} onChange={e => setCondicionValor1(e.target.value)} />
                          {condicionOperador === "ENTRE" && (
                            <input type="text" placeholder="Valor 2" className="w-full border border-gray-300 rounded-lg text-sm p-2 outline-none" value={condicionValor2} onChange={e => setCondicionValor2(e.target.value)} />
                          )}
                        </div>
                      </div>

                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-4">
                        <span className="text-[10px] font-black bg-blue-200 text-blue-800 px-2 py-1 rounded uppercase">2. Acción (Entonces...)</span>
                        <select className="w-full border border-blue-200 rounded-lg text-sm p-2 outline-none" value={accionTipo} onChange={e => setAccionTipo(e.target.value)}>
                          <option value="FORZAR_COURIER">Asignar a Courier (ID)</option>
                          <option value="PRIORIZAR_SLA">Priorizar Entrega Rápida</option>
                          <option value="PRIORIZAR_PRECIO">Priorizar Entrega Barata</option>
                        </select>
                        <input type="text" placeholder="Ej: 1 (Para ID Andreani)" className="w-full border border-blue-200 rounded-lg text-sm p-2 outline-none" value={accionValor} onChange={e => setAccionValor(e.target.value)} />
                      </div>

                      <button onClick={crearRegla} disabled={guardando} className="w-full flex items-center justify-center gap-2 py-3 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-[#1a2c52] transition-all disabled:opacity-50">
                        {guardando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Guardar Regla
                      </button>
                    </div>
                  </div>

                  {/* LISTADO DE REGLAS */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
                      <div>
                          <h3 className="text-lg font-black text-gray-800">Secuencia de Ejecución</h3>
                          <p className="text-xs text-gray-500 font-medium">Estas reglas maestras aparecerán como "Plantillas" en el panel de tus clientes.</p>
                      </div>
                    </div>

                    {reglas.length === 0 ? (
                      <div className="p-10 bg-white border border-dashed border-gray-300 rounded-2xl text-center text-gray-400 font-medium">
                        Aún no hay reglas configuradas.
                      </div>
                    ) : (
                      reglas.map((regla, index) => (
                        <div key={regla.id} className={`flex items-stretch bg-white border ${regla.activa ? 'border-gray-200 shadow-sm' : 'border-gray-200 opacity-60'} rounded-2xl overflow-hidden transition-all`}>
                          <div className="w-12 bg-gray-100 flex items-center justify-center font-black text-gray-400 border-r border-gray-200">#{index + 1}</div>
                          <div className="flex-1 p-5">
                            <div className="flex justify-between items-start mb-3">
                              <h3 className="font-bold text-gray-800 text-lg">{regla.nombre}</h3>
                              <div className="flex items-center gap-3">
                                <button onClick={() => toggleRegla(regla.id, regla.activa)} className={`p-2 rounded-lg transition-colors ${regla.activa ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}><Power className="w-4 h-4" /></button>
                                <button onClick={() => borrarRegla(regla.id)} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-sm flex-wrap">
                              <span className="font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200">
                                SI <strong className="text-gray-900">{regla.condicionVariable}</strong> {regla.condicionOperador.replace('_', ' ')} <strong className="text-gray-900">{regla.condicionValor1}</strong>
                              </span>
                              <ArrowRight className="w-4 h-4 text-blue-400" />
                              <span className="font-medium text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                                ENTONCES <strong className="text-blue-900">{regla.accionTipo.replace(/_/g, ' ')}</strong> {regla.accionValor && `(${regla.accionValor})`}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ================= TAB 3: CALENDARIO Y FERIADOS ================= */}
              {activeTab === 'feriados' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 animate-in fade-in duration-300">
                  <div className="space-y-4">
                    <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Save className="w-4 h-4" /> Carga Masiva Anual
                    </h2>
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
                      <div className="flex items-start gap-3 p-3 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium border border-blue-100">
                        <Info className="w-5 h-5 shrink-0" />
                        <p>Pegá las fechas de los feriados separadas por comas. <br/>Formato obligatorio: <strong>YYYY-MM-DD</strong> (Ej: 2026-05-01)</p>
                      </div>
                      
                      <textarea 
                        rows={6}
                        placeholder="2026-01-01, 2026-03-24, 2026-04-02..."
                        className="w-full border-2 border-gray-100 rounded-xl p-4 text-sm font-mono focus:border-red-500 outline-none transition-all"
                        value={inputFechas}
                        onChange={(e) => setInputFechas(e.target.value)}
                      />

                      <button disabled={guardando || !inputFechas} onClick={handleGuardarFeriados} className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 disabled:opacity-50 transition-all">
                        {guardando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Actualizar Calendario
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Días Registrados en Base de Datos</h2>
                    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                      {feriados.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 font-medium">No hay feriados cargados.</div>
                      ) : (
                        <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-50">
                          {feriados.map((f: any) => (
                            <div key={f.id} className="p-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
                              <div>
                                <p className="font-bold text-gray-800">
                                  {new Date(f.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
                                </p>
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter">Feriado Nacional / No laborable</p>
                              </div>
                              <div className="w-2 h-2 bg-red-500 rounded-full shadow-sm shadow-red-200"></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* DEUDA 32+37 (Fase H): drawer extraido a components/admin-couriers/CourierDrawer.tsx */}
      {courierEditando && (
        <CourierDrawer
          courier={courierEditando}
          onClose={() => setCourierEditando(null)}
          onSaved={(actualizado) => {
            setCouriers(couriers.map((c) => (c.id === actualizado.id ? actualizado : c)));
            mostrarMensaje("Courier guardado correctamente", "ok");
          }}
        />
      )}

      {/* DEUDA 32+37 (Fase I): asistente de alta de courier. */}
      <IntegrarCourierDrawer
        isOpen={mostrarIntegrar}
        integrables={integrables}
        onClose={() => setMostrarIntegrar(false)}
        onSaved={(creado) => {
          cargarTodo();
          mostrarMensaje(`${creado.nombre} integrado correctamente`, "ok");
        }}
      />


    </div>
  );
}