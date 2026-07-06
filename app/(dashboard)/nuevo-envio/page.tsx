"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Package, MapPin, Building2, ArrowRight, Loader2, AlertCircle, X, User, BookOpen, ShoppingBag, Warehouse } from 'lucide-react';
import InputTelefono from "@/components/forms/InputTelefono";
import AutocompleteAddress, { AddressData } from "@/components/forms/AutocompleteAddress";
import { useCpLookup } from "@/lib/hooks/useCpLookup";
import { PROVINCIAS_AR } from "@/lib/constants/provincias-ar";

export default function NuevoEnvio() {
  const router = useRouter();
  const { data: session } = useSession();
  const brandColor = '#233b6b';
  const rol = session?.user?.rol || '';
  const esShipro = rol === 'admin_shipro' || rol === 'operador_shipro';

  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  // Dropdown shipro: empresa elegida + lista de clientes activos
  const [empresaSeleccionadaId, setEmpresaSeleccionadaId] = useState<string>("");
  const [listaClientes, setListaClientes] = useState<any[]>([]);

  useEffect(() => {
    if (!esShipro) return;
    fetch('/api/clientes')
      .then(r => r.json())
      .then(data => setListaClientes(Array.isArray(data) ? data.filter((c: any) => c.activo) : []))
      .catch(() => setListaClientes([]));
  }, [esShipro]);

  // Depósitos del cliente activo. Reemplaza el origen hardcoded "CP 1050".
  // - Cliente: arranca cargando los suyos al montar.
  // - Shipro (Modo Dios): vacío hasta que elija empresa; al elegir, recarga.
  const [depositos, setDepositos] = useState<any[]>([]);
  const [depositoSeleccionadoId, setDepositoSeleccionadoId] = useState<number | null>(null);
  const [cargandoDepositos, setCargandoDepositos] = useState(true);

  useEffect(() => {
    if (esShipro && !empresaSeleccionadaId) {
      setDepositos([]);
      setDepositoSeleccionadoId(null);
      setCargandoDepositos(false);
      return;
    }
    setCargandoDepositos(true);
    const params = esShipro ? `?empresaId=${empresaSeleccionadaId}` : "";
    fetch(`/api/depositos${params}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        const lista = Array.isArray(data) ? data : [];
        setDepositos(lista);
        const predeterminado = lista.find(d => d.esPredeterminado);
        setDepositoSeleccionadoId(predeterminado ? predeterminado.id : null);
      })
      .catch(() => {
        setDepositos([]);
        setDepositoSeleccionadoId(null);
      })
      .finally(() => setCargandoDepositos(false));
  }, [esShipro, empresaSeleccionadaId]);

  const depositoSeleccionado = depositos.find(d => d.id === depositoSeleccionadoId);

  // ==========================================
  // ESTADOS DEL FORMULARIO
  // ==========================================
  const [destNombre, setDestNombre] = useState("");
  const [destDni, setDestDni] = useState("");
  const [destEmail, setDestEmail] = useState("");
  const [destTelefono, setDestTelefono] = useState("");
  const [numeroOrden, setNumeroOrden] = useState(""); 
  
  const [destCalle, setDestCalle] = useState("");
  const [destAltura, setDestAltura] = useState("");
  const [destPiso, setDestPiso] = useState("");
  const [destDpto, setDestDpto] = useState("");
  
  const [destCP, setDestCP] = useState("");
  const [destProvincia, setDestProvincia] = useState("");
  const [destLocalidades, setDestLocalidades] = useState<string[]>([]);
  const [destLocalidadSeleccionada, setDestLocalidadSeleccionada] = useState("");

  // Coordenadas precisas del destinatario provistas por Google Places Autocomplete
  // (piece 2 del fix de proximidad de sucursales). Se invalidan (null) en cualquier
  // edicion manual de CP/calle/altura/localidad o al elegir un contacto agendado,
  // porque en esos flujos las coords quedan desalineadas con los campos.
  // Cuando ambas son no-null viajan a /cotizar por query params (paramsObj) y el
  // endpoint de sucursales las usa directo, saltandose el geocoding.
  const [destLat, setDestLat] = useState<number | null>(null);
  const [destLng, setDestLng] = useState<number | null>(null);

  // Escenario 3 (DEUDA 4 política "el usuario manda"): si el usuario edita
  // manualmente localidad o provincia, ese campo NO se autocompleta más al
  // cambiar el CP. Si lo borra, el flag se resetea y el próximo CP válido
  // vuelve a autocompletar.
  const [editadosManualmente, setEditadosManualmente] = useState({
    localidad: false,
    provincia: false,
  });

  const [paqPeso, setPaqPeso] = useState("");
  const [paqLargo, setPaqLargo] = useState("");
  const [paqAncho, setPaqAncho] = useState("");
  const [paqAlto, setPaqAlto] = useState("");

  // ==========================================
  // ESTADOS DE BUSCADORES
  // ==========================================
  const [busquedaAgenda, setBusquedaAgenda] = useState("");
  const [resultadosAgenda, setResultadosAgenda] = useState<any[]>([]);
  const [buscandoAgenda, setBuscandoAgenda] = useState(false);
  const [mostrarDropdown, setMostrarDropdown] = useState(false);


  // Buscador de CP (Geografía) — usa el hook compartido useCpLookup.
  const cpLookup = useCpLookup(destCP);
  const buscandoCP = cpLookup.buscando;

  // Sync con cpLookup respetando "Escenario 3: el usuario manda".
  // - Lista de opciones (destLocalidades) siempre se actualiza.
  // - Provincia y localidad solo se autocompletan si el usuario NO las editó manualmente.
  // - Si el CP se borra, cpLookup devuelve vacío → guards evitan sobreescribir (regla 5).
  useEffect(() => {
    setDestLocalidades(cpLookup.localidades);
    if (!editadosManualmente.provincia && cpLookup.provincia) {
      setDestProvincia(cpLookup.provincia);
    }
    if (!editadosManualmente.localidad && cpLookup.localidades.length > 0) {
      setDestLocalidadSeleccionada(cpLookup.localidades[0]);
    }
  }, [cpLookup.provincia, cpLookup.localidades, editadosManualmente]);

  // Buscador de Agenda Inteligente
  useEffect(() => {
    const buscarContactos = async () => {
      const empresaIdParaBusqueda = esShipro ? empresaSeleccionadaId : session?.user?.empresaId;
      if (!busquedaAgenda || busquedaAgenda.length < 3 || !empresaIdParaBusqueda) {
        setResultadosAgenda([]);
        return;
      }
      setBuscandoAgenda(true);
      try {
        const res = await fetch(`/api/directorio?empresaId=${empresaIdParaBusqueda}&search=${encodeURIComponent(busquedaAgenda)}&limit=5`);
        if (res.ok) {
          const result = await res.json();
          setResultadosAgenda(result.data || []);
          setMostrarDropdown(true);
        }
      } catch (error) {
        console.error("Error buscando en agenda:", error);
      } finally {
        setBuscandoAgenda(false);
      }
    };

    const timeoutId = setTimeout(buscarContactos, 400);
    return () => clearTimeout(timeoutId);
  }, [busquedaAgenda, session, esShipro, empresaSeleccionadaId]);

  // Callback que recibe el AutocompleteAddress cuando el usuario selecciona
  // una dirección del dropdown de Google. Setea todos los campos relacionados.
  const handlePlaceChanged = (data: AddressData) => {
    setDestCalle(data.calle || "");
    setDestAltura(data.altura || "");
    if (data.cp) setDestCP(data.cp);
    if (data.provincia) setDestProvincia(data.provincia);
    if (data.localidad) {
      setDestLocalidades([data.localidad]);
      setDestLocalidadSeleccionada(data.localidad);
    }
    // Coords precisas de Google Places (opcionales — pueden faltar si el resultado
    // no trae geometry). Cuando estan presentes viajan a /cotizar y evitan el
    // re-geocoding server-side.
    setDestLat(typeof data.lat === "number" && Number.isFinite(data.lat) ? data.lat : null);
    setDestLng(typeof data.lng === "number" && Number.isFinite(data.lng) ? data.lng : null);
    // Acción explícita del usuario seleccionando dirección completa → resetear
    // flags para que un cambio futuro de CP vuelva a autocompletar (Escenario 3).
    setEditadosManualmente({ localidad: false, provincia: false });
  };

  // Handlers de edición manual (marcan flag "el usuario manda")
  const handleChangeLocalidad = (valor: string) => {
    setDestLocalidadSeleccionada(valor);
    setEditadosManualmente(prev => ({ ...prev, localidad: valor !== "" }));
    // Cambio manual invalida coords previas (quedaron desalineadas).
    setDestLat(null);
    setDestLng(null);
  };

  const handleChangeProvincia = (valor: string) => {
    setDestProvincia(valor);
    setEditadosManualmente(prev => ({ ...prev, provincia: valor !== "" }));
  };

  // ==========================================
  // LÓGICA DE LIMPIEZA Y AUTOCOMPLETADO
  // ==========================================
  const limpiarDNI = (dni: string) => dni.replace(/\D/g, '').substring(0, 8);
  const limpiarTelefono = (tel: string) => tel.replace(/\D/g, '').substring(0, 10);

  const seleccionarContacto = (contacto: any) => {
    setDestNombre(contacto.nombre || "");
    setDestDni(contacto.documento || "");
    setDestEmail(contacto.email || "");
    
    let telLimpio = contacto.telefono || "";
    if (telLimpio.startsWith("+549")) telLimpio = telLimpio.replace("+549", "");
    setDestTelefono(limpiarTelefono(telLimpio));
    
    setDestCalle(contacto.calle || "");
    setDestAltura(contacto.altura || "");
    setDestPiso(contacto.piso || "");
    setDestDpto(contacto.dpto || "");
    setDestCP(contacto.cp || "");
    
    if (contacto.localidad) {
      setDestLocalidades([contacto.localidad]);
      setDestLocalidadSeleccionada(contacto.localidad);
    }
    // Contactos agendados no traen coords — invalidar cualquier lat/lng previa.
    setDestLat(null);
    setDestLng(null);
    // Acción explícita del usuario eligiendo un contacto → resetear flags.
    setEditadosManualmente({ localidad: false, provincia: false });

    setBusquedaAgenda("");
    setMostrarDropdown(false);
    setErrorValidacion(null);
  };


  const validarYAvanzar = () => {
    setErrorValidacion(null);

    if (esShipro && !empresaSeleccionadaId) return setErrorValidacion("Seleccioná una empresa antes de avanzar al cotizador.");
    if (!depositoSeleccionado) return setErrorValidacion("Seleccioná un depósito de origen antes de avanzar al cotizador.");
    if (!destNombre.trim()) return setErrorValidacion("Falta el Nombre del destinatario.");
    if (!destEmail.trim()) return setErrorValidacion("El Email del destinatario es obligatorio.");
    if (!destTelefono.trim()) return setErrorValidacion("El Teléfono es obligatorio.");
    if (!destCalle.trim()) return setErrorValidacion("Falta la Calle del destinatario.");
    if (!destAltura.trim()) return setErrorValidacion("Falta la Altura de la calle.");
    if (!destCP.trim() || !destProvincia) return setErrorValidacion("Código Postal inválido o no encontrado.");
    if (!paqPeso || !paqLargo || !paqAncho || !paqAlto) return setErrorValidacion("Faltan las medidas o el peso del paquete.");

    const dniProcesado = limpiarDNI(destDni);
    const telefonoProcesado = limpiarTelefono(destTelefono);
    
    if (dniProcesado.length > 0 && dniProcesado.length !== 8) {
        return setErrorValidacion("El DNI ingresado debe tener exactamente 8 dígitos.");
    }
    if (telefonoProcesado.length !== 10) {
        return setErrorValidacion("El Teléfono debe tener exactamente 10 dígitos (código de área sin 0 + número sin 15).");
    }

    const telefonoFinal = `+549${telefonoProcesado}`;
    // CP de origen viene del depósito elegido por el usuario.
    // depositoId también va por URL para que /cotizar lo forwardee al backend
    // (sin él, el backend caería al fallback de predeterminado y la elección
    // del usuario sería ignorada silenciosamente — DEUDA 4).
    const cpOrigen = depositoSeleccionado!.codigoPostal;

    const paramsObj: Record<string, string> = {
      depositoId: String(depositoSeleccionado!.id),
      origen: cpOrigen,
      origenNombre: depositoSeleccionado!.nombre,
      origenLocalidad: depositoSeleccionado!.localidad,
      destino: destCP,
      peso: paqPeso,
      largo: paqLargo,
      ancho: paqAncho,
      alto: paqAlto,
      localidad: destLocalidadSeleccionada,
      nombre: destNombre,
      dni: dniProcesado,
      email: destEmail,
      telefono: telefonoFinal,
      calle: destCalle,
      altura: destAltura,
      piso: destPiso,
      dpto: destDpto,
      orden: numeroOrden
    };
    if (esShipro && empresaSeleccionadaId) {
      paramsObj.filtroEmpresa = empresaSeleccionadaId;
    }
    // Coords precisas del destinatario (solo si Google Places las entrego y no
    // hubo edicion manual posterior). El endpoint /api/envios/sucursales las usa
    // directo y saltea el re-geocoding server-side.
    if (destLat !== null && destLng !== null) {
      paramsObj.lat = String(destLat);
      paramsObj.lng = String(destLng);
    }
    const params = new URLSearchParams(paramsObj);

    router.push(`/cotizar?${params.toString()}`);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      
      <style dangerouslySetInnerHTML={{__html: `
        .pac-container {
          z-index: 99999 !important;
          border-radius: 12px;
          margin-top: 4px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          font-family: inherit;
        }
        .pac-item {
          padding: 10px 16px;
          cursor: pointer;
        }
        .pac-item:hover {
          background-color: #eff6ff;
        }
      `}} />

      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8 z-10 shrink-0">
        <Link href="/" className="mr-4 p-2 -ml-2 text-gray-400 hover:text-[#233b6b] rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-xl font-bold text-gray-800">Crear Nuevo Envío</h2>
      </header>

      <div className="flex-1 p-8 overflow-y-auto relative">
        
        {errorValidacion && (
          <div className="max-w-4xl mx-auto mb-6 bg-red-600 text-white px-6 py-3 rounded-lg shadow-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              <span className="font-bold text-sm">{errorValidacion}</span>
            </div>
            <button onClick={() => setErrorValidacion(null)} className="hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="max-w-4xl mx-auto space-y-6 pb-20">

          {esShipro && (
            <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-200">
              <label className="block text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Cotizar para empresa:
              </label>
              <select
                value={empresaSeleccionadaId}
                onChange={(e) => setEmpresaSeleccionadaId(e.target.value)}
                className="w-full sm:w-1/2 border border-indigo-200 bg-indigo-50 text-indigo-900 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none cursor-pointer"
              >
                <option value="" disabled>Seleccionar empresa…</option>
                {listaClientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          )}

          {/* 1. ORIGEN — Depósitos reales del cliente.
              4 estados:
              - Cargando → spinner
              - Lista vacía → bloque amber con CTA a /configuracion/depositos
              - 1 depósito → texto fijo (no hay nada que elegir)
              - 2+ depósitos → dropdown con predeterminado por default y ⭐ */}
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-slate-100 rounded-lg"><Warehouse className="w-5 h-5 text-slate-700" /></div>
              <h3 className="text-lg font-bold text-gray-800">1. Origen del Envío</h3>
            </div>

            {cargandoDepositos ? (
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando depósitos…
              </div>
            ) : depositos.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-sm font-bold text-amber-900">
                    No tenés depósitos configurados. Configurá un depósito predeterminado para crear envíos.
                  </p>
                </div>
                <Link href="/configuracion/depositos" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
                  Configurar depósito →
                </Link>
              </div>
            ) : depositos.length === 1 ? (
              <p className="text-sm text-gray-700">
                <span className="font-bold text-gray-500">Despachando desde:</span>{' '}
                <span className="font-bold text-gray-800">{depositos[0].nombre}</span>{' '}
                <span className="text-gray-600">({depositos[0].localidad}, {depositos[0].provincia} - CP {depositos[0].codigoPostal})</span>
              </p>
            ) : (
              <select
                value={depositoSeleccionadoId ?? ""}
                onChange={(e) => setDepositoSeleccionadoId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full sm:w-2/3 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">Seleccionar origen</option>
                {depositos.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre} ({d.localidad}, {d.provincia} - CP {d.codigoPostal}){d.esPredeterminado ? " ⭐" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 2. DESTINATARIO Y AGENDA */}
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg"><User className="w-5 h-5 text-blue-600" /></div>
                <h3 className="text-lg font-bold text-gray-800">2. Datos de Contacto</h3>
              </div>
              {/* NÚMERO DE ORDEN */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg w-48 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                <ShoppingBag className="w-4 h-4 text-gray-400 shrink-0" />
                <input 
                  type="text" 
                  value={numeroOrden} 
                  onChange={e => setNumeroOrden(e.target.value)} 
                  placeholder="Nro de Orden (Opcional)" 
                  className="w-full bg-transparent text-xs font-bold outline-none"
                />
              </div>
            </div>

            {/* BUSCADOR DE AGENDA */}
            <div className="mb-8 relative z-20">
              <div className="flex items-center gap-3 bg-blue-50/50 border border-blue-100 rounded-xl p-3">
                <BookOpen className="w-5 h-5 text-blue-500 shrink-0 ml-2" />
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Buscá en tu agenda por email o nombre para autocompletar..." 
                    value={busquedaAgenda}
                    onChange={(e) => setBusquedaAgenda(e.target.value)}
                    className="w-full bg-white border border-blue-200 rounded-lg py-2.5 pl-3 pr-10 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm"
                  />
                  {buscandoAgenda && (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>
              </div>

              {/* DROPDOWN RESULTADOS AGENDA */}
              {mostrarDropdown && busquedaAgenda.length >= 3 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden max-h-60 overflow-y-auto">
                  {resultadosAgenda.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-500">No se encontraron contactos.</div>
                  ) : (
                    resultadosAgenda.map((contacto) => (
                      <div 
                        key={contacto.id} 
                        onClick={() => seleccionarContacto(contacto)}
                        className="p-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors flex items-center justify-between group"
                      >
                        <div>
                          <p className="text-sm font-bold text-gray-800 group-hover:text-blue-700">{contacto.nombre}</p>
                          <p className="text-xs text-gray-500">{contacto.email} • {contacto.cp} {contacto.localidad}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500" />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            
            {/* CAMPOS DEL FORMULARIO */}
            <div className="grid grid-cols-12 gap-5 relative z-10">
              <div className="col-span-12 md:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre y Apellido *</label>
                <input type="text" value={destNombre} onChange={e => setDestNombre(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" placeholder="Ej. Ana Gómez" />
              </div>
              <div className="col-span-12 md:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">DNI</label>
                <input type="text" value={destDni} onChange={e => setDestDni(limpiarDNI(e.target.value))} maxLength={8} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" placeholder="Solo 8 números" />
              </div>
              <div className="col-span-12 md:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Email * (Dato Rector)</label>
                <input type="email" value={destEmail} onChange={e => setDestEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" placeholder="cliente@email.com" />
              </div>
              <div className="col-span-12 md:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Teléfono (WhatsApp) *</label>
                <InputTelefono
                  value={destTelefono}
                  onChange={setDestTelefono}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500"
                  placeholder="Ej: 1155772580 (Sin 0 ni 15)"
                />
              </div>
            </div>
          </div>

          {/* 3. DIRECCIÓN DE ENTREGA (CON GOOGLE MAPS) */}
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-50 rounded-lg"><MapPin className="w-5 h-5 text-blue-600" /></div>
              <h3 className="text-lg font-bold text-gray-800">3. Dirección de Entrega</h3>
            </div>

            {/* BUSCADOR DE GOOGLE MAPS */}
            <div className="mb-6 space-y-2">
              <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest">Buscador Inteligente (Recomendado)</label>
              <AutocompleteAddress onPlaceChanged={handlePlaceChanged} />
            </div>
            
            <div className="grid grid-cols-12 gap-5">
              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                  Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                </label>
                <input type="text" value={destCP} onChange={e => { setDestCP(e.target.value.replace(/\D/g, '')); setDestLat(null); setDestLng(null); }} className="w-full border-2 border-blue-100 rounded-lg p-3 text-sm font-black text-blue-700 outline-none focus:border-blue-500" placeholder="Ej: 1614" />
              </div>

              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Provincia *</label>
                <select value={destProvincia} onChange={e => handleChangeProvincia(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500 bg-white">
                  <option value="">Seleccionar provincia</option>
                  {PROVINCIAS_AR.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Localidad *</label>
                <select
                  value={destLocalidadSeleccionada}
                  onChange={e => handleChangeLocalidad(e.target.value)}
                  disabled={destLocalidades.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500 bg-white capitalize disabled:bg-gray-50 disabled:cursor-not-allowed"
                >
                  {destLocalidades.length === 0 ? (
                    <option value="">{destCP.length < 4 ? "Esperando CP..." : "Sin localidades disponibles"}</option>
                  ) : (
                    <>
                      <option value="">Seleccionar localidad</option>
                      {destLocalidades.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                    </>
                  )}
                </select>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Calle *</label>
                <input type="text" value={destCalle} onChange={e => { setDestCalle(e.target.value); setDestLat(null); setDestLng(null); }} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Altura *</label>
                <input type="text" value={destAltura} onChange={e => { setDestAltura(e.target.value); setDestLat(null); setDestLng(null); }} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Piso</label>
                <input type="text" value={destPiso} onChange={e => setDestPiso(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none" />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Depto</label>
                <input type="text" value={destDpto} onChange={e => setDestDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none" />
              </div>
            </div>
          </div>

          {/* 4. PAQUETE */}
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
             <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-50 rounded-lg"><Package className="w-5 h-5 text-purple-600" /></div>
              <h3 className="text-lg font-bold text-gray-800">4. Medidas y Peso</h3>
            </div>
            
            <div className="grid grid-cols-4 gap-4 p-5 bg-purple-50/50 border border-purple-100 rounded-xl">
              <div className="col-span-4 sm:col-span-1">
                <label className="block text-[10px] font-bold text-purple-700 uppercase mb-1">Peso (kg) *</label>
                <input type="number" value={paqPeso} onChange={e => setPaqPeso(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-center font-bold outline-none focus:border-purple-400" placeholder="0.0" />
              </div>
              <div className="col-span-4 sm:col-span-1">
                <label className="block text-[10px] font-bold text-purple-700 uppercase mb-1">Largo (cm) *</label>
                <input type="number" value={paqLargo} onChange={e => setPaqLargo(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-center outline-none focus:border-purple-400" placeholder="0" />
              </div>
              <div className="col-span-4 sm:col-span-1">
                <label className="block text-[10px] font-bold text-purple-700 uppercase mb-1">Ancho (cm) *</label>
                <input type="number" value={paqAncho} onChange={e => setPaqAncho(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-center outline-none focus:border-purple-400" placeholder="0" />
              </div>
              <div className="col-span-4 sm:col-span-1">
                <label className="block text-[10px] font-bold text-purple-700 uppercase mb-1">Alto (cm) *</label>
                <input type="number" value={paqAlto} onChange={e => setPaqAlto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-center outline-none focus:border-purple-400" placeholder="0" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <Link href="/" className="px-6 py-3 bg-white border border-gray-300 text-gray-600 font-bold rounded-lg hover:bg-gray-100 transition-colors text-sm">
              Cancelar
            </Link>
            <button
              onClick={validarYAvanzar}
              disabled={!depositoSeleccionado || cargandoDepositos}
              title={!depositoSeleccionado ? "Configurá y seleccioná un depósito de origen para continuar." : ""}
              className="flex items-center gap-2 px-8 py-3 text-white font-bold rounded-lg shadow-md hover:opacity-90 transition-opacity text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: brandColor }}
            >
              Siguiente: Cotizar Tarifas <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}