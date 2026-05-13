"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Save, Loader2, CheckCircle2, AlertCircle, Lock, Key, Package, Percent, DollarSign } from 'lucide-react';

interface Props {
  empresaActivaId: number | null;
}

export default function TransportesTab({ empresaActivaId }: Props) {
  const { data: session } = useSession();
  const esEquipoShipro = session?.user?.rol === 'admin_shipro' || session?.user?.rol === 'operador_shipro';
  const esAdminShipro = session?.user?.rol === 'admin_shipro';
  const esGerenteCliente = session?.user?.rol === 'gerente_cliente';
  const puedeVerTipoCuenta = esAdminShipro || esGerenteCliente;
  const puedeEditarTipoCuenta = esAdminShipro;

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'ok' | 'error' } | null>(null);
  const [configsGenerales, setConfigsGenerales] = useState({ ordenamiento: "MOTOR_PRECIO" });
  const [couriers, setCouriers] = useState<any[]>([]);
  // DEUDA 29 Sub-fase 1.C.3: lista derivada de couriersGlobales con puedeConsolidar=true.
  // Alimenta el dropdown condicional cuando modoFirstMile === "consolidador".
  const [consolidadoresDisponibles, setConsolidadoresDisponibles] = useState<any[]>([]);

  useEffect(() => {
    if (!empresaActivaId) return;
    const cargar = async () => {
      setCargando(true);
      try {
        const resCreds = await fetch(`/api/configuracion/couriers?empresaId=${empresaActivaId}`);
        if (resCreds.ok) {
          const data = await resCreds.json();
          if (data.empresa) setConfigsGenerales({ ordenamiento: data.empresa.ordenamientoDefault || "MOTOR_PRECIO" });

          if (data.couriersGlobales) {
            // DEUDA 29 Sub-fase 1.C.3: alimentar lista de consolidadores disponibles
            // (couriers con capacidad puedeConsolidar=true). El dropdown condicional
            // los muestra cuando el cliente elige modoFirstMile="consolidador".
            const consolidadores = data.couriersGlobales.filter((c: any) => c.puedeConsolidar === true);
            setConsolidadoresDisponibles(consolidadores);

            const couriersDin = data.couriersGlobales.map((globalCourier: any) => {
              const configCliente = (data.credencialesCliente || []).find((c: any) => c.nombreCourier === globalCourier.nombre);

              let credsPorDefecto: Record<string, string> = {};
              if (globalCourier.nombre === 'Andreani') credsPorDefecto = { username: "", password: "", cliente: "", contrato_domicilio: "", contrato_sucursal: "", contrato_cambio: "", contrato_devolucion: "", id_sucursal_origen: "" };
              else if (globalCourier.nombre === "Moci's") credsPorDefecto = { client_api: "", client_secret: "" };
              else credsPorDefecto = { api_key: "", api_secret: "" };

              if (configCliente) {
                return {
                  id: globalCourier.nombre, activo: configCliente.activo, usaPropias: configCliente.usaCredencialesPropias,
                  credenciales: configCliente.credencialesJson ? JSON.parse(configCliente.credencialesJson) : credsPorDefecto,
                  markupClientePorcentaje: configCliente.ajusteTarifaPorcentaje || 0, markupClienteFijo: configCliente.markupFijo || 0,
                  // DEUDA 29 Sub-fase 1.C.3: modoFirstMile + courierRecolectorId reemplazan al `recolector` legacy.
                  modoFirstMile: configCliente.modoFirstMile || "mismo_courier",
                  courierRecolectorId: configCliente.courierRecolectorId ?? null,
                  tipoCuenta: configCliente.tipoCuenta || ""
                };
              } else {
                return {
                  id: globalCourier.nombre, activo: false, usaPropias: true, credenciales: credsPorDefecto,
                  markupClientePorcentaje: 0, markupClienteFijo: 0,
                  modoFirstMile: "mismo_courier",
                  courierRecolectorId: null,
                  tipoCuenta: ""
                };
              }
            });
            setCouriers(couriersDin);
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [empresaActivaId]);

  const handleToggleCourier = (id: string) => setCouriers(couriers.map(c => c.id === id ? { ...c, activo: !c.activo } : c));
  const handleUpdateCourier = (id: string, campo: string, valor: any) => setCouriers(couriers.map(c => c.id === id ? { ...c, [campo]: valor } : c));
  const handleUpdateCredencial = (id: string, clave: string, valor: string) => setCouriers(couriers.map(c => c.id === id ? { ...c, credenciales: { ...c.credenciales, [clave]: valor } } : c));

  const intentarUsarCuentaShipro = (e: React.MouseEvent, courierId: string, _estaUsandoPropias: boolean) => {
    if (!esEquipoShipro) {
      e.preventDefault();
      alert(`Para operar con la Tarifa Corporativa de Shipro en ${courierId}, solicitá la activación a tu Asesor Comercial.`);
    } else {
      handleUpdateCourier(courierId, 'usaPropias', false);
    }
  };

  const guardar = async () => {
    // DEUDA 29 Sub-fase 1.C.3: validación cruzada de modoFirstMile + courierRecolectorId.
    // Defense in depth: el backend también valida (commit Fase 1.C.1) con whitelist.
    const couriersIncompletos = couriers.filter(c =>
      c.activo && c.modoFirstMile === 'consolidador' && c.courierRecolectorId === null
    );
    if (couriersIncompletos.length > 0) {
      setMensaje({
        texto: `Seleccioná el courier que va a hacer la recolección antes de guardar (${couriersIncompletos.map(c => c.id).join(', ')}).`,
        tipo: 'error'
      });
      setTimeout(() => setMensaje(null), 5000);
      return;
    }

    setGuardando(true);
    try {
      const res = await fetch("/api/configuracion/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId: empresaActivaId, configsGenerales, couriers })
      });
      if (res.ok) setMensaje({ texto: "Red Logística guardada exitosamente.", tipo: 'ok' });
      else setMensaje({ texto: "Error al guardar la red.", tipo: 'error' });
    } catch (error) {
      setMensaje({ texto: "Error de conexión.", tipo: 'error' });
    } finally {
      setGuardando(false);
      setTimeout(() => setMensaje(null), 5000);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="flex justify-end">
        <button onClick={guardar} disabled={guardando || cargando} className="flex items-center gap-2 px-6 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl transition-colors shadow-sm disabled:opacity-50">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar Credenciales
        </button>
      </div>

      {mensaje && (
        <div className={`p-4 rounded-xl font-bold flex items-center gap-2 animate-in slide-in-from-top-2 ${mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {mensaje.tipo === 'ok' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />} {mensaje.texto}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center items-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="space-y-6 animate-in fade-in">
          {couriers.map(courier => (
            <div key={courier.id} className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${courier.activo ? 'border-[#233b6b] shadow-md' : 'border-gray-200 shadow-sm'}`}>
              <div className="p-5 bg-gray-50/50 flex flex-wrap justify-between items-center border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl shadow-sm border ${courier.activo ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-400 border-gray-200'}`}>{courier.id.substring(0, 2).toUpperCase()}</div>
                  <div><h4 className="font-black text-gray-800 text-lg">{courier.id}</h4><p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{courier.activo ? 'Integración Activa' : 'Módulo Inactivo'}</p></div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={courier.activo} onChange={() => handleToggleCourier(courier.id)} />
                  <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500 shadow-inner"></div>
                </label>
              </div>

              {courier.activo && (
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-top-2">
                  <div className="space-y-6">
                    <div>
                      <h5 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Key className="w-4 h-4 text-indigo-500" /> 1. Accesos API</h5>
                      <div className="space-y-3">
                        <div onClick={(e) => intentarUsarCuentaShipro(e, courier.id, courier.usaPropias)} className={`relative flex items-center gap-3 p-4 border-2 rounded-xl transition-colors ${!courier.usaPropias ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50/50 cursor-pointer hover:border-gray-300'}`}>
                          {!esEquipoShipro && courier.usaPropias && (
                            <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] z-10 flex items-center justify-end pr-4 rounded-xl cursor-not-allowed"><Lock className="w-5 h-5 text-slate-500" /></div>
                          )}
                          <input type="radio" readOnly checked={!courier.usaPropias} className="w-5 h-5 text-indigo-600" />
                          <div><p className="text-sm font-black text-gray-800">Usar Cuenta Corriente Shipro</p><p className="text-[10px] text-gray-500 font-medium">Tarifas corporativas descontadas de tu billetera.</p></div>
                        </div>

                        <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-colors ${courier.usaPropias ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <input type="radio" readOnly checked={courier.usaPropias} onChange={() => handleUpdateCourier(courier.id, 'usaPropias', true)} className="w-5 h-5 text-indigo-600" />
                          <div><p className="text-sm font-black text-gray-800">Tengo contrato propio con {courier.id}</p><p className="text-[10px] text-gray-500 font-medium">Los envíos se facturan en tu cuenta. Shipro solo rutea.</p></div>
                        </label>
                      </div>

                      {courier.usaPropias && (
                        <div className="mt-4 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider border-b border-slate-200 pb-2">Datos de Integración</p>
                          <div className="grid grid-cols-1 gap-4">
                            {Object.keys(courier.credenciales).map(key => {
                              const isSecret = key.toLowerCase().includes('pass') || key.toLowerCase().includes('secret');
                              return (
                                <div key={key}>
                                  <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">{key.replace(/_/g, ' ')}</label>
                                  <input
                                    type={isSecret && !esEquipoShipro ? "password" : "text"}
                                    value={esEquipoShipro && isSecret && courier.credenciales[key] ? "••••••••••••••••" : courier.credenciales[key]}
                                    onChange={(e) => handleUpdateCredencial(courier.id, key, e.target.value)}
                                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono outline-none shadow-sm ${esEquipoShipro && isSecret ? 'bg-red-50 text-red-500 border-red-200 focus:border-red-500' : 'focus:border-indigo-500'}`}
                                    placeholder={isSecret ? "••••••••••••••••" : `Ingresá tu ${key}`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <h5 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-emerald-500" /> 2. Estrategia de Despacho</h5>
                      {/* DEUDA 29 Sub-fase 1.C.3: dropdown con los 3 valores válidos del schema.
                          La opción "consolidador" se muestra solo si hay couriers consolidadores
                          disponibles distintos al actual (no tiene sentido ser su propio recolector). */}
                      <select
                        value={courier.modoFirstMile}
                        onChange={e => {
                          const nuevoModo = e.target.value;
                          handleUpdateCourier(courier.id, 'modoFirstMile', nuevoModo);
                          // Si cambia a algo distinto de "consolidador", limpiar el ID del recolector.
                          if (nuevoModo !== 'consolidador') {
                            handleUpdateCourier(courier.id, 'courierRecolectorId', null);
                          }
                        }}
                        className="w-full p-3 border-2 border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-emerald-500"
                      >
                        <option value="mismo_courier">El propio {courier.id} retira de mi depósito</option>
                        {consolidadoresDisponibles.filter((cons: any) => cons.nombre !== courier.id).length > 0 && (
                          <option value="consolidador">Un courier consolidador retira y entrega al courier final</option>
                        )}
                        <option value="drop_off_cliente">Yo llevo el paquete a una sucursal de {courier.id}</option>
                      </select>

                      {courier.modoFirstMile === 'consolidador' && (
                        <div className="mt-3">
                          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">
                            ¿Qué courier va a hacer la recolección?
                          </label>
                          <select
                            value={courier.courierRecolectorId ?? ""}
                            onChange={e => handleUpdateCourier(courier.id, 'courierRecolectorId', e.target.value ? parseInt(e.target.value) : null)}
                            className="w-full p-3 border-2 border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-emerald-500"
                          >
                            <option value="">Seleccionar courier recolector…</option>
                            {consolidadoresDisponibles
                              .filter((cons: any) => cons.nombre !== courier.id)
                              .map((cons: any) => (
                                <option key={cons.id} value={cons.id}>{cons.nombre}</option>
                              ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {puedeVerTipoCuenta && (
                      <div>
                        <h5 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-amber-500" /> 2.5 Tipo de Cuenta</h5>
                        <select
                          value={courier.tipoCuenta || ""}
                          onChange={e => handleUpdateCourier(courier.id, 'tipoCuenta', e.target.value)}
                          disabled={!puedeEditarTipoCuenta}
                          className="w-full p-3 border-2 border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-amber-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                        >
                          <option value="">Default empresa</option>
                          <option value="PREPAGO">PREPAGO (validar saldo antes de despachar)</option>
                          <option value="POSTPAGO">POSTPAGO (cuenta corriente, factura a fin de mes)</option>
                        </select>
                        {!puedeEditarTipoCuenta && (
                          <p className="text-[10px] text-gray-500 mt-1.5">Solo admin Shipro puede cambiar este campo. Contactá a tu asesor.</p>
                        )}
                      </div>
                    )}

                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                      <h5 className="text-xs font-black text-blue-800 uppercase tracking-widest mb-1 flex items-center gap-2"><Percent className="w-4 h-4 text-blue-600" /> 3. Ajuste Comercial (Tu Tienda)</h5>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <label className="block text-xs font-bold text-blue-900 mb-1">Recargo/Descuento (%)</label>
                          <div className="relative"><input type="number" value={courier.markupClientePorcentaje} onChange={e => handleUpdateCourier(courier.id, 'markupClientePorcentaje', parseFloat(e.target.value))} className="w-full pl-3 pr-8 py-2 border border-blue-200 rounded-lg text-sm font-bold text-blue-900 outline-none focus:border-blue-500 bg-white" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span></div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-blue-900 mb-1">Costo Fijo Adicional</label>
                          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span><input type="number" value={courier.markupClienteFijo} onChange={e => handleUpdateCourier(courier.id, 'markupClienteFijo', parseFloat(e.target.value))} className="w-full pl-7 pr-3 py-2 border border-blue-200 rounded-lg text-sm font-bold text-blue-900 outline-none focus:border-blue-500 bg-white" /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
