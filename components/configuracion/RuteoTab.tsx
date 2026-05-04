"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Settings2, Network, ArrowRight } from 'lucide-react';

interface Props {
  empresaActivaId: number | null;
}

export default function RuteoTab({ empresaActivaId }: Props) {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'ok' | 'error' } | null>(null);
  const [configsGenerales, setConfigsGenerales] = useState({ ordenamiento: "MOTOR_PRECIO" });
  const [reglasDinamicas, setReglasDinamicas] = useState<any[]>([]);

  useEffect(() => {
    if (!empresaActivaId) return;
    const cargar = async () => {
      setCargando(true);
      try {
        // Cargar configuracion de empresa (ordenamiento)
        const resCreds = await fetch(`/api/configuracion/couriers?empresaId=${empresaActivaId}`);
        if (resCreds.ok) {
          const data = await resCreds.json();
          if (data.empresa) setConfigsGenerales({ ordenamiento: data.empresa.ordenamientoDefault || "MOTOR_PRECIO" });
        }

        // Reglas Maestras + Cliente
        const [resMaestras, resCliente] = await Promise.all([
          fetch('/api/admin/reglas'),
          fetch(`/api/empresa/reglas?empresaId=${empresaActivaId}`)
        ]);

        const maestras = await resMaestras.json();
        const clienteReglas = await resCliente.json();

        if (Array.isArray(maestras)) {
          const dinamicas = maestras.map((m: any) => {
            const rCliente = Array.isArray(clienteReglas) ? clienteReglas.find((rc: any) => rc.nombre === m.nombre) : null;
            return {
              idMaestra: m.id,
              nombre: m.nombre,
              condicionVariable: m.condicionVariable,
              condicionOperador: m.condicionOperador,
              accionTipo: m.accionTipo,
              activa: rCliente ? rCliente.activa : false,
              condicionValor1: rCliente && rCliente.condicionValor1 ? rCliente.condicionValor1.toString() : "",
              accionValor: rCliente && rCliente.accionValor ? rCliente.accionValor : ""
            };
          });
          setReglasDinamicas(dinamicas);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [empresaActivaId]);

  const handleReglaChange = (nombre: string, campo: string, valor: any) => {
    setReglasDinamicas(prev => prev.map(r => {
      if (r.nombre === nombre) return { ...r, [campo]: valor };
      // Exclusividad: si prendemos una, apagamos las demás en el frontend
      if (campo === 'activa' && valor === true) return { ...r, activa: false };
      return r;
    }));
  };

  const guardarMotorBase = async () => {
    setGuardando(true);
    try {
      const res = await fetch("/api/configuracion/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Mandamos couriers vacío porque el handler hace upsert por courier — sin couriers no toca credenciales
        body: JSON.stringify({ empresaId: empresaActivaId, configsGenerales, couriers: [] })
      });
      if (res.ok) setMensaje({ texto: "Motor base guardado.", tipo: 'ok' });
      else setMensaje({ texto: "Error al guardar.", tipo: 'error' });
    } catch (e) {
      setMensaje({ texto: "Error de conexión.", tipo: 'error' });
    }
    setGuardando(false);
    setTimeout(() => setMensaje(null), 3000);
  };

  const guardarRegla = async (regla: any) => {
    if (regla.activa) {
      if (regla.condicionVariable !== "PROVINCIA_DESTINO" && !regla.condicionValor1) return alert("Ingresá el valor de la condición.");
      if (regla.accionTipo === "FORZAR_COURIER" && !regla.accionValor) return alert("Ingresá el ID del Courier a forzar.");
    }

    setGuardando(true);
    try {
      await fetch('/api/empresa/reglas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: empresaActivaId,
          nombre: regla.nombre,
          condicionVariable: regla.condicionVariable,
          condicionOperador: regla.condicionOperador,
          condicionValor1: regla.condicionValor1,
          accionTipo: regla.accionTipo,
          accionValor: regla.accionValor,
          activa: regla.activa
        })
      });
      setMensaje({ texto: `Estrategia "${regla.nombre}" actualizada.`, tipo: 'ok' });
    } catch (e) {
      setMensaje({ texto: "Error al guardar.", tipo: 'error' });
    }
    setGuardando(false);
    setTimeout(() => setMensaje(null), 3000);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
      {mensaje && (
        <div className={`p-4 rounded-xl font-bold flex items-center gap-2 animate-in slide-in-from-top-2 ${mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {mensaje.tipo === 'ok' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />} {mensaje.texto}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center items-center py-20"><Loader2 className="w-8 h-8 animate-spin text-purple-600" /></div>
      ) : (
        <div className="space-y-8 animate-in fade-in">
          <section className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl shadow-sm border border-purple-100 p-6 flex flex-col md:flex-row gap-6 items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-purple-900 flex items-center gap-2"><Settings2 className="w-5 h-5" /> Motor Base de Cotización</h3>
              <p className="text-xs text-purple-700 mt-1">El comportamiento general cuando no se cumple ninguna de las reglas excepcionales.</p>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-auto">
              <select value={configsGenerales.ordenamiento} onChange={e => setConfigsGenerales({ ordenamiento: e.target.value })} className="w-full md:w-72 border-2 border-purple-200 bg-white rounded-xl p-3 text-sm font-bold text-purple-900 outline-none focus:border-purple-500">
                <option value="MOTOR_PRECIO">Priorizar Mejor Precio (Recomendado)</option>
                <option value="MOTOR_SLA">Priorizar Entrega Express (SLA)</option>
              </select>
              <button onClick={guardarMotorBase} disabled={guardando} className="text-[10px] font-bold uppercase tracking-widest text-purple-600 hover:text-purple-800 text-right">Guardar Motor Base</button>
            </div>
          </section>

          {reglasDinamicas.length === 0 ? (
            <div className="p-10 text-center text-gray-400 font-medium border-2 border-dashed border-gray-200 rounded-2xl">
              No hay reglas estratégicas creadas por Shipro aún.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reglasDinamicas.map(regla => (
                <div key={regla.idMaestra} className={`border-2 rounded-2xl p-6 transition-all shadow-sm ${regla.activa ? 'border-purple-500 bg-purple-50/30' : 'border-gray-200 bg-white'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-xl ${regla.activa ? 'bg-purple-100' : 'bg-gray-100'}`}>
                      <Network className={`w-6 h-6 ${regla.activa ? 'text-purple-600' : 'text-gray-500'}`} />
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={regla.activa} onChange={(e) => handleReglaChange(regla.nombre, 'activa', e.target.checked)} />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-purple-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                    </label>
                  </div>

                  <h3 className="text-lg font-bold text-gray-800">{regla.nombre}</h3>
                  <p className="text-xs font-bold text-gray-400 mt-1 mb-4 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Acción: {regla.accionTipo.replace(/_/g, ' ')}</p>

                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">{regla.condicionVariable.replace('_', ' ')} {regla.condicionOperador.replace('_', ' ')}</label>
                        <input type="text" placeholder="Tu Valor..." disabled={!regla.activa} value={regla.condicionValor1} onChange={(e) => handleReglaChange(regla.nombre, 'condicionValor1', e.target.value)} className="w-full mt-1 border border-gray-300 rounded-lg p-2 text-sm disabled:bg-gray-100 outline-none focus:border-purple-500" />
                      </div>

                      {regla.accionTipo === "FORZAR_COURIER" && (
                        <div className="w-1/3">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Courier ID</label>
                          <input type="text" placeholder="Ej: 1" disabled={!regla.activa} value={regla.accionValor} onChange={(e) => handleReglaChange(regla.nombre, 'accionValor', e.target.value)} className="w-full mt-1 border border-gray-300 rounded-lg p-2 text-sm disabled:bg-gray-100 outline-none focus:border-purple-500" />
                        </div>
                      )}
                    </div>
                    <button disabled={guardando} onClick={() => guardarRegla(regla)} className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors">Guardar Regla</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
