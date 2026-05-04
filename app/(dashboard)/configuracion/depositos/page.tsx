"use client";

import { useEffect, useState } from "react";
import { Warehouse, Plus, Edit, Trash2, Star, MapPin, Phone, Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useConfiguracion } from "../ConfiguracionContext";
import DepositoForm from "@/components/configuracion/DepositoForm";

interface DepositoUI {
  id: number;
  empresaId: number;
  nombre: string;
  esPredeterminado: boolean;
  activo: boolean;
  contactoNombre: string;
  contactoTelefono: string;
  contactoEmail: string | null;
  direccionCalle: string;
  direccionAltura: string;
  direccionPiso: string | null;
  direccionDpto: string | null;
  codigoPostal: string;
  localidad: string;
  provincia: string;
  horarios: string;
  observaciones: string | null;
  eliminado: boolean;
}

export default function ConfiguracionDepositosPage() {
  const { empresaActivaId, esAdminShipro, esGerenteCliente, esOperadorCliente, esOperadorShipro } = useConfiguracion();
  const puedeEditar = esAdminShipro || esGerenteCliente;

  const [depositos, setDepositos] = useState<DepositoUI[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'ok' | 'error' } | null>(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [depositoEditando, setDepositoEditando] = useState<DepositoUI | null>(null);

  const cargarDepositos = async () => {
    if (!empresaActivaId) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/depositos?empresaId=${empresaActivaId}`);
      if (!res.ok) {
        setError('Error al cargar depósitos');
        setCargando(false);
        return;
      }
      const data = await res.json();
      setDepositos(Array.isArray(data) ? data : []);
    } catch {
      setError('Error de conexión');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDepositos();
  }, [empresaActivaId]);

  const abrirCrear = () => {
    setDepositoEditando(null);
    setModalAbierto(true);
  };

  const abrirEditar = (dep: DepositoUI) => {
    setDepositoEditando(dep);
    setModalAbierto(true);
  };

  const marcarPredeterminado = async (dep: DepositoUI) => {
    setMensaje(null);
    try {
      const res = await fetch(`/api/depositos/${dep.id}/predeterminado`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setMensaje({ texto: data.error || 'Error al marcar como predeterminado', tipo: 'error' });
      } else {
        setMensaje({ texto: `"${dep.nombre}" es ahora el predeterminado.`, tipo: 'ok' });
        cargarDepositos();
      }
    } catch {
      setMensaje({ texto: 'Error de conexión', tipo: 'error' });
    }
    setTimeout(() => setMensaje(null), 4000);
  };

  const eliminar = async (dep: DepositoUI) => {
    if (!confirm(`¿Eliminar el depósito "${dep.nombre}"?\n\nQueda en la papelera (soft delete) — la información histórica se preserva pero ya no aparecerá en listados.`)) return;
    try {
      const res = await fetch(`/api/depositos/${dep.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setMensaje({ texto: data.error || 'Error al eliminar', tipo: 'error' });
      } else {
        setMensaje({ texto: `"${dep.nombre}" eliminado.`, tipo: 'ok' });
        cargarDepositos();
      }
    } catch {
      setMensaje({ texto: 'Error de conexión', tipo: 'error' });
    }
    setTimeout(() => setMensaje(null), 4000);
  };

  const formatHorariosResumen = (jsonHorarios: string): string => {
    try {
      const h = JSON.parse(jsonHorarios);
      const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      const labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      const abiertos = dias.map((d, i) => h[d] && !h[d].cerrado ? labels[i] : '·').join(' ');
      return abiertos;
    } catch {
      return '—';
    }
  };

  if (!empresaActivaId) {
    return (
      <div className="p-8 max-w-5xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-600" />
          <p className="text-sm text-gray-500">Esperando selección de empresa…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-6">

      {/* Header local con CTA */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-amber-600" /> Mis Depósitos
          </h3>
          <p className="text-sm text-gray-500 mt-1">Configurá las direcciones desde donde despachás. Uno será el predeterminado.</p>
        </div>
        {puedeEditar && (
          <button onClick={abrirCrear} className="flex items-center gap-2 px-5 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Crear depósito
          </button>
        )}
      </div>

      {mensaje && (
        <div className={`p-4 rounded-xl font-bold flex items-center gap-2 animate-in slide-in-from-top-2 ${mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {mensaje.tipo === 'ok' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />} {mensaje.texto}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : depositos.length === 0 ? (
        // Empty state — onboarding del primer depósito
        <div className="bg-white rounded-2xl border-2 border-dashed border-amber-200 p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center mb-4">
            <Warehouse className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-black text-gray-800 mb-2">Configurá tu primer depósito</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
            Necesitás al menos un depósito predeterminado para crear envíos. Cargá la dirección, contacto y horarios de colecta.
          </p>
          {puedeEditar ? (
            <button onClick={abrirCrear} className="inline-flex items-center gap-2 px-6 py-3 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
              <Plus className="w-4 h-4" /> Crear primer depósito
            </button>
          ) : (
            <p className="text-xs font-bold text-gray-500">Solicitá al gerente o admin Shipro que cargue el depósito.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {depositos.map(dep => (
            <div key={dep.id} className={`bg-white border-2 rounded-2xl overflow-hidden transition-all ${dep.esPredeterminado ? 'border-amber-400 shadow-md' : 'border-gray-200 shadow-sm'} ${!dep.activo ? 'opacity-60' : ''}`}>
              <div className="p-5">
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="text-lg font-black text-gray-800">{dep.nombre}</h4>
                      {dep.esPredeterminado && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          <Star className="w-3 h-3" /> Predeterminado
                        </span>
                      )}
                      {!dep.activo && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-300">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-1 text-xs text-gray-600">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <span>
                          {dep.direccionCalle} {dep.direccionAltura}
                          {dep.direccionPiso && `, Piso ${dep.direccionPiso}`}
                          {dep.direccionDpto && ` ${dep.direccionDpto}`}
                          {' — '}
                          CP {dep.codigoPostal}, {dep.localidad}, {dep.provincia}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="font-bold">{dep.contactoNombre}</span> — {dep.contactoTelefono}
                      </div>
                      {dep.contactoEmail && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{dep.contactoEmail}</span>
                        </div>
                      )}
                      <div className="text-[10px] font-mono text-gray-500">
                        Horarios: {formatHorariosResumen(dep.horarios)}
                      </div>
                    </div>
                    {dep.observaciones && (
                      <p className="text-[11px] text-gray-500 mt-2 italic">{dep.observaciones}</p>
                    )}
                  </div>

                  {(puedeEditar || esOperadorShipro || esOperadorCliente) && (
                    <div className="flex items-center gap-2 shrink-0">
                      {puedeEditar && !dep.esPredeterminado && dep.activo && (
                        <button
                          onClick={() => marcarPredeterminado(dep)}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-lg border border-amber-200 transition-colors flex items-center gap-1"
                          title="Marcar como predeterminado"
                        >
                          <Star className="w-3.5 h-3.5" /> Predeterminado
                        </button>
                      )}
                      <button
                        onClick={() => abrirEditar(dep)}
                        className="p-1.5 text-gray-500 hover:text-[#233b6b] hover:bg-blue-50 rounded-lg transition-colors"
                        title={puedeEditar ? "Editar" : "Ver"}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      {puedeEditar && (
                        <button
                          onClick={() => eliminar(dep)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DepositoForm
        isOpen={modalAbierto}
        onClose={() => setModalAbierto(false)}
        onSaved={cargarDepositos}
        empresaId={empresaActivaId}
        depositoExistente={depositoEditando}
        puedeEditarFlags={puedeEditar}
        totalDepositos={depositos.length}
      />
    </div>
  );
}
