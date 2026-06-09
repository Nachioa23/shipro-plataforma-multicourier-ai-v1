"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Search, Package, Clock, Inbox, Download, Loader2, Calendar, DollarSign, ChevronLeft, ChevronRight, CheckSquare, Square, Building2, AlertTriangle, MapPin, SearchCode, X, Check, SlidersHorizontal, ChevronDown, Truck, LifeBuoy, MessageSquare, Wallet, Warehouse } from 'lucide-react';
import AccionesEnvio from '@/components/AccionesEnvio';

declare global {
  interface Window {
    google: any;
  }
}

// Las 24 Provincias Oficiales de Argentina
const PROVINCIAS_ARGENTINA = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", 
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", 
  "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", 
  "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"
];

export default function BandejaPedidos() {
  const { data: session } = useSession();
  const brandColor = '#233b6b';
  
  const [envios, setEnvios] = useState<any[]>([]);
  const [cargandoEnvios, setCargandoEnvios] = useState(true);
  const [exportando, setExportando] = useState(false);
  
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalEnvios, setTotalEnvios] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // FILTROS Y BUSQUEDA
  const [busqueda, setBusqueda] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filtroCourier, setFiltroCourier] = useState("Todos");
  const [filtroProvincia, setFiltroProvincia] = useState("Todas");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroEstadoRapido, setFiltroEstadoRapido] = useState("Todos");
  const [enviosBloqueadosSaldoCount, setEnviosBloqueadosSaldoCount] = useState(0);
  const [enviosBloqueadosDepositoCount, setEnviosBloqueadosDepositoCount] = useState(0);
  const enviosBloqueadosTotal = enviosBloqueadosSaldoCount + enviosBloqueadosDepositoCount;
  
  // LISTA DINÁMICA DE COURIERS
  const [couriersLista, setCouriersLista] = useState<string[]>([]);
  
  // EL MODO DIOS
  const esEquipoShipro = session?.user?.rol === 'admin_shipro' || session?.user?.rol === 'operador_shipro';
  const [listaClientes, setListaClientes] = useState<any[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<string>("TODAS");

  const [seleccionadas, setSeleccionadas] = useState<number[]>([]);

  // ==========================================
  // ESTADOS DEL POP-UP DE AUDITORÍA (PEAJE)
  // ==========================================
  const [envioACorregir, setEnvioACorregir] = useState<any>(null);
  const [formCorreccion, setFormCorreccion] = useState({ calle: "", altura: "", cp: "", localidad: "", provincia: "" });
  const [guardandoCorreccion, setGuardandoCorreccion] = useState(false);
  const [busquedaGoogleMaps, setBusquedaGoogleMaps] = useState("");

  const autocompleteModalInputRef = useRef<HTMLInputElement>(null);
  const autocompleteModalInstanceRef = useRef<any>(null);

  // ==========================================
  // ESTADOS DEL POP-UP DE SOPORTE (TICKETS)
  // ==========================================
  const [envioTicket, setEnvioTicket] = useState<any>(null);
  const [formTicket, setFormTicket] = useState({ motivo: "", observacion: "" });
  const [creandoTicket, setCreandoTicket] = useState(false);

  useEffect(() => {
    if (esEquipoShipro) {
      fetch("/api/clientes").then(res => res.json()).then(data => setListaClientes(data));
      setFiltroEmpresaId("TODAS");
    } else {
      setFiltroEmpresaId(session?.user?.empresaId?.toString() || "");
    }
  }, [esEquipoShipro, session]);

  const fetchEnvios = async () => {
    if (!filtroEmpresaId) return;
    setCargandoEnvios(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: session?.user?.empresaId?.toString() || "TODAS",
        rol: session?.user?.rol || "cliente",
        filtroEmpresa: filtroEmpresaId,
        page: page.toString(),
        limit: limit.toString(),
        search: busqueda,
        courier: filtroCourier,
        provincia: filtroProvincia,
        fechaDesde: fechaDesde,
        fechaHasta: fechaHasta,
        estado: filtroEstadoRapido
      });

      const res = await fetch(`/api/envios?${queryParams}`);
      const result = await res.json();
      
      setEnvios(result.data || []);
      setTotalEnvios(result.meta?.total || 0);
      setTotalPages(result.meta?.totalPages || 1);

      if (result.meta?.filtrosDinamicos) {
        setCouriersLista(result.meta.filtrosDinamicos.couriers || []);
      }
    } catch (err) {
      console.error("Error al cargar envíos");
    } finally {
      setCargandoEnvios(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchEnvios();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [page, limit, busqueda, filtroCourier, filtroProvincia, fechaDesde, fechaHasta, filtroEmpresaId, filtroEstadoRapido]);

  // Contadores de envíos bloqueados — solo para clientes.
  // DEUDA 16 (BLOQUEADO_SALDO) + DEUDA 27 (BLOQUEADO_DEPOSITO).
  // Shipro ve los contadores agregados en torre-de-control.
  useEffect(() => {
    if (esEquipoShipro || !filtroEmpresaId) return;
    const baseParams = {
      empresaId: session?.user?.empresaId?.toString() || "",
      filtroEmpresa: filtroEmpresaId,
      page: "1",
      limit: "1",
    };
    const paramsSaldo = new URLSearchParams({ ...baseParams, estado: "BloqueadosSaldo" });
    const paramsDeposito = new URLSearchParams({ ...baseParams, estado: "BloqueadosDeposito" });

    Promise.all([
      fetch(`/api/envios?${paramsSaldo}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
      fetch(`/api/envios?${paramsDeposito}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
    ])
      .then(([saldoData, depositoData]) => {
        setEnviosBloqueadosSaldoCount(saldoData.meta?.total || 0);
        setEnviosBloqueadosDepositoCount(depositoData.meta?.total || 0);
      })
      .catch(() => {
        setEnviosBloqueadosSaldoCount(0);
        setEnviosBloqueadosDepositoCount(0);
      });
  }, [session, filtroEmpresaId, esEquipoShipro, filtroEstadoRapido]);

  const handleFiltroChange = (setter: any, value: any) => {
    setter(value);
    setPage(1); 
  };

  const toggleSeleccion = (id: number) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const seleccionoTodas = envios.length > 0 && seleccionadas.length === envios.length;

  const toggleTodas = () => {
    if (seleccionoTodas) setSeleccionadas([]);
    else setSeleccionadas(envios.map(e => e.id));
  };

  const formatMonto = (valor: any) => {
    const num = parseFloat(valor) || 0;
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  };

  const exportarExcel = async () => {
    if (seleccionadas.length === 0) return;
    setExportando(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: session?.user?.empresaId?.toString() || "TODAS",
        rol: session?.user?.rol || "cliente",
        filtroEmpresa: filtroEmpresaId,
        page: "1", limit: "5000", search: busqueda, courier: filtroCourier, fechaDesde, fechaHasta, estado: filtroEstadoRapido
      });

      const res = await fetch(`/api/envios?${queryParams}`);
      const result = await res.json();
      const todosLosEnvios = result.data || [];
      const enviosAExportar = todosLosEnvios.filter((envio: any) => seleccionadas.includes(envio.id));

      const datosParaExcel = enviosAExportar.map((envio: any) => {
        const fechaReal = (envio.fechaImpresion) ? new Date(envio.fechaImpresion).toLocaleDateString("es-AR") : "Sin Fecha";
        const costo = parseFloat(envio.finanzas?.precioMostrado || envio.finanzas?.precioFactura || envio.precioDeclarado || 0);

        return {
          "Fecha": fechaReal,
          "Cliente (Empresa)": envio.empresa?.nombre || "-",
          "Destinatario": envio.destino?.nombre || envio.destinatarioNombre || "Sin Nombre",
          "C.P.": envio.destino?.cp || envio.cpDestino || "Sin CP",
          "Courier Asignado": envio.courier?.nombre || "Genérico",
          "Nro. Tracking": envio.trackingNumber || "Pendiente",
          "Nro. Orden": envio.numeroOrden || "-",
          "Costo Final ($)": Number(costo.toFixed(2)), 
          "Estado Logístico": envio.estadoActual || "Pendiente"
        };
      });

      const hojaDeTrabajo = XLSX.utils.json_to_sheet(datosParaExcel);
      const libroDeTrabajo = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libroDeTrabajo, hojaDeTrabajo, "Reporte Shipro");
      XLSX.writeFile(libroDeTrabajo, `Shipro_Envios_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      alert("Error al generar el Excel.");
    } finally {
      setExportando(false);
    }
  };

  // ==========================================
  // FUNCIONES DEL POP-UP DE AUDITORÍA
  // ==========================================
  const abrirModalCorreccion = (envio: any) => {
    setEnvioACorregir(envio);
    setFormCorreccion({
      calle: envio.destino?.calle || "",
      altura: envio.destino?.altura || "",
      cp: envio.destino?.cp || "",
      localidad: envio.destino?.localidad || "",
      provincia: envio.destino?.provincia || ""
    });
    setBusquedaGoogleMaps("");
    autocompleteModalInstanceRef.current = null;
  };

  const cerrarModal = () => {
    setEnvioACorregir(null);
    autocompleteModalInstanceRef.current = null;
  };

  useEffect(() => {
    if (!envioACorregir) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    const initAutocomplete = () => {
      if (!autocompleteModalInputRef.current || !window.google) return;
      if (autocompleteModalInstanceRef.current) return;

      autocompleteModalInstanceRef.current = new window.google.maps.places.Autocomplete(autocompleteModalInputRef.current, {
        componentRestrictions: { country: "ar" }, 
        fields: ["address_components", "geometry", "name"],
        types: ["address"], 
      });

      autocompleteModalInstanceRef.current.addListener("place_changed", () => {
        const place = autocompleteModalInstanceRef.current.getPlace();
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

        setFormCorreccion(prev => ({
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
      const existingScript = document.getElementById('google-maps-script');
      if (existingScript) {
        existingScript.addEventListener('load', initAutocomplete);
      } else {
        const script = document.createElement("script");
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = initAutocomplete;
        document.head.appendChild(script);
      }
    } else {
      setTimeout(initAutocomplete, 100);
    }
  }, [envioACorregir]);

  const handleKeyDownGoogle = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const guardarCorreccionAuditoria = async () => {
    setGuardandoCorreccion(true);
    try {
      const res = await fetch('/api/envios/corregir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          trackingNumber: envioACorregir.trackingNumber, 
          ...formCorreccion 
        })
      });

      if (res.ok) {
        cerrarModal();
        fetchEnvios(); 
      } else {
        const data = await res.json();
        alert(data.error || "Hubo un error al guardar la corrección.");
      }
    } catch (e) {
      console.error(e);
      alert("Error de conexión al intentar corregir el envío.");
    } finally {
      setGuardandoCorreccion(false);
    }
  };

  // ==========================================
  // FUNCIONES PARA TICKET DE SOPORTE (AUTOGESTIÓN)
  // ==========================================
  const abrirModalTicket = (envio: any) => {
    setEnvioTicket(envio);
    setFormTicket({ motivo: "", observacion: "" });
  };

  const cerrarModalTicket = () => {
    setEnvioTicket(null);
  };

  const enviarTicket = async () => {
    setCreandoTicket(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envioId: envioTicket.id,
          motivo: formTicket.motivo,
          observacion: formTicket.observacion,
          accionAuditoria: `Ticket creado por el e-commerce (Auto-Gestión)`
        })
      });

      if (res.ok) {
        alert("El ticket de soporte fue enviado a nuestro equipo. Te contactaremos a la brevedad.");
        cerrarModalTicket();
      } else {
        alert("Hubo un problema al crear el ticket. Intentá nuevamente.");
      }
    } catch (e) {
      console.error(e);
      alert("Error de conexión.");
    } finally {
      setCreandoTicket(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-hidden font-sans">
      
      <style dangerouslySetInnerHTML={{__html: `
        .pac-container { z-index: 999999 !important; border-radius: 12px; margin-top: 4px; border: 1px solid #e5e7eb; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2); font-family: inherit; }
        .pac-item { padding: 10px 16px; cursor: pointer; }
        .pac-item:hover { background-color: #eff6ff; }
      `}} />

      {/* POP-UP DE AUDITORÍA (PEAJE) */}
      {envioACorregir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-red-600 p-5 flex justify-between items-center text-white">
              <div>
                <h2 className="text-xl font-black flex items-center gap-2"><AlertTriangle className="w-6 h-6" /> Corrección de Dirección (Peaje)</h2>
                <p className="text-red-100 text-sm font-medium mt-1">El envío <strong>{envioACorregir.trackingNumber}</strong> rebotó en la validación inicial.</p>
              </div>
              <button onClick={cerrarModal} className="p-2 hover:bg-red-700 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="p-6 bg-red-50/50 border-r border-gray-200 flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-black text-red-800 uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin className="w-4 h-4"/> Lo que ingresó el comprador</h3>
                  <div className="bg-white p-4 rounded-xl border border-red-100 shadow-sm space-y-3 mb-4">
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase">Comprador</span><p className="text-sm font-bold text-gray-800">{envioACorregir.destino?.nombre}</p></div>
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase">Dirección Cruda (Checkout)</span><p className="text-sm font-bold text-gray-800 break-words">{envioACorregir.destino?.calle || "Calle desconocida"} {envioACorregir.destino?.altura}</p></div>
                    <div className="flex gap-4">
                      <div><span className="text-[10px] font-bold text-gray-400 uppercase">CP</span><p className="text-sm font-bold text-gray-800">{envioACorregir.destino?.cp || "0000"}</p></div>
                      <div><span className="text-[10px] font-bold text-gray-400 uppercase">Localidad</span><p className="text-sm font-bold text-gray-800">{envioACorregir.destino?.localidad || "Faltante"}</p></div>
                    </div>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 text-orange-800 p-3 rounded-lg text-xs font-bold flex gap-2">
                    <SearchCode className="w-4 h-4 shrink-0" />
                    Motivo: Falta altura, calle inexistente o el CP no coincide con la zona logística en el mapa.
                  </div>
                </div>
              </div>

              <div className="p-6 bg-white space-y-5">
                <h3 className="text-xs font-black text-green-700 uppercase tracking-wider mb-2 flex items-center gap-2"><Check className="w-4 h-4"/> Normalizar Dirección</h3>
                
                <div className="flex items-center gap-3 w-full border-2 border-blue-100 bg-blue-50/30 rounded-xl px-3 py-1 focus-within:border-blue-500 transition-colors relative">
                  <Search className="w-5 h-5 text-blue-500 shrink-0" />
                  <input ref={autocompleteModalInputRef} type="text" onKeyDown={handleKeyDownGoogle} placeholder="Buscá en Google Maps..." className="w-full bg-transparent text-sm font-bold focus:outline-none py-2 placeholder:text-blue-300" />
                </div>
                <p className="text-[9px] text-blue-500 font-bold uppercase mt-1 text-right">Powered by Google Places API</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Calle</label><input type="text" value={formCorreccion.calle} onChange={e => setFormCorreccion({...formCorreccion, calle: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" /></div>
                  <div className="col-span-2 sm:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Altura</label><input type="text" value={formCorreccion.altura} onChange={e => setFormCorreccion({...formCorreccion, altura: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" /></div>
                  <div className="col-span-2 sm:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Código Postal</label><input type="text" value={formCorreccion.cp} onChange={e => setFormCorreccion({...formCorreccion, cp: e.target.value.replace(/\D/g, '')})} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" /></div>
                  <div className="col-span-2 sm:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Localidad</label><input type="text" value={formCorreccion.localidad} onChange={e => setFormCorreccion({...formCorreccion, localidad: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" /></div>
                  <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Provincia</label><input type="text" value={formCorreccion.provincia} onChange={e => setFormCorreccion({...formCorreccion, provincia: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" /></div>
                </div>

                <div className="pt-2">
                  <button onClick={guardarCorreccionAuditoria} disabled={guardandoCorreccion || !formCorreccion.calle || !formCorreccion.altura || !formCorreccion.cp} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white font-bold rounded-xl shadow-md hover:bg-green-700 transition-colors text-sm disabled:opacity-50">
                    {guardandoCorreccion ? <Loader2 className="w-5 h-5 animate-spin" /> : "Guardar y Liberar Etiqueta"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POP-UP DE CREACIÓN DE TICKET (NUEVO) */}
      {envioTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#233b6b] p-5 flex justify-between items-center text-white">
              <div>
                <h2 className="text-lg font-black flex items-center gap-2"><LifeBuoy className="w-5 h-5" /> Abrir Incidencia</h2>
                <p className="text-blue-200 text-xs font-medium mt-1">Soporte directo con el equipo Shipro.</p>
              </div>
              <button onClick={cerrarModalTicket} className="p-2 hover:bg-blue-800 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
                <Package className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-0.5">Tracking Asociado</p>
                  <p className="text-sm font-black text-gray-800">{envioTicket.trackingNumber}</p>
                  <p className="text-xs text-gray-600 mt-1">Destinatario: {envioTicket.destino?.nombre || 'Desconocido'}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Motivo del Ticket</label>
                <select 
                  value={formTicket.motivo}
                  onChange={e => setFormTicket({...formTicket, motivo: e.target.value})}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-bold text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white"
                >
                  <option value="" disabled>Seleccioná un motivo...</option>
                  <option value="Retraso en Colecta">El correo no pasó a buscar el paquete</option>
                  <option value="Siniestro / Extravío">Posible extravío o siniestro</option>
                  <option value="Cambio de Domicilio">El cliente quiere cambiar la dirección</option>
                  <option value="Duda sobre Estado">Quiero saber qué significa el estado actual</option>
                  <option value="Otro">Otro motivo</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Observaciones</label>
                <textarea 
                  value={formTicket.observacion}
                  onChange={e => setFormTicket({...formTicket, observacion: e.target.value})}
                  placeholder="Por favor, brindanos más contexto para ayudarte rápido..."
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-medium text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 min-h-[100px] resize-none"
                ></textarea>
              </div>

              <div className="pt-2">
                <button 
                  onClick={enviarTicket}
                  disabled={creandoTicket || !formTicket.motivo}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                >
                  {creandoTicket ? <Loader2 className="w-5 h-5 animate-spin" /> : "Enviar Ticket a Soporte"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HEADER DE LA PANTALLA */}
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 shadow-sm z-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Bandeja de Pedidos</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">El Libro Mayor de tu logística.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/nuevo-envio" className="flex items-center gap-2 px-5 py-2 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-lg transition-colors shadow-sm">
              <Package className="w-4 h-4" /> Nuevo Envío Manual
            </Link>
          </div>
        </div>
      </header>

      {/* BANNER ENVÍOS BLOQUEADOS — solo clientes.
          Casos:
          1. Solo depósito (DEUDA 27)        → indigo + Warehouse + "Configurar depósito"
          2. Solo saldo (DEUDA 16)           → amber  + Wallet    + "Cargar saldo"
          3. Ambos (orden de resolución)     → amber-strong + AlertTriangle + lista 1-2
             Orden: depósito primero (prerrequisito one-time), saldo después (recurrente).
             Al destrabar depósito sin saldo: backend transiciona a BLOQUEADO_SALDO. */}
      {!esEquipoShipro && enviosBloqueadosTotal > 0 && (
        enviosBloqueadosDepositoCount > 0 && enviosBloqueadosSaldoCount > 0 ? (
          // CASO 3 — Ambos
          <div className="bg-amber-50 border-b-2 border-amber-300 px-8 py-4 shrink-0">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-amber-900">
                  Tenés <span className="font-black">{enviosBloqueadosTotal}</span> envíos bloqueados que necesitan tu atención.
                </p>
                <p className="text-xs font-bold text-amber-800 mt-0.5">Resolvé en orden:</p>
              </div>
            </div>
            <ol className="space-y-2 ml-8">
              <li className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-black text-indigo-700">1.</span>
                  <Warehouse className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-amber-900">
                    Configurá un depósito predeterminado
                    <span className="text-amber-700 font-bold ml-1">({enviosBloqueadosDepositoCount} envíos esperando)</span>
                  </span>
                </div>
                <Link href="/configuracion/depositos" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
                  Configurar depósito →
                </Link>
              </li>
              <li className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-black text-amber-700">2.</span>
                  <Wallet className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-amber-900">
                    Cargá saldo en tu cuenta
                    <span className="text-amber-700 font-bold ml-1">({enviosBloqueadosSaldoCount} envíos esperando)</span>
                  </span>
                </div>
                <Link href="/facturacion" className="px-4 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-lg transition-colors border border-amber-300 whitespace-nowrap">
                  Cargar saldo
                </Link>
              </li>
            </ol>
          </div>
        ) : enviosBloqueadosDepositoCount > 0 ? (
          // CASO 1 — Solo depósito
          <div className="bg-indigo-50 border-b border-indigo-200 px-8 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <Warehouse className="w-5 h-5 text-indigo-600 shrink-0" />
              <p className="text-sm font-bold text-indigo-900">
                Tenés <span className="font-black">{enviosBloqueadosDepositoCount}</span> envíos pendientes por configuración de depósito.
              </p>
            </div>
            <Link href="/configuracion/depositos" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Configurar depósito →
            </Link>
          </div>
        ) : (
          // CASO 2 — Solo saldo
          <div className="bg-amber-50 border-b border-amber-200 px-8 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-sm font-bold text-amber-900">
                Tenés <span className="font-black">{enviosBloqueadosSaldoCount}</span> envíos pendientes por carga de saldo.
              </p>
            </div>
            <Link href="/facturacion" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Cargar saldo →
            </Link>
          </div>
        )
      )}

      {/* CUERPO PRINCIPAL */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[90rem] mx-auto w-full space-y-6 pb-32">
          
          {/* BUSCADOR Y FILTROS INTEGRADOS */}
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row gap-3">
              
              {/* SÚPER BUSCADOR */}
              <div className="flex-1 flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-5 py-1.5 shadow-sm focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                <Search className="w-5 h-5 text-gray-400 shrink-0" />
                <input 
                  type="text" 
                  placeholder="Buscá por Tracking, Orden, Nombre, Email, DNI..." 
                  value={busqueda} 
                  onChange={(e) => handleFiltroChange(setBusqueda, e.target.value)} 
                  className="w-full bg-transparent border-none text-sm font-medium focus:outline-none py-2" 
                />
              </div>
              
              <button 
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold border transition-all ${showAdvancedFilters ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filtros Avanzados
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* PANEL DE FILTROS AVANZADOS DINÁMICOS */}
            {showAdvancedFilters && (
              <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in slide-in-from-top-2 duration-200">
                {esEquipoShipro && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Building2 className="w-3 h-3"/> Empresa / Cuenta</label>
                    <select value={filtroEmpresaId} onChange={(e) => handleFiltroChange(setFiltroEmpresaId, e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none cursor-pointer">
                      <option value="TODAS">🌟 Todas las empresas</option>
                      {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Truck className="w-3 h-3"/> Courier</label>
                  <select value={filtroCourier} onChange={(e) => handleFiltroChange(setFiltroCourier, e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none cursor-pointer">
                    <option value="Todos">Todos los Couriers</option>
                    {couriersLista.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><MapPin className="w-3 h-3"/> Provincia de Destino</label>
                  <select value={filtroProvincia} onChange={(e) => handleFiltroChange(setFiltroProvincia, e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none cursor-pointer">
                    <option value="Todas">Todas las provincias</option>
                    {PROVINCIAS_ARGENTINA.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Calendar className="w-3 h-3"/> Rango de Creación</label>
                  <div className="flex gap-2">
                    <input type="date" value={fechaDesde} onChange={(e) => handleFiltroChange(setFechaDesde, e.target.value)} className="w-1/2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none" />
                    <input type="date" value={fechaHasta} onChange={(e) => handleFiltroChange(setFechaHasta, e.target.value)} className="w-1/2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TABS DE EMBUDO OPERATIVO */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
             {[
               { id: "Todos", label: "Toda la Carga", icon: Inbox },
               { id: "Retenidos", label: "RETENIDOS 🚨", icon: AlertTriangle },
               { id: "Bloqueados", label: enviosBloqueadosTotal > 0 ? `BLOQUEADOS (${enviosBloqueadosTotal}) 🔒` : "BLOQUEADOS 🔒", icon: AlertTriangle },
               { id: "Pendientes", label: "Por Etiquetar", icon: Package },
               { id: "Etiquetados", label: "Etiquetados", icon: Check }
             ].map(tab => (
               <button
                  key={tab.id}
                  onClick={() => handleFiltroChange(setFiltroEstadoRapido, tab.id)}
                  className={`px-6 py-3 rounded-2xl text-xs font-black whitespace-nowrap transition-all border flex items-center gap-2 ${
                    filtroEstadoRapido === tab.id
                      ? tab.id === "Retenidos" ? "bg-red-600 text-white border-red-600 shadow-lg"
                        : tab.id === "Bloqueados" ? "bg-amber-600 text-white border-amber-600 shadow-lg"
                        : "bg-[#233b6b] text-white border-[#233b6b] shadow-lg"
                      : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm"
                  }`}
               >
                 <tab.icon className={`w-4 h-4 ${filtroEstadoRapido === tab.id ? 'text-white' : 'text-gray-400'}`} />
                 {tab.label}
               </button>
             ))}
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-5 bg-gray-50/50 border-b border-gray-200 flex justify-between items-center">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Listado de Pedidos <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{totalEnvios}</span></span>
            </div>

            {/* LA TABLA COMPLETA */}
            <div className="overflow-x-auto min-h-[400px]">
              {cargandoEnvios ? (
                <div className="flex flex-col items-center justify-center py-32"><Loader2 className="w-10 h-10 animate-spin text-blue-600 mb-4" /><p className="font-bold text-gray-400">Accediendo a la Base de Datos...</p></div>
              ) : envios.length === 0 ? (
                <div className="text-center py-32"><Package className="w-16 h-16 text-gray-200 mb-4 mx-auto" /><h3 className="text-lg font-bold text-gray-800">No hay coincidencias</h3><p className="text-sm text-gray-500">Probá ajustando los filtros avanzados o la búsqueda.</p></div>
              ) : (
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-white border-b border-gray-200 text-[10px] uppercase tracking-[0.2em] text-gray-400 font-black">
                      <th className="px-6 py-5 w-10 text-center" onClick={toggleTodas}>{seleccionoTodas ? <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto cursor-pointer" /> : <Square className="w-4 h-4 text-gray-200 hover:text-gray-400 transition-colors mx-auto cursor-pointer" />}</th>
                      <th className="px-6 py-5">Fecha</th>
                      <th className="px-6 py-5">Identificadores</th>
                      <th className="px-6 py-5">Destinatario</th>
                      <th className="px-6 py-5">Costo ($)</th>
                      <th className="px-6 py-5 text-center">Estado Logístico Real</th>
                      <th className="px-6 py-5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-gray-100">
                    {envios.map((envio: any) => {
                      const nombreDest = envio.destino?.nombre || envio.destinatarioNombre || 'Sin nombre';
                      const cpDest = envio.destino?.cp || envio.cpDestino || '';
                      const costoFinal = formatMonto(envio.finanzas?.precioMostrado || envio.finanzas?.precioFactura || 0);
                      const fechaTabla = (envio.fechaImpresion) ? new Date(envio.fechaImpresion).toLocaleDateString("es-AR") : 'Sin fecha';
                      
                      const esRetenido = envio.estadoActual === "RETENIDO" || envio.estadoActual === "Retenido";
                      const esBloqueadoSaldo = envio.estadoActual === "BLOQUEADO_SALDO";
                      const esBloqueadoDeposito = envio.estadoActual === "BLOQUEADO_DEPOSITO";
                      const esBloqueado = esBloqueadoSaldo || esBloqueadoDeposito;

                      return (
                        <tr key={envio.id} className={`transition-colors hover:bg-gray-50 group ${seleccionadas.includes(envio.id) ? 'bg-blue-50/50' : ''} ${esRetenido ? 'bg-red-50/20' : ''} ${esBloqueadoSaldo ? 'bg-amber-50/30' : ''} ${esBloqueadoDeposito ? 'bg-indigo-50/30' : ''}`}>
                          
                          <td className="px-6 py-4 cursor-pointer text-center" onClick={() => toggleSeleccion(envio.id)}>
                            {seleccionadas.includes(envio.id) ? <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto" /> : <Square className="w-4 h-4 text-gray-300 group-hover:text-gray-400 transition-colors mx-auto" />}
                          </td>
                          
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-gray-400" /><span className="font-bold text-gray-700 text-xs">{fechaTabla}</span></div>
                          </td>
                          
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1.5 items-start">
                              <div className="flex items-center gap-2" title="Tracking Principal">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-14 text-right">Entrega</span>
                                <p className="font-mono font-bold text-[#233b6b] text-xs bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">{envio.trackingNumber || 'Pendiente'}</p>
                              </div>
                              {/* TODO DEUDA 29 Sub-fase 3: mostrar trackings de TramoEnvio (1..N por envío) en lugar del trackingFirstMile legacy. */}
                              {envio.numeroOrden && (
                                <div className="flex items-center gap-2" title="Orden E-commerce">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-14 text-right">Orden</span>
                                  <p className="font-mono font-bold text-orange-700 text-xs bg-orange-50 border border-orange-100 px-2 py-0.5 rounded">{envio.numeroOrden}</p>
                                </div>
                              )}
                            </div>
                          </td>
                          
                          <td className="px-6 py-4">
                            <p className="font-bold text-gray-800 text-xs">{nombreDest}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">CP: {cpDest} | Courier: {envio.courier?.nombre || 'Genérico'}</p>
                            {esEquipoShipro && filtroEmpresaId === "TODAS" && <p className="text-[9px] font-bold text-indigo-500 mt-1 uppercase truncate max-w-[120px]">De: {envio.empresa?.nombre}</p>}
                          </td>
                          
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1 text-green-700 font-bold bg-green-50 px-2 py-1 rounded inline-block border border-green-100"><DollarSign className="w-3.5 h-3.5 inline" /> {costoFinal}</div>
                          </td>
                          
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-3 py-1 rounded-full border ${
                                // F5.5 (2026-06-09): usa canonicas F1. Mantiene compatibilidad
                                // con strings legacy ('Entregado', 'Retenido' con casing distinto)
                                // para envios viejos en BD que no se migran (helper normaliza
                                // on-the-fly via DEUDA 50).
                                ['ENTREGADO', 'Entregado'].includes(envio.estadoActual) ? 'bg-green-50 text-green-700 border-green-200' :
                                ['PAQUETE_RECOLECTADO', 'EN_TRANSITO_A_DESTINO', 'EN_SUCURSAL_DE_DESTINO', 'EN_SUCURSAL_DE_ENTREGA', 'EN_DISTRIBUCION', 'VISITA_FALLIDA'].includes(envio.estadoActual) ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                ['RETENIDO', 'Retenido'].includes(envio.estadoActual) ? 'bg-red-50 text-red-700 border-red-200 animate-pulse' :
                                esBloqueadoSaldo ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' :
                                esBloqueadoDeposito ? 'bg-indigo-50 text-indigo-800 border-indigo-300 animate-pulse' :
                                'bg-gray-50 text-gray-600 border-gray-200'
                            }`}>
                                {esBloqueadoSaldo ? 'BLOQUEADO POR SALDO' : esBloqueadoDeposito ? 'BLOQUEADO POR DEPÓSITO' : envio.estadoActual.replace(/_/g, ' ')}
                            </span>
                          </td>
                          
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {esRetenido ? (
                                <button onClick={() => abrirModalCorreccion(envio)} className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Corregir</button>
                              ) : esBloqueadoDeposito ? (
                                <Link href="/configuracion/depositos" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Configurar depósito</Link>
                              ) : esBloqueadoSaldo ? (
                                <Link href="/facturacion" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Cargar saldo</Link>
                              ) : (
                                <AccionesEnvio envioId={envio.id} tracking={envio.trackingNumber} etiquetaUrl={envio.etiquetaUrl} estadoInterno={envio.estadoActual} motivoBloqueo={null} />
                              )}

                              {/* NUEVO BOTÓN: SOPORTE (AUTOGESTIÓN) */}
                              {!esRetenido && !esBloqueado && (
                                <button
                                  onClick={() => abrirModalTicket(envio)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-200"
                                  title="Abrir Ticket de Soporte"
                                >
                                  <LifeBuoy className="w-5 h-5" />
                                </button>
                              )}
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Paginación */}
            <div className="p-4 bg-white border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500">Filas por página:</span>
                <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="border border-gray-300 rounded-lg px-2 py-1 text-sm font-bold text-gray-700 outline-none"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-500">Página <strong className="text-gray-800">{page}</strong> de <strong className="text-gray-800">{totalPages || 1}</strong></span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || cargandoEnvios} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0 || cargandoEnvios} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>

      {/* Barra de Acciones Lote */}
      <div className={`absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] transition-transform duration-300 z-20 flex justify-between items-center px-8 ${seleccionadas.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"><span className="text-lg font-black text-blue-700">{seleccionadas.length}</span></div>
          <div className="hidden sm:block"><p className="text-sm font-bold text-gray-800">Seleccionadas</p><p className="text-xs text-gray-500 font-medium">Listas para accionar en lote.</p></div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setSeleccionadas([])} className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors text-sm">Cancelar</button>
          <button onClick={exportarExcel} disabled={exportando} className="flex items-center gap-2 px-6 py-2.5 bg-[#107c41] text-white font-bold rounded-lg shadow-md hover:bg-[#0c5e31] transition-colors text-sm disabled:opacity-50"><Download className="w-4 h-4" /> Exportar a Excel</button>
        </div>
      </div>
    </div>
  );
}