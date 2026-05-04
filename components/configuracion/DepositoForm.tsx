"use client";

import { useState, useEffect } from "react";
import { X, Save, Loader2, AlertCircle, Star } from "lucide-react";
import HorariosEditor, { HORARIOS_DEFAULT, HorariosSemana, parsearHorarios } from "./HorariosEditor";
import InputTelefono from "@/components/forms/InputTelefono";
import AutocompleteAddress, { AddressData } from "@/components/forms/AutocompleteAddress";
import { useCpLookup } from "@/lib/hooks/useCpLookup";
import { PROVINCIAS_AR } from "@/lib/constants/provincias-ar";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  empresaId: number | null;
  depositoExistente?: any | null;
  puedeEditarFlags: boolean;
  totalDepositos: number;
}

export default function DepositoForm({ isOpen, onClose, onSaved, empresaId, depositoExistente, puedeEditarFlags, totalDepositos }: Props) {
  const esEdicion = !!depositoExistente;

  const [nombre, setNombre] = useState('');
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTelefono, setContactoTelefono] = useState('');
  const [contactoEmail, setContactoEmail] = useState('');
  const [direccionCalle, setDireccionCalle] = useState('');
  const [direccionAltura, setDireccionAltura] = useState('');
  const [direccionPiso, setDireccionPiso] = useState('');
  const [direccionDpto, setDireccionDpto] = useState('');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [localidad, setLocalidad] = useState('');
  const [provincia, setProvincia] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [horarios, setHorarios] = useState<HorariosSemana>(HORARIOS_DEFAULT);
  const [esPredeterminado, setEsPredeterminado] = useState(false);
  const [activo, setActivo] = useState(true);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escenario 3 (DEUDA 4 política "el usuario manda"): si el usuario edita
  // manualmente localidad o provincia, ese campo NO se autocompleta más al
  // cambiar el CP. Si lo borra, el flag se resetea.
  const [editadosManualmente, setEditadosManualmente] = useState({
    localidad: false,
    provincia: false,
  });

  const cpLookup = useCpLookup(codigoPostal);

  useEffect(() => {
    if (!editadosManualmente.provincia && cpLookup.provincia) {
      setProvincia(cpLookup.provincia);
    }
    if (!editadosManualmente.localidad && cpLookup.localidades.length > 0) {
      setLocalidad(cpLookup.localidades[0]);
    }
  }, [cpLookup.provincia, cpLookup.localidades, editadosManualmente]);

  const handleChangeLocalidad = (valor: string) => {
    setLocalidad(valor);
    setEditadosManualmente(prev => ({ ...prev, localidad: valor !== "" }));
  };

  const handleChangeProvincia = (valor: string) => {
    setProvincia(valor);
    setEditadosManualmente(prev => ({ ...prev, provincia: valor !== "" }));
  };

  const handlePlaceChanged = (data: AddressData) => {
    if (data.calle) setDireccionCalle(data.calle);
    if (data.altura) setDireccionAltura(data.altura);
    if (data.cp) setCodigoPostal(data.cp);
    if (data.provincia) setProvincia(data.provincia);
    if (data.localidad) setLocalidad(data.localidad);
    // Acción explícita del usuario eligiendo dirección completa → resetear flags.
    setEditadosManualmente({ localidad: false, provincia: false });
  };

  useEffect(() => {
    if (!isOpen) return;
    if (depositoExistente) {
      setNombre(depositoExistente.nombre || '');
      setContactoNombre(depositoExistente.contactoNombre || '');
      setContactoTelefono(depositoExistente.contactoTelefono || '');
      setContactoEmail(depositoExistente.contactoEmail || '');
      setDireccionCalle(depositoExistente.direccionCalle || '');
      setDireccionAltura(depositoExistente.direccionAltura || '');
      setDireccionPiso(depositoExistente.direccionPiso || '');
      setDireccionDpto(depositoExistente.direccionDpto || '');
      setCodigoPostal(depositoExistente.codigoPostal || '');
      setLocalidad(depositoExistente.localidad || '');
      setProvincia(depositoExistente.provincia || '');
      setObservaciones(depositoExistente.observaciones || '');
      setHorarios(parsearHorarios(depositoExistente.horarios));
      setEsPredeterminado(!!depositoExistente.esPredeterminado);
      setActivo(depositoExistente.activo !== false);
    } else {
      // Reset para crear nuevo
      setNombre('');
      setContactoNombre('');
      setContactoTelefono('');
      setContactoEmail('');
      setDireccionCalle('');
      setDireccionAltura('');
      setDireccionPiso('');
      setDireccionDpto('');
      setCodigoPostal('');
      setLocalidad('');
      setProvincia('');
      setObservaciones('');
      setHorarios(HORARIOS_DEFAULT);
      // Si es el primer depósito, forzar predeterminado=true en UI también (el backend igual lo hace)
      setEsPredeterminado(totalDepositos === 0);
      setActivo(true);
    }
    setError(null);
    // Flags al abrir el modal:
    // - Modo nuevo (sin depositoExistente): false → CP autocompleta libremente.
    // - Modo edición: true si el campo ya tenía valor → preserva el dato guardado
    //   aunque cambie el CP (evita que la localidad guardada se sobreescriba con
    //   `cpLookup.localidades[0]` al abrir el modal). Si el usuario quiere corregir,
    //   borra el campo (resetea flag) y luego cambia CP.
    if (depositoExistente) {
      setEditadosManualmente({
        localidad: !!depositoExistente.localidad,
        provincia: !!depositoExistente.provincia,
      });
    } else {
      setEditadosManualmente({ localidad: false, provincia: false });
    }
  }, [isOpen, depositoExistente, totalDepositos]);

  if (!isOpen) return null;

  const validarFrontend = (): string | null => {
    if (!nombre.trim()) return 'Nombre del depósito requerido';
    if (!contactoNombre.trim()) return 'Nombre del contacto requerido';
    if (contactoTelefono.length !== 10) return 'Teléfono debe tener exactamente 10 dígitos (sin 0 inicial ni 15 móvil)';
    if (!direccionCalle.trim()) return 'Calle requerida';
    if (!direccionAltura.trim()) return 'Altura requerida';
    if (!/^\d{4}$/.test(codigoPostal.trim())) return 'CP inválido (debe ser 4 dígitos)';
    if (!localidad.trim()) return 'Localidad requerida';
    if (!provincia.trim()) return 'Provincia requerida';
    return null;
  };

  const guardar = async () => {
    const errFront = validarFrontend();
    if (errFront) {
      setError(errFront);
      return;
    }

    setGuardando(true);
    setError(null);

    const body: any = {
      nombre: nombre.trim(),
      contactoNombre: contactoNombre.trim(),
      contactoTelefono: contactoTelefono.trim(),
      contactoEmail: contactoEmail.trim() || null,
      direccionCalle: direccionCalle.trim(),
      direccionAltura: direccionAltura.trim(),
      direccionPiso: direccionPiso.trim() || null,
      direccionDpto: direccionDpto.trim() || null,
      codigoPostal: codigoPostal.trim(),
      localidad: localidad.trim(),
      provincia: provincia.trim(),
      pais: 'Argentina',
      horarios: JSON.stringify(horarios),
      observaciones: observaciones.trim() || null,
      esPredeterminado,
      activo,
    };

    if (!esEdicion) body.empresaId = empresaId;

    try {
      const url = esEdicion ? `/api/depositos/${depositoExistente.id}` : '/api/depositos';
      const method = esEdicion ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Error al guardar');
        setGuardando(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-[#233b6b] p-6 flex justify-between items-center text-white shrink-0">
          <div>
            <h2 className="text-xl font-black">{esEdicion ? 'Editar Depósito' : 'Crear Depósito'}</h2>
            <p className="text-blue-200 text-xs font-medium mt-1">
              {esEdicion ? `ID #${depositoExistente.id}` : (totalDepositos === 0 ? 'Será marcado como predeterminado automáticamente.' : 'Configurá un depósito adicional.')}
            </p>
          </div>
          <button onClick={onClose} disabled={guardando} className="p-2 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" /> {error}
            </div>
          )}

          {/* Identidad */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Identidad</h3>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Nombre del depósito *</label>
              <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" placeholder="Ej: Depósito Central" />
            </div>
          </section>

          {/* Contacto */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Contacto</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Nombre *</label>
                <input type="text" value={contactoNombre} onChange={e => setContactoNombre(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Teléfono *</label>
                <InputTelefono value={contactoTelefono} onChange={setContactoTelefono} required />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">Email (opcional)</label>
                <input type="email" value={contactoEmail} onChange={e => setContactoEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
            </div>
          </section>

          {/* Dirección */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Dirección</h3>

            {/* Buscador inteligente Google Maps */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest">Buscador Inteligente (Recomendado)</label>
              <AutocompleteAddress onPlaceChanged={handlePlaceChanged} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">Calle *</label>
                <input type="text" value={direccionCalle} onChange={e => setDireccionCalle(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Altura *</label>
                <input type="text" value={direccionAltura} onChange={e => setDireccionAltura(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Piso</label>
                <input type="text" value={direccionPiso} onChange={e => setDireccionPiso(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Dpto</label>
                <input type="text" value={direccionDpto} onChange={e => setDireccionDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-2">
                  CP * {cpLookup.buscando && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                </label>
                <input type="text" value={codigoPostal} onChange={e => setCodigoPostal(e.target.value.replace(/\D/g, '').slice(0, 4))} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">Localidad *</label>
                <select
                  value={localidad}
                  onChange={e => handleChangeLocalidad(e.target.value)}
                  disabled={cpLookup.localidades.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b] bg-white capitalize disabled:bg-gray-50 disabled:cursor-not-allowed"
                >
                  {cpLookup.localidades.length === 0 ? (
                    <option value="">{codigoPostal.length < 4 ? "Esperando CP..." : "Sin localidades disponibles"}</option>
                  ) : (
                    <>
                      {/* En modo edición, si la localidad guardada no está en cpLookup.localidades,
                          mostrarla como primera opción para que el <select> la pueda renderizar. */}
                      {localidad && !cpLookup.localidades.includes(localidad) && (
                        <option value={localidad}>{localidad} (guardado)</option>
                      )}
                      <option value="">Seleccionar localidad</option>
                      {cpLookup.localidades.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Provincia *</label>
                <select value={provincia} onChange={e => handleChangeProvincia(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b] bg-white">
                  <option value="">Seleccionar provincia</option>
                  {PROVINCIAS_AR.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Horarios */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Horarios de Colecta</h3>
              <p className="text-[10px] text-gray-500 mt-1">Marcá las franjas en las que el courier puede pasar a buscar paquetes.</p>
            </div>
            <HorariosEditor value={horarios} onChange={setHorarios} />
          </section>

          {/* Observaciones */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Observaciones</h3>
            <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" placeholder="Aclaraciones de acceso, horarios especiales, contacto alternativo, etc." />
          </section>

          {/* Flags (solo admin/gerente) */}
          {puedeEditarFlags && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
              <h3 className="text-xs font-black text-amber-800 uppercase tracking-widest">Estado y prioridad</h3>
              <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${esPredeterminado ? 'bg-amber-100 border border-amber-300' : 'border border-amber-200'}`}>
                <input type="checkbox" checked={esPredeterminado} onChange={e => setEsPredeterminado(e.target.checked)} className="w-4 h-4 text-amber-600" />
                <Star className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-bold text-amber-900">Marcar como predeterminado</span>
                <span className="text-[10px] text-amber-700 ml-auto">{totalDepositos === 0 && !esEdicion ? 'Forzado: es el primero' : 'Solo uno por empresa'}</span>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${activo ? 'bg-green-100 border border-green-300' : 'border border-gray-200'}`}>
                <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} className="w-4 h-4 text-green-600" />
                <span className="text-sm font-bold text-gray-800">Activo</span>
                <span className="text-[10px] text-gray-600 ml-auto">Inactivar = no se puede usar para envíos nuevos</span>
              </label>
            </section>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 bg-white flex justify-end gap-3 shrink-0">
          <button onClick={onClose} disabled={guardando} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors text-sm disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="flex items-center gap-2 px-6 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl transition-colors shadow-sm text-sm disabled:opacity-50">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {esEdicion ? 'Guardar cambios' : 'Crear depósito'}
          </button>
        </div>
      </div>
    </div>
  );
}
