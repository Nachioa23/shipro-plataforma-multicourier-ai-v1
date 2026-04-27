"use client";

import { useState, useEffect } from "react";
import { Search, Filter, AlertCircle, Clock, MapPin, Phone, Mail, AlertTriangle, ShieldAlert, CheckCircle2, CalendarClock, X, Loader2, BugPlay, Package, LifeBuoy, MessageSquare, Check, ArchiveRestore } from 'lucide-react';
import { useSession } from "next-auth/react";

export default function RastreoIncidencias() {
  const { data: session } = useSession();
  const [bandeja, setBandeja] = useState<any[]>([]); 
  const [selectedItem, setSelectedItem] = useState<any>(null); 
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [buscando, setBuscando] = useState(false);
  
  const [tabActiva, setTabActiva] = useState<'pendientes' | 'historial'>('pendientes');

  // ESTADOS PARA EL CONTEXTO DEL MAIL AL COURIER
  const [modoReclamo, setModoReclamo] = useState(false);
  const [mensajeCourier, setMensajeCourier] = useState("");

  const mostrarToast = (mensaje: string) => {
    setToastMessage(mensaje);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const escanearRadar = async (tab: 'pendientes' | 'historial') => {
    setCargando(true);
    setSelectedItem(null); 
    try {
      const url = tab === 'historial' ? '/api/tickets?historial=true' : '/api/tickets';
      const res = await fetch(url);
      const data = await res.json();
      
      const ticketsFormateados = (data.ticketsEnGestion || []).map((t: any) => ({
        idUnico: `TKT-${t.id}`,
        esTicket: true,
        ticketId: t.id,
        motivo: t.motivo,
        estadoTicket: t.estado,
        observacionOriginal: t.observacion,
        historial: t.auditorias,
        envio: t.envio,
        fechaOrden: new Date(t.fechaCreacion)
      }));

      const alertasFormateadas = (data.alertasRadar || []).map((a: any) => ({
        idUnico: `RADAR-${a.id}`,
        esTicket: false,
        envio: a,
        fechaOrden: new Date(a.fechaImpresion || Date.now())
      }));

      const bandejaUnificada = [...ticketsFormateados, ...alertasFormateadas].sort((a, b) => b.fechaOrden.getTime() - a.fechaOrden.getTime());
      
      setBandeja(bandejaUnificada);
      if (bandejaUnificada.length > 0) setSelectedItem(bandejaUnificada[0]);
      
    } catch (error) {
      console.error("Error al cargar la bandeja");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    escanearRadar(tabActiva);
  }, [tabActiva]);

  useEffect(() => {
    setModoReclamo(false);
    setMensajeCourier("");
  }, [selectedItem?.idUnico]);

  const buscarPorTracking = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim() !== '') {
      setBuscando(true);
      try {
        const res = await fetch(`/api/envios/buscar?tracking=${searchTerm.trim()}`);
        if (res.ok) {
          const data = await res.json();
          setSelectedItem({ idUnico: `BUSCADO-${data.id}`, esTicket: false, envio: data });
          mostrarToast("Envío encontrado exitosamente.");
          setSearchTerm("");
        } else {
          mostrarToast("❌ No se encontró ningún envío con ese Tracking.");
        }
      } catch (error) {
        mostrarToast("Error de conexión al buscar.");
      } finally {
        setBuscando(false);
      }
    }
  };

  const simularProblema = async () => {
    setGuardando(true);
    try {
      const res = await fetch('/api/simular-error', { method: 'POST' });
      if (res.ok) {
        mostrarToast("¡Siniestro simulado con éxito!");
        if (tabActiva === 'pendientes') await escanearRadar('pendientes'); 
      }
    } finally {
      setGuardando(false);
    }
  };

  const generarLinkWhatsApp = (telefono: string) => {
    if (!telefono) return "#";
    let numLimpio = telefono.replace(/\D/g, '');
    if (numLimpio.startsWith('549')) return `https://wa.me/${numLimpio}`;
    if (numLimpio.startsWith('0')) numLimpio = numLimpio.substring(1);
    else if (numLimpio.startsWith('15')) numLimpio = numLimpio.substring(2);
    return `https://wa.me/549${numLimpio}`;
  };

  const crearTicketEnBase = async (motivoAccion: string, observacionAuditoria: string) => {
    setGuardando(true);
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envioId: selectedItem.envio.id,
          motivo: selectedItem.esTicket ? selectedItem.motivo : motivoAccion,
          observacion: observacionAuditoria,
          accionAuditoria: motivoAccion,
          emailOperador: session?.user?.email
        })
      });

      if (response.ok) {
        mostrarToast(`Gestión registrada y escalada al courier`);
        await escanearRadar(tabActiva);
      } else {
        const errorData = await response.json();
        mostrarToast(`❌ ${errorData.error}`);
      }
    } catch (error) {
      console.error("Error al guardar ticket");
    } finally {
      setGuardando(false);
    }
  };

  const cerrarTicketActual = async () => {
    if (!selectedItem?.esTicket) return;
    setGuardando(true);
    try {
      const response = await fetch('/api/tickets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedItem.ticketId,
          estado: "CERRADO",
          resolucion: "Ticket resuelto por el operador de Shipro.",
          emailOperador: session?.user?.email
        })
      });

      if (response.ok) {
        mostrarToast(`Ticket CERRADO exitosamente`);
        await escanearRadar(tabActiva);
      }
    } finally {
      setGuardando(false);
    }
  };

  const confirmarReclamoCourier = async () => {
    const observacionFinal = mensajeCourier.trim() !== "" 
      ? mensajeCourier 
      : "Solicitamos revisión operativa de este envío.";
    
    await crearTicketEnBase("Reclamo a Courier", observacionFinal);
    setModoReclamo(false);
    setMensajeCourier("");
  };

  const reprogramarVisita = async () => {
    const tracking = selectedItem.envio.trackingNumber;
    const emailDestino = selectedItem.envio.destino?.email || "";
    const subject = encodeURIComponent(`Shipro - Reprogramación de Visita | Tracking: ${tracking}`);
    const body = encodeURIComponent(`Hola ${selectedItem.envio.destino?.nombre || "Cliente"},\n\nTe contactamos para coordinar una nueva franja horaria de entrega...\n\nSaludos,\nOperaciones Shipro`);
    window.location.href = `mailto:${emailDestino}?cc=operaciones@shipro.pro&subject=${subject}&body=${body}`;
    await crearTicketEnBase("Reprogramación", `Mail enviado a destinatario para coordinar nueva visita.`);
  };

  const envioData = selectedItem?.envio || {};
  const nombreCliente = envioData.destino?.nombre || "Consumidor Final";
  const telefonoCliente = envioData.destino?.telefono || "No registrado";
  const nombreCourier = envioData.courier?.nombre || "Desconocido";

  return (
    <div className="flex flex-col h-full relative bg-gray-50 font-sans">
      
      {toastMessage && (
        <div className="absolute top-20 right-8 z-50 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <span className="font-medium text-sm">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="ml-4 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* CABECERA */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-slate-900 rounded-lg">
            <LifeBuoy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 leading-tight">Mesa de Ayuda</h2>
            <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Centro de Resolución</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={simularProblema} disabled={guardando} className="flex items-center gap-2 text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 px-3 py-2 rounded-lg transition-colors">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <BugPlay className="w-4 h-4" />}
            Simular Siniestro
          </button>

          <div className="relative w-80">
            {buscando ? (
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute left-3 top-1/2 -translate-y-1/2" />
            ) : (
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            )}
            <input 
              type="text" 
              placeholder="Buscar tracking global... (Enter ↵)" 
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#233b6b] focus:bg-white transition-all disabled:opacity-50 font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={buscarPorTracking}
              disabled={buscando}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* PANEL IZQUIERDO */}
        <div className="w-1/3 min-w-[350px] border-r border-gray-200 bg-white flex flex-col h-full shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
          <div className="flex border-b border-gray-200 bg-gray-50/50">
            <button 
              onClick={() => setTabActiva('pendientes')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border-b-2 ${tabActiva === 'pendientes' ? 'border-red-500 text-red-600 bg-red-50/30' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <AlertCircle className="w-4 h-4" /> Requiere Acción
            </button>
            <button 
              onClick={() => setTabActiva('historial')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border-b-2 ${tabActiva === 'historial' ? 'border-gray-800 text-gray-800 bg-gray-100/50' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <ArchiveRestore className="w-4 h-4" /> Historial
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cargando ? (
               <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                 <Loader2 className="w-8 h-8 animate-spin mb-4 text-[#233b6b]" />
                 <span className="text-sm font-bold">Sincronizando {tabActiva}...</span>
               </div>
            ) : bandeja.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-center px-4">
                 <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-4 border-4 border-green-100">
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                 </div>
                 <span className="text-base font-black text-gray-700 mb-2">Bandeja Limpia</span>
                 <p className="text-xs font-medium text-gray-500 max-w-[200px] leading-relaxed">No hay ítems en esta sección.</p>
               </div>
            ) : (
              bandeja.map((item) => (
                <div key={item.idUnico} onClick={() => setSelectedItem(item)} className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedItem?.idUnico === item.idUnico ? 'bg-blue-50 border-blue-400 shadow-sm ring-1 ring-blue-100' : 'bg-white border-gray-200 hover:border-blue-200 hover:shadow-sm'}`}>
                  
                  <div className="flex justify-between items-start mb-2">
                    {item.esTicket ? (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wide ${tabActiva === 'historial' ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                        {tabActiva === 'historial' ? <ArchiveRestore className="w-3 h-3"/> : <MessageSquare className="w-3 h-3"/>} 
                        TICKET: {item.estadoTicket}
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wide ${item.envio.estadoActual === 'S_SINIESTRO' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>
                        {item.envio.estadoActual === 'S_SINIESTRO' ? <ShieldAlert className="w-3 h-3"/> : <AlertTriangle className="w-3 h-3"/>}
                        RADAR: {item.envio.estadoActual}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-gray-400 uppercase">{item.envio.modalidad}</span>
                  </div>

                  <h4 className="font-bold text-gray-800 text-sm mb-1">{item.envio.trackingNumber}</h4>
                  
                  {item.esTicket && (
                    <p className="text-xs font-medium text-gray-600 truncate">{item.motivo}</p>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
                    <span className="font-bold text-[#233b6b]">{item.envio.courier?.nombre || 'Courier'}</span>
                    <span className="truncate max-w-[120px] text-gray-400">{item.envio.destino?.nombre || 'Sin datos'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* PANEL DERECHO */}
        <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-y-auto">
          {selectedItem ? (
            <div className="p-8 max-w-4xl mx-auto w-full animate-in fade-in zoom-in-95 duration-300">
              
              <div className="flex justify-between items-start mb-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-3xl font-black text-gray-800 tracking-tight">{envioData.trackingNumber}</h2>
                    <span className="bg-gray-100 text-[#233b6b] px-3 py-1 rounded-md text-xs font-black uppercase border border-gray-200">{nombreCourier}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-500 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Destino: {envioData.destino?.localidad || "Sin datos"}, {envioData.destino?.provincia || "Argentina"}
                  </p>
                </div>
                
                {selectedItem.esTicket && tabActiva === 'pendientes' && (
                  <button onClick={cerrarTicketActual} disabled={guardando} className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50">
                    {guardando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Cerrar Ticket
                  </button>
                )}
                {selectedItem.esTicket && tabActiva === 'historial' && (
                  <div className="px-4 py-2 bg-gray-100 text-gray-500 rounded-lg text-sm font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-gray-400"/> Ticket Archivado
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* COLUMNA 1: INFO DEL CLIENTE Y BOTONES OPERATIVOS */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2"><MapPin className="w-3 h-3" /> Datos del Comprador</h3>
                    <p className="font-black text-gray-800 text-lg mb-6 leading-tight">{nombreCliente}</p>
                    
                    <div className="flex gap-2">
                      <a href={generarLinkWhatsApp(telefonoCliente)} target="_blank" className="flex items-center justify-center w-12 h-12 bg-[#25D366] text-white rounded-xl hover:bg-[#1ebe57] transition-all shadow-sm hover:-translate-y-0.5">
                        <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                      </a>
                      <button className="flex-1 h-12 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all text-xs shadow-sm flex items-center justify-center gap-2">
                        <Mail className="w-4 h-4" /> Email
                      </button>
                    </div>
                  </div>

                  {/* Acciones Generales (Solo en pestaña Pendientes) */}
                  {tabActiva === 'pendientes' && (
                    <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 transition-all">
                      <h3 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2"><AlertCircle className="w-3 h-3" /> Acciones Operativas</h3>
                      
                      {!modoReclamo ? (
                        <div className="flex flex-col gap-3">
                          <button disabled={guardando} onClick={() => setModoReclamo(true)} className="w-full flex items-center justify-center gap-2 h-12 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-[#1a2c52] transition-all text-sm shadow-sm disabled:opacity-50">
                            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Escalar al Courier
                          </button>
                          <button disabled={guardando} onClick={reprogramarVisita} className="w-full flex items-center justify-center gap-2 h-12 bg-white border-2 border-[#233b6b] text-[#233b6b] font-bold rounded-xl hover:bg-blue-50 transition-all text-sm disabled:opacity-50">
                            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />} Coordinar Visita
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200">
                          <textarea 
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-medium text-gray-700 placeholder:text-gray-400"
                            rows={3}
                            placeholder="Escribí la instrucción para el courier..."
                            value={mensajeCourier}
                            onChange={(e) => setMensajeCourier(e.target.value)}
                          />
                          <div className="flex gap-2 mt-1">
                            <button onClick={() => setModoReclamo(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-bold rounded-lg text-xs hover:bg-gray-200 transition-all">Cancelar</button>
                            <button onClick={confirmarReclamoCourier} disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white font-bold rounded-lg text-xs hover:bg-blue-700 shadow-sm transition-all disabled:opacity-50">
                              {guardando ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mail className="w-4 h-4"/>} Enviar Mail
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2 space-y-6">
                  {selectedItem.esTicket ? (
                    <div className={`${tabActiva === 'historial' ? 'bg-gray-100 border-gray-200' : 'bg-blue-50 border-blue-200'} border shadow-sm rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden`}>
                      <MessageSquare className={`w-16 h-16 mb-4 ${tabActiva === 'historial' ? 'text-gray-300' : 'text-blue-200'}`} />
                      <h3 className={`text-xl font-black mb-2 ${tabActiva === 'historial' ? 'text-gray-600' : 'text-blue-900'}`}>Motivo: {selectedItem.motivo}</h3>
                      <p className={`text-sm font-medium bg-white p-4 rounded-xl shadow-sm max-w-lg italic ${tabActiva === 'historial' ? 'text-gray-500 border-gray-200' : 'text-blue-800 border-blue-100'}`}>
                        "{selectedItem.observacionOriginal || 'Sin observaciones detalladas.'}"
                      </p>
                      
                      {selectedItem.historial && selectedItem.historial.length > 0 && (
                        <div className={`w-full mt-8 bg-white rounded-xl p-4 text-left border ${tabActiva === 'historial' ? 'border-gray-200' : 'border-blue-100'}`}>
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Historial del Ticket</h4>
                          <div className="space-y-3">
                            {selectedItem.historial.map((aud:any) => (
                               <div key={aud.id} className="flex gap-3 text-xs">
                                  <div className={`w-1.5 rounded-full ${tabActiva === 'historial' ? 'bg-gray-300' : 'bg-blue-300'}`}></div>
                                  <div>
                                    <p className="font-bold text-gray-800">{aud.accion} <span className="font-medium text-gray-400 ml-1">por {aud.usuarioEmail}</span></p>
                                    <p className="text-gray-500 mt-0.5">{aud.detalle}</p>
                                  </div>
                               </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-8 h-full flex flex-col items-center justify-center text-center relative overflow-hidden">
                      <div className={`absolute top-0 right-0 w-32 h-32 rounded-bl-full -z-0 ${envioData.estadoActual === 'S_SINIESTRO' ? 'bg-red-50' : 'bg-orange-50'}`}></div>
                      {envioData.estadoActual === 'S_SINIESTRO' ? <ShieldAlert className="w-20 h-20 text-red-100 mb-6 relative z-10" /> : <AlertTriangle className="w-20 h-20 text-orange-100 mb-6 relative z-10" />}
                      <h3 className="text-2xl font-black text-gray-800 mb-3 relative z-10">Estado Actual: {envioData.estadoActual}</h3>
                      <p className="text-sm font-medium text-gray-500 max-w-md leading-relaxed relative z-10">
                        El Radar detuvo este envío por un problema operativo o siniestro. Podés intervenir creando un ticket o escalándolo directamente.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
              <CheckCircle2 className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-sm font-medium">Bandeja en espera</p>
              <p className="text-xs mt-2 max-w-[250px] text-center">Seleccioná un ítem del panel izquierdo para gestionarlo.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}