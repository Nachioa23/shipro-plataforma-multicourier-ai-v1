"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Package, MapPin, Building2, ArrowRight, Loader2, AlertCircle, X, User, Search, BookOpen, ShoppingBag } from 'lucide-react';

declare global {
  interface Window {
    google: any;
  }
}

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
  const [buscandoCP, setBuscandoCP] = useState(false);

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

  const autocompleteInputRef = useRef<HTMLInputElement>(null);
  const autocompleteInstanceRef = useRef<any>(null); 

  // Buscador de CP (Geografía)
  useEffect(() => {
    const buscarDatosGeograficos = async () => {
      if (!destCP || destCP.length < 4) {
        setDestLocalidades([]); 
        setDestProvincia(""); 
        return;
      }
      setBuscandoCP(true);
      try {
        const res = await fetch(`/api/geografia/buscar?cp=${destCP}`);
        if (res.ok) {
          const data = await res.json();
          setDestProvincia(data.provincia);
          setDestLocalidades(data.localidades);
          setDestLocalidadSeleccionada(data.localidades[0]);
        } else {
          setDestLocalidades([]); 
          setDestProvincia("");
        }
      } catch (error) { 
        console.error("Error buscando CP:", error); 
      } finally { 
        setBuscandoCP(false); 
      }
    };
    
    const timeoutId = setTimeout(buscarDatosGeograficos, 500);
    return () => clearTimeout(timeoutId);
  }, [destCP]);

  // Buscador de Agenda Inteligente
  useEffect(() => {
    const buscarContactos = async () => {
      if (!busquedaAgenda || busquedaAgenda.length < 3 || !session?.user?.empresaId) {
        setResultadosAgenda([]);
        return;
      }
      setBuscandoAgenda(true);
      try {
        const res = await fetch(`/api/directorio?empresaId=${session.user.empresaId}&search=${encodeURIComponent(busquedaAgenda)}&limit=5`);
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
  }, [busquedaAgenda, session]);

  // Google Maps Autocomplete (Blindado contra renders dobles)
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    const initAutocomplete = () => {
      if (!autocompleteInputRef.current || !window.google) return;
      if (autocompleteInstanceRef.current) return;

      autocompleteInstanceRef.current = new window.google.maps.places.Autocomplete(autocompleteInputRef.current, {
        componentRestrictions: { country: "ar" }, 
        fields: ["address_components", "geometry", "name"],
        types: ["address"], 
      });

      autocompleteInstanceRef.current.addListener("place_changed", () => {
        const place = autocompleteInstanceRef.current.getPlace();
        if (!place.address_components) return;

        let calle = "";
        let altura = "";
        let cp = "";
        let localidad = "";
        let provincia = "";

        for (const component of place.address_components) {
          const componentType = component.types[0];
          switch (componentType) {
            case "route": calle = component.short_name; break;
            case "street_number": altura = component.long_name; break;
            case "postal_code": cp = component.long_name.replace(/\D/g, ''); break;
            case "locality":
            case "sublocality_level_1": localidad = component.long_name; break;
            case "administrative_area_level_1": provincia = component.long_name; break;
          }
        }

        setDestCalle(calle || "");
        setDestAltura(altura || "");
        if (cp) setDestCP(cp);
        if (provincia) setDestProvincia(provincia);
        if (localidad) {
          setDestLocalidades([localidad]);
          setDestLocalidadSeleccionada(localidad);
        }
      });
    };

    // Si ya está cargado Google, lo iniciamos
    if (window.google) {
      initAutocomplete();
      return;
    }

    // Revisamos si el script ya se inyectó pero está cargando
    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.addEventListener('load', initAutocomplete);
      return;
    }

    // Si no existe, lo inyectamos con ID único
    const script = document.createElement("script");
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = initAutocomplete;
    document.head.appendChild(script);
    
  }, []);

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
    
    setBusquedaAgenda("");
    setMostrarDropdown(false);
    setErrorValidacion(null);
  };

  const handleKeyDownGoogle = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const validarYAvanzar = () => {
    setErrorValidacion(null);

    if (esShipro && !empresaSeleccionadaId) return setErrorValidacion("Seleccioná una empresa antes de avanzar al cotizador.");
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
    // HARDCODED: CP de origen del depósito.
    // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
    // Ver DEUDAS.md
    const cpOrigen = "1050";
    
    const paramsObj: Record<string, string> = {
      origen: cpOrigen,
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

          {/* 1. ORIGEN */}
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-slate-100 rounded-lg"><Building2 className="w-5 h-5 text-slate-700" /></div>
              <h3 className="text-lg font-bold text-gray-800">1. Origen del Envío</h3>
            </div>
            <select className="w-full sm:w-1/2 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50">
              {/* HARDCODED: CP de origen del depósito. Eliminar cuando se implemente módulo Depósitos (DEUDA 4). Ver DEUDAS.md */}
              <option>Depósito Central (Ciudad Autónoma de Buenos Aires - CP 1050)</option>
            </select>
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
                <input 
                  type="tel" 
                  value={destTelefono} 
                  onChange={e => setDestTelefono(limpiarTelefono(e.target.value))} 
                  maxLength={10} 
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
              <div className="relative flex items-center bg-blue-50/50 border-2 border-blue-200 rounded-xl overflow-hidden focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
                <div className="pl-4 pr-2 flex items-center pointer-events-none">
                  <Search className="w-5 h-5 text-blue-500" />
                </div>
                <input 
                  ref={autocompleteInputRef}
                  type="text" 
                  onKeyDown={handleKeyDownGoogle}
                  placeholder="Empezá a escribir la dirección acá..." 
                  className="w-full py-3.5 pr-4 bg-transparent text-sm font-bold text-gray-800 outline-none placeholder:text-blue-300"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-12 gap-5">
              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                  Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                </label>
                <input type="text" value={destCP} onChange={e => setDestCP(e.target.value.replace(/\D/g, ''))} className="w-full border-2 border-blue-100 rounded-lg p-3 text-sm font-black text-blue-700 outline-none focus:border-blue-500" placeholder="Ej: 1614" />
              </div>

              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Provincia (Automático)</label>
                <input type="text" value={destProvincia} readOnly className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm font-bold text-gray-500 cursor-not-allowed" placeholder="Esperando CP..." />
              </div>

              <div className="col-span-12 md:col-span-4">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Localidad *</label>
                <input type="text" value={destLocalidadSeleccionada} onChange={e => setDestLocalidadSeleccionada(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" placeholder="Localidad" />
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Calle *</label>
                <input type="text" value={destCalle} onChange={e => setDestCalle(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Altura *</label>
                <input type="text" value={destAltura} onChange={e => setDestAltura(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500" />
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
            <button onClick={validarYAvanzar} className="flex items-center gap-2 px-8 py-3 text-white font-bold rounded-lg shadow-md hover:opacity-90 transition-opacity text-sm" style={{ backgroundColor: brandColor }}>
              Siguiente: Cotizar Tarifas <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}