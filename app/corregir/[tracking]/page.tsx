"use client";

import { useState, useEffect, useRef, use } from "react";
import { MapPin, AlertTriangle, CheckCircle2, Loader2, ArrowRight, Building, Search } from 'lucide-react';
import Link from "next/link";

declare global {
  interface Window {
    google: any;
  }
}

export default function CorregirDireccion({ params }: { params: Promise<{ tracking: string }> }) {
  const brandColor = '#233b6b';
  
  const { tracking } = use(params);

  const [envio, setEnvio] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [exito, setExito] = useState(false);

  const [form, setForm] = useState({
    calle: "", altura: "", piso: "", dpto: "", cp: "", localidad: "", provincia: ""
  });
  const [guardando, setGuardando] = useState(false);
  
  // NUEVO: Estados para el buscador de CP
  const [buscandoCP, setBuscandoCP] = useState(false);
  const [localidadesSugeridas, setLocalidadesSugeridas] = useState<string[]>([]);

  // Referencias para evitar el "Bug del Fantasma" de Google Maps
  const autocompleteInputRef = useRef<HTMLInputElement>(null);
  const autocompleteInstanceRef = useRef<any>(null); 

  useEffect(() => {
    const fetchEnvio = async () => {
      try {
        const res = await fetch(`/api/envios/buscar?tracking=${tracking}`);
        if (!res.ok) throw new Error("404");
        const data = await res.json();
        
        if (data.estadoActual !== "RETENIDO" && data.estadoActual !== "Retenido") {
           setExito(true); 
        } else {
           setEnvio(data);
           setForm({
             calle: data.destino?.calle || "",
             altura: data.destino?.altura || "",
             piso: data.destino?.piso || "",
             dpto: data.destino?.dpto || "",
             cp: data.destino?.cp || "",
             localidad: data.destino?.localidad || "",
             provincia: data.destino?.provincia || ""
           });
        }
      } catch (err) {
        setError(true);
      } finally {
        setCargando(false);
      }
    };
    fetchEnvio();
  }, [tracking]);

  // NUEVO: Buscador automático de CP (Igual que en la Plataforma Interna)
  useEffect(() => {
    const buscarDatosGeograficos = async () => {
      if (!form.cp || form.cp.length < 4) {
        setLocalidadesSugeridas([]); 
        return;
      }
      setBuscandoCP(true);
      try {
        const res = await fetch(`/api/geografia/buscar?cp=${form.cp}`);
        if (res.ok) {
          const data = await res.json();
          setForm(prev => ({
            ...prev,
            provincia: data.provincia,
            // Si la API devuelve localidades, seteamos la primera por defecto si estaba vacío
            localidad: prev.localidad || data.localidades[0] || ""
          }));
          setLocalidadesSugeridas(data.localidades);
        } else {
          setLocalidadesSugeridas([]); 
        }
      } catch (error) { 
        console.error("Error buscando CP:", error); 
      } finally { 
        setBuscandoCP(false); 
      }
    };
    
    // Le damos un pequeño delay para que no busque por cada número que tipea rápido
    const timeoutId = setTimeout(buscarDatosGeograficos, 500);
    return () => clearTimeout(timeoutId);
  }, [form.cp]);

  useEffect(() => {
    if (exito || error || cargando) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error("Falta la clave NEXT_PUBLIC_GOOGLE_MAPS_API_KEY en el archivo .env.local");
      return;
    }

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
            case "route":
              calle = component.short_name;
              break;
            case "street_number":
              altura = component.long_name;
              break;
            case "postal_code":
              cp = component.long_name.replace(/\D/g, ''); // Limpiamos a solo números
              break;
            case "locality":
            case "sublocality_level_1":
              localidad = component.long_name;
              break;
            case "administrative_area_level_1":
              provincia = component.long_name;
              break;
          }
        }

        setForm(prev => ({
          ...prev,
          calle: calle || prev.calle,
          altura: altura || prev.altura,
          cp: cp || prev.cp,
          localidad: localidad || prev.localidad,
          provincia: provincia || prev.provincia
        }));
      });
    };

    if (!window.google) {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initAutocomplete;
      document.head.appendChild(script);
    } else {
      initAutocomplete();
    }
  }, [cargando, exito, error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await fetch('/api/envios/corregir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking, ...form })
      });
      if (res.ok) {
        setExito(true);
      } else {
        alert("Hubo un error al guardar. Por favor, intentá de nuevo.");
      }
    } catch (err) {
      alert("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#233b6b] mb-4" />
        <p className="font-bold text-gray-500">Cargando tu envío...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6"><AlertTriangle className="w-10 h-10 text-red-500" /></div>
        <h2 className="text-2xl font-black text-gray-800 mb-2">Envío no encontrado</h2>
        <p className="text-gray-500 max-w-sm">No pudimos localizar este número de seguimiento. Por favor, revisá el link que te enviamos por correo.</p>
      </div>
    );
  }

  if (exito) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 border-8 border-green-50 shadow-sm"><CheckCircle2 className="w-12 h-12 text-green-600" /></div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight mb-3">¡Dirección confirmada!</h2>
        <p className="text-gray-600 font-medium max-w-sm mb-8 leading-relaxed">
          Gracias por actualizar tus datos. Ya liberamos tu pedido para que siga su curso normal.
        </p>
        <Link href={`/s/${tracking}`} className="px-8 py-3 bg-[#233b6b] text-white font-bold rounded-xl shadow-lg hover:bg-blue-900 transition-colors flex items-center gap-2">
          Ir al seguimiento de mi pedido <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      
      {/* CAPA DE ESTILO: Asegura que el desplegable de Google Maps sea clickeable siempre */}
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

      <header className="h-16 bg-white border-b border-gray-200 flex justify-center items-center sticky top-0 z-50 shadow-sm">
        <h1 className="text-2xl font-black tracking-tighter" style={{ color: brandColor }}>SHIPRO<span className="text-blue-500">.</span></h1>
      </header>

      <main className="flex-1 flex flex-col items-center py-8 px-4 sm:px-6">
        <div className="w-full max-w-lg space-y-6">
          
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center p-3 bg-red-100 text-red-600 rounded-full mb-4 ring-8 ring-red-50">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Acción Requerida</h2>
            <p className="text-gray-500 text-sm mt-2 font-medium">Tuvimos un problema al validar tu dirección de entrega. Por favor, actualizá los datos para que podamos despachar tu compra.</p>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-5 bg-red-50 border-b border-red-100 flex items-start gap-4">
              <MapPin className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-black text-red-800 uppercase tracking-wider mb-1">Lo que ingresaste originalmente:</h3>
                <p className="text-sm font-bold text-gray-800">{envio.destino?.calle} {envio.destino?.altura}</p>
                <p className="text-xs text-gray-500 mt-0.5">CP: {envio.destino?.cp} - {envio.destino?.localidad}, {envio.destino?.provincia}</p>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                
                {/* MAGIA: Buscador Inteligente de Google Maps */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest">Buscador Inteligente</label>
                  <div className="relative flex items-center bg-blue-50/50 border-2 border-blue-200 rounded-xl overflow-hidden focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
                    <div className="pl-4 pr-2 flex items-center pointer-events-none">
                      <Search className="w-5 h-5 text-blue-500" />
                    </div>
                    <input 
                      ref={autocompleteInputRef}
                      type="text" 
                      onKeyDown={handleKeyDown}
                      placeholder="Empezá a escribir tu dirección acá..." 
                      className="w-full py-3.5 pr-4 bg-transparent text-sm font-bold text-gray-800 outline-none placeholder:text-blue-300"
                    />
                  </div>
                  <p className="text-[9px] font-bold text-gray-400 uppercase text-right">Powered by Google Places API</p>
                </div>

                <div className="h-px w-full bg-gray-100 my-2"></div>

                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 sm:col-span-8">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Calle *</label>
                    <input required type="text" value={form.calle} onChange={e => setForm({...form, calle: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                  </div>
                  <div className="col-span-12 sm:col-span-4">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Altura *</label>
                    <input required type="text" value={form.altura} onChange={e => setForm({...form, altura: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                  </div>
                  
                  <div className="col-span-6 sm:col-span-6">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Piso (Opcional)</label>
                    <input type="text" value={form.piso} onChange={e => setForm({...form, piso: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" placeholder="Ej: 4" />
                  </div>
                  <div className="col-span-6 sm:col-span-6">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Depto (Opcional)</label>
                    <input type="text" value={form.dpto} onChange={e => setForm({...form, dpto: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" placeholder="Ej: B" />
                  </div>

                  <div className="col-span-12 sm:col-span-4">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                      Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                    </label>
                    <input required type="text" value={form.cp} onChange={e => setForm({...form, cp: e.target.value.replace(/\D/g, '')})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                  </div>
                  
                  {/* NUEVO: Provincia como input de solo lectura */}
                  <div className="col-span-12 sm:col-span-8">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Provincia (Automático)</label>
                    <input type="text" value={form.provincia} readOnly className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-500 cursor-not-allowed" placeholder="Esperando CP..." />
                  </div>

                  {/* NUEVO: Localidad editable, pero sugerida por el CP */}
                  <div className="col-span-12">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Localidad *</label>
                    <input required type="text" value={form.localidad} onChange={e => setForm({...form, localidad: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                  </div>

                </div>

                <div className="pt-6 border-t border-gray-100">
                  <button 
                    type="submit" 
                    disabled={guardando || !form.calle || !form.altura || !form.cp || !form.localidad}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-[#233b6b] text-white font-black rounded-xl shadow-lg hover:bg-blue-900 transition-colors disabled:opacity-50 disabled:shadow-none"
                  >
                    {guardando ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar mi dirección"}
                  </button>
                  <p className="text-[10px] text-center text-gray-400 mt-4 font-medium uppercase tracking-widest">Tus datos están protegidos</p>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}