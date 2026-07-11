"use client";

import { useState, useEffect } from "react";
import { X, Save, Loader2, AlertCircle, Star } from "lucide-react";
import HorariosEditor, { HORARIOS_DEFAULT, HorariosSemana, parsearHorarios } from "./HorariosEditor";
import InputTelefono from "@/components/forms/InputTelefono";
import AutocompleteAddress, { AddressData } from "@/components/forms/AutocompleteAddress";
import { useCpLookup } from "@/lib/hooks/useCpLookup";
import { PROVINCIAS_AR } from "@/lib/constants/provincias-ar";
import CoberturaGrid from "@/components/configuracion/CoberturaGrid";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (depositoGuardado?: any) => void;
  empresaId: number | null;
  depositoExistente?: any | null;
  puedeEditarFlags: boolean;
  totalDepositos: number;
  // DEUDA 17.E.4.3.a (2026-06-23): permite ocultar el boton X cuando el componente
  // se embebe en flows donde el usuario no debe poder cerrar (ej: wizard onboarding).
  hideCloseButton?: boolean;
}

export default function DepositoForm({ isOpen, onClose, onSaved, empresaId, depositoExistente, puedeEditarFlags, totalDepositos, hideCloseButton = false }: Props) {
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

  // === DEUDA 29 Sub-fase 6.D.7: courier recolector (consolidador) ===
  // courierRecolectorId: seleccion actual. courierRecolectorOriginal:
  // valor al abrir el form, para detectar si el usuario lo cambio.
  // mostrarModalCascada + cascadaPreview: estado del modal de
  // confirmacion que muestra el preview del dry-run.
  const [courierRecolectorId, setCourierRecolectorId] = useState<number | null>(null);
  const [courierRecolectorOriginal, setCourierRecolectorOriginal] = useState<number | null>(null);
  const [mostrarModalCascada, setMostrarModalCascada] = useState(false);
  const [cascadaPreview, setCascadaPreview] = useState<any | null>(null);

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

      // === DEUDA 29 Sub-fase 6.D.7: cargar courier recolector actual ===
      // Trae el courierRecolectorId actual del deposito para inicializar el
      // estado del form (baseline para detectar cambios y armar el body).
      // Si el fetch falla, el selector queda vacio pero el form sigue operativo.
      (async () => {
        try {
          const resCfg = await fetch(`/api/depositos/${depositoExistente.id}/courier-configs`);
          if (!resCfg.ok) throw new Error("courier-configs no disponible");
          const dataCfg = await resCfg.json();
          const recolectorActual = dataCfg.deposito?.courierRecolectorId ?? null;
          setCourierRecolectorId(recolectorActual);
          setCourierRecolectorOriginal(recolectorActual);
        } catch {
          // Falla silenciosa: el grid mostrara error propio via su propio fetch.
          setCourierRecolectorId(null);
          setCourierRecolectorOriginal(null);
        }
      })();
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

      // === DEUDA 29 Sub-fase 6.D.7: reset del estado de consolidador ===
      // En modo creacion el selector no se muestra; igual reseteamos el
      // estado para que una instancia reusada del form no arrastre datos
      // de una edicion previa.
      setCourierRecolectorId(null);
      setCourierRecolectorOriginal(null);
      setMostrarModalCascada(false);
      setCascadaPreview(null);
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

    // === DEUDA 29 Sub-fase 6.D.7: courier recolector al body ===
    // Solo en edicion. En creacion el selector no existe (queda null).
    if (esEdicion) body.courierRecolectorId = courierRecolectorId;

    if (!esEdicion) body.empresaId = empresaId;

    // === DEUDA 29 Sub-fase 6.D.7: ejecutarPut reusable ===
    // Hace el fetch PUT/POST. Con esDryRun=true agrega ?dryRun=true:
    // el backend computa la cascada del consolidador sin escribir.
    // Devuelve { ok, data } para que el llamador decida que hacer.
    const ejecutarPut = async (esDryRun: boolean): Promise<{ ok: boolean; data: any }> => {
      const base = esEdicion ? `/api/depositos/${depositoExistente.id}` : '/api/depositos';
      const url = esDryRun ? `${base}?dryRun=true` : base;
      const method = esEdicion ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    };

    try {
      // === DEUDA 29 Sub-fase 6.D.7: flujo de guardado con dry-run ===
      // Si el consolidador cambio (solo posible en edicion), primero
      // se hace un dry-run. Si la cascada tiene contenido real, se abre
      // el modal de confirmacion y guardar() termina aca: el PUT real
      // lo dispara el boton "Confirmar" del modal (confirmarCascada).
      // Si no cambio, o la cascada esta vacia, se hace el PUT directo.
      const consolidadorCambio = esEdicion && courierRecolectorId !== courierRecolectorOriginal;

      if (consolidadorCambio) {
        const previo = await ejecutarPut(true);
        if (!previo.ok) {
          setError(previo.data?.error || 'Error al previsualizar el cambio de consolidador');
          setGuardando(false);
          return;
        }
        const cascada = previo.data?.cambiosCascada;
        const tieneContenido =
          !!cascada &&
          ((cascada.recogeViaConsolidadorReset?.length ?? 0) > 0 ||
            (cascada.recogeViaConsolidadorPreservado?.length ?? 0) > 0 ||
            (cascada.eligiblesParaActivar?.length ?? 0) > 0 ||
            (cascada.skipsDeValidacion?.length ?? 0) > 0);
        if (tieneContenido) {
          setCascadaPreview(cascada);
          setMostrarModalCascada(true);
          setGuardando(false);
          return;
        }
      }

      const res = await ejecutarPut(false);
      if (!res.ok) {
        setError(res.data?.error || 'Error al guardar');
        setGuardando(false);
        return;
      }
      onSaved(res.data);
      onClose();
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardando(false);
    }
  };

  // === DEUDA 29 Sub-fase 6.D.7: confirmarCascada ===
  // Dispara el PUT real cuando el usuario confirma el modal de cascada.
  // Reconstruye el body (mismos 16 campos + courierRecolectorId): es una
  // funcion hermana de guardar(), no comparte su closure. En exito cierra
  // el modal y el form; en error muestra el mensaje y cierra el modal
  // para que el usuario pueda reintentar.
  const confirmarCascada = async () => {
    if (!esEdicion) return;
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
      courierRecolectorId,
      autoActivarEligibles: true,
    };
    try {
      const res = await fetch(`/api/depositos/${depositoExistente.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Error al guardar el cambio de consolidador');
        setMostrarModalCascada(false);
        setGuardando(false);
        return;
      }
      setMostrarModalCascada(false);
      onSaved(data);
      onClose();
    } catch {
      setError('Error de conexión');
      setMostrarModalCascada(false);
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
          {!hideCloseButton && (
            <button onClick={onClose} disabled={guardando} className="p-2 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50">
              <X className="w-5 h-5" />
            </button>
          )}
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

          {/* === DEUDA 36.E: grilla de cobertura por courier (reemplaza el selector simple de recolector) === */}
          {depositoExistente && (
            <CoberturaGrid
              depositoId={depositoExistente.id}
              initialRecolectorId={courierRecolectorId}
              onRecolectorChange={setCourierRecolectorId}
            />
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

      {/* === DEUDA 29 Sub-fase 6.D.7: modal de confirmacion de cascada ===
          Se muestra cuando el usuario cambia el consolidador y el dry-run
          devolvio una cascada con contenido. z-[60] para quedar sobre el
          form (z-50). Solo informa + confirma; no activa nada. */}
      {mostrarModalCascada && cascadaPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            onClick={() => { if (!guardando) setMostrarModalCascada(false); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#233b6b] px-6 py-4 shrink-0">
              <h2 className="text-base font-black text-white">Confirmar cambio de consolidador</h2>
              <p className="text-xs text-blue-100 font-medium mt-0.5">
                Revisa los efectos antes de aplicar el cambio.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <h3 className="text-[11px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">
                  Couriers habilitados para activar recoleccion via consolidador
                </h3>
                {(cascadaPreview.eligiblesParaActivar?.length ?? 0) > 0 ? (
                  <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                    {cascadaPreview.eligiblesParaActivar.map((c: any) => (
                      <li key={c.courierId}>{c.courierNombre}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">(ninguno)</p>
                )}
              </div>

              <div>
                <h3 className="text-[11px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">
                  Couriers que se activarán ahora
                </h3>
                {(cascadaPreview.activablesAhora?.length ?? 0) > 0 ? (
                  <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                    {cascadaPreview.activablesAhora.map((c: any) => (
                      <li key={c.courierId}>{c.courierNombre}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">(ninguno)</p>
                )}
              </div>

              <div>
                <h3 className="text-[11px] font-black text-amber-700 uppercase tracking-wider mb-1.5">
                  Couriers pendientes de credencial
                </h3>
                {(cascadaPreview.pendienteCredencial?.length ?? 0) > 0 ? (
                  <>
                    <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                      {cascadaPreview.pendienteCredencial.map((c: any) => (
                        <li key={c.courierId}>{c.courierNombre}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-amber-600">
                      Activá su credencial en Transportes para que se sumen al recolector.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 italic">(ninguno)</p>
                )}
              </div>

              <div>
                <h3 className="text-[11px] font-black text-amber-700 uppercase tracking-wider mb-1.5">
                  Configuraciones que se resetean
                </h3>
                {(cascadaPreview.recogeViaConsolidadorReset?.length ?? 0) > 0 ? (
                  <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                    {cascadaPreview.recogeViaConsolidadorReset.map((c: any) => (
                      <li key={c.courierId}>{c.courierNombre}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">(ninguna)</p>
                )}
              </div>

              <div>
                <h3 className="text-[11px] font-black text-blue-700 uppercase tracking-wider mb-1.5">
                  Configuraciones preservadas
                </h3>
                {(cascadaPreview.recogeViaConsolidadorPreservado?.length ?? 0) > 0 ? (
                  <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                    {cascadaPreview.recogeViaConsolidadorPreservado.map((c: any) => (
                      <li key={c.courierId}>{c.courierNombre}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">(ninguna)</p>
                )}
              </div>

              {(cascadaPreview.skipsDeValidacion?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <h3 className="text-[11px] font-black text-amber-800 uppercase tracking-wider mb-1.5">
                    Avisos
                  </h3>
                  <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                    {cascadaPreview.skipsDeValidacion.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-200 bg-white flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setMostrarModalCascada(false)}
                disabled={guardando}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCascada}
                disabled={guardando}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl transition-colors shadow-sm text-sm disabled:opacity-50"
              >
                {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Confirmar cambio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
