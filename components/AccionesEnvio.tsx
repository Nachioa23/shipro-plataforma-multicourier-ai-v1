'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Printer, XCircle, Loader2, X, Clock, MapPin, RefreshCw, Package, ArrowLeftRight, Info, DollarSign, User, Store, Truck, AlertTriangle, ShieldAlert, Edit, PauseCircle, CheckCircle2 } from 'lucide-react';

interface AccionesEnvioProps {
  tracking: string;
  etiquetaUrl?: string;
  estadoInterno: string; 
  envioId: number; 
  motivoBloqueo?: 'impresa' | 'courier' | 'cancelada' | null;
}

export default function AccionesEnvio({ envioId, tracking, etiquetaUrl, estadoInterno, motivoBloqueo }: AccionesEnvioProps) {
  const [cargandoGlobal, setCargandoGlobal] = useState(false);
  
  const [modalAbierto, setModalAbierto] = useState(false);
  const [cargandoDatos, setCargandoDatos] = useState(false);
  const [datosFicha, setDatosFicha] = useState<any>(null);
  
  const [tabActiva, setTabActiva] = useState<'trazabilidad' | 'detalles' | 'inversa' | 'excepciones'>('trazabilidad');

  const [modoExcepcion, setModoExcepcion] = useState<'ninguno' | 'cambio_domicilio' | 'rescate_devolucion' | 'custodia' | 'reenvio' | 'actualizar_preenvio'>('ninguno');
  
  const [nuevoCP, setNuevoCP] = useState("");
  const [nuevaLocalidad, setNuevaLocalidad] = useState("");
  const [opcionesLocalidad, setOpcionesLocalidad] = useState<string[]>([]);
  const [buscandoCP, setBuscandoCP] = useState(false);
  const [nuevaCalle, setNuevaCalle] = useState("");
  const [nuevaAltura, setNuevaAltura] = useState("");
  const [nuevoPiso, setNuevoPiso] = useState("");
  const [nuevoDpto, setNuevoDpto] = useState("");

  const [motivoRescate, setMotivoRescate] = useState("");
  const [sucursalRescate, setSucursalRescate] = useState("");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const buscarDatosGeograficos = async () => {
      if (!nuevoCP || nuevoCP.length < 4) {
        setOpcionesLocalidad([]); 
        return;
      }
      setBuscandoCP(true);
      try {
        const res = await fetch(`/api/geografia/buscar?cp=${nuevoCP}`);
        if (res.ok) {
          const data = await res.json();
          setOpcionesLocalidad(data.localidades || []);
          if (data.localidades && data.localidades.length > 0) {
            setNuevaLocalidad(data.localidades[0]);
          }
        } else {
          setOpcionesLocalidad([]); 
        }
      } catch (error) { 
        console.error("Error buscando CP:", error); 
      } finally { 
        setBuscandoCP(false); 
      }
    };
    
    const timeoutId = setTimeout(buscarDatosGeograficos, 500);
    return () => clearTimeout(timeoutId);
  }, [nuevoCP]);

  const abrirFicha = async () => {
    setModalAbierto(true);
    setTabActiva('trazabilidad');
    setModoExcepcion('ninguno');
    await obtenerDatos(false);
  };

  const obtenerDatos = async (forzar: boolean) => {
    setCargandoDatos(true);
    try {
      const res = await fetch('/api/envios/rastreo-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking, forzarActualizacion: forzar })
      });
      const data = await res.json();
      
      if (res.ok) {
        setDatosFicha(data);
        if (forzar) alert(data.mensaje);
      } else {
        alert("❌ Error: " + data.error);
      }
    } catch (error) {
      alert("Error de conexión al cargar la ficha.");
    } finally {
      setCargandoDatos(false);
    }
  };

  const evaluarEstadoEtiqueta = (estado: string | undefined) => {
    if (!estado) return null;
    const est = estado.toLowerCase();
    if (est.includes("cancelad") || est.includes("anulad") || est.includes("rechazad")) return 'cancelada';
    if (["recolectado", "en distribución", "entregado", "en camino", "visitado"].includes(est)) return 'courier';
    if (["impreso / listo", "listo para retirar", "impresa"].includes(est)) return 'impresa';
    return null;
  };

  const handleImprimir = async () => {
    const motivo = evaluarEstadoEtiqueta(estadoInterno);
    
    if (motivo === 'cancelada') {
      const ok = window.confirm(`⚠️ ENVÍO CANCELADO\nEl envío ${tracking} está cancelado. Imprimirlo y despacharlo causará pérdidas.\n¿Estás seguro de forzar la impresión?`);
      if (!ok) return;
    } else if (motivo === 'courier') {
      const ok = window.confirm(`⚠️ EN PODER DEL COURIER\nEl envío ${tracking} ya está en tránsito logístico.\n¿Estás seguro de forzar la reimpresión?`);
      if (!ok) return;
    } else if (motivo === 'impresa') {
      const ok = window.confirm(`⚠️ ETIQUETA YA IMPRESA\nEl envío ${tracking} ya fue marcado como impreso/listo.\n¿Estás seguro de forzar la reimpresión?`);
      if (!ok) return;
    }

    setCargandoGlobal(true);
    try {
      const resPdf = await fetch("/api/etiquetas/masiva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [envioId] }), 
      });

      if (!resPdf.ok) throw new Error("Error al compilar la etiqueta.");

      const blob = await resPdf.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank'); 

      // ¡AQUÍ ESTÁ LA SOLUCIÓN! Actualizamos el estado a Impreso
      if (estadoInterno !== "Impreso / Listo" && motivo !== 'impresa') {
         await fetch("/api/envios", {
           method: "PUT",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ ids: [envioId], nuevoEstado: "Impreso / Listo" }),
         });
         window.location.reload();
      }

    } catch (err) {
      console.error(err);
      alert("Error al generar la etiqueta individual. Verificá la conexión.");
    } finally {
      setCargandoGlobal(false);
    }
  };

  const handleAnular = async () => {
    const confirmacion = window.confirm("¿Desea anular este envío y pasarlo a cuarentena?");
    if (confirmacion) {
      setCargandoGlobal(true);
      try {
        const res = await fetch('/api/envios/cancelar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracking })
        });
        if (res.ok) window.location.reload(); 
        else alert("❌ Error al cancelar.");
      } catch (error) {
        alert("❌ Error de conexión.");
      } finally {
        setCargandoGlobal(false);
      }
    }
  };

  const handleGenerarInversa = async (tipoAccion: 'cambio' | 'devolucion_domicilio' | 'devolucion_sucursal') => {
    const confirmacion = window.confirm(`¿Desea generar una etiqueta de ${tipoAccion.replace('_', ' a ')} para el envío ${tracking}?`);
    if (!confirmacion) return;

    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/inversa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingOriginal: tracking, tipoAccion })
      });
      const data = await res.json();

      if (res.ok && data.trackingNumber) {
        alert(`✅ ¡Etiqueta generada con éxito!\nNuevo Tracking: ${data.trackingNumber}`);
        window.location.reload(); 
      } else {
        alert("❌ Error al generar inversa: " + (data.error || "Desconocido"));
      }
    } catch (error) {
      alert("❌ Error de conexión con el servidor.");
    } finally {
      setCargandoGlobal(false);
    }
  };

  const enviarCambioDomicilio = async () => {
    if (!nuevaCalle || !nuevaAltura || !nuevoCP || !nuevaLocalidad) {
      alert("Por favor completá Calle, Altura, Código Postal y Localidad.");
      return;
    }
    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/andreani/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accion: 'cambio_domicilio', tracking,
          datosNuevos: { codigoPostal: nuevoCP, direccion: nuevaCalle, numero: nuevaAltura, piso: nuevoPiso, departamento: nuevoDpto, localidad: nuevaLocalidad }
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Solicitud de cambio de domicilio enviada a Andreani con éxito.");
        setModoExcepcion('ninguno');
        obtenerDatos(true);
      } else alert("❌ Error de Andreani: " + (data.error || "Desconocido"));
    } catch (error) { alert("❌ Error de conexión con el servidor."); } finally { setCargandoGlobal(false); }
  };

  const enviarRescateEnvio = async () => {
    if (!motivoRescate || !sucursalRescate) {
      alert("Por favor completá el motivo y la sucursal de destino para el rescate.");
      return;
    }
    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/andreani/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accion: 'rescate_devolucion', tracking,
          datosNuevos: { motivoDelRescateInterno: motivoRescate, numeroDeSucursal: sucursalRescate, tipoDeRescate: ["cliente"] }
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Solicitud de rescate enviada a Andreani con éxito.");
        setModoExcepcion('ninguno');
        obtenerDatos(true);
      } else alert("❌ Error de Andreani: " + (data.error || "Desconocido"));
    } catch (error) { alert("❌ Error de conexión con el servidor."); } finally { setCargandoGlobal(false); }
  };

  const enviarCustodia = async () => {
    if (!sucursalRescate) {
      alert("Por favor indicá el número de la sucursal de custodia.");
      return;
    }
    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/andreani/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accion: 'custodia', tracking,
          datosNuevos: { numeroDeSucursal: sucursalRescate }
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Solicitud de custodia en sucursal enviada a Andreani con éxito.");
        setModoExcepcion('ninguno');
        obtenerDatos(true);
      } else alert("❌ Error de Andreani: " + (data.error || "Desconocido"));
    } catch (error) { alert("❌ Error de conexión con el servidor."); } finally { setCargandoGlobal(false); }
  };

  const enviarReenvio = async () => {
    if (!nuevaCalle || !nuevaAltura || !nuevoCP || !nuevaLocalidad) {
      alert("Por favor completá Calle, Altura, Código Postal y Localidad para el re-envío.");
      return;
    }
    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/andreani/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accion: 'reenvio', tracking,
          datosNuevos: { codigoPostal: nuevoCP, direccion: nuevaCalle, numero: nuevaAltura, piso: nuevoPiso, departamento: nuevoDpto, localidad: nuevaLocalidad }
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Solicitud de re-envío enviada a Andreani con éxito.");
        setModoExcepcion('ninguno');
        obtenerDatos(true);
      } else alert("❌ Error de Andreani: " + (data.error || "Desconocido"));
    } catch (error) { alert("❌ Error de conexión con el servidor."); } finally { setCargandoGlobal(false); }
  };

  const enviarActualizacionPreenvio = async () => {
    if (!nuevaCalle || !nuevaAltura || !nuevoCP || !nuevaLocalidad) {
      alert("Por favor completá Calle, Altura, Código Postal y Localidad.");
      return;
    }
    setCargandoGlobal(true);
    try {
      const res = await fetch('/api/envios/andreani/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accion: 'actualizar_preenvio', tracking,
          datosNuevos: { codigoPostal: nuevoCP, direccion: nuevaCalle, numero: nuevaAltura, piso: nuevoPiso, departamento: nuevoDpto, localidad: nuevaLocalidad }
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Actualización de datos pre-envío enviada a Andreani con éxito.");
        setModoExcepcion('ninguno');
        obtenerDatos(true);
      } else alert("❌ Error de Andreani: " + (data.error || "Desconocido"));
    } catch (error) { alert("❌ Error de conexión con el servidor."); } finally { setCargandoGlobal(false); }
  };

  const handleExcepcionAndreani = (accion: 'cambio_domicilio' | 'rescate_devolucion' | 'custodia' | 'reenvio' | 'actualizar_preenvio') => {
    setModoExcepcion(accion);
  };

  const estaAnulada = estadoInterno === 'CANCELADO' || estadoInterno === 'ENTREGADO';

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <button onClick={abrirFicha} disabled={cargandoGlobal} title="Ver Ficha 360" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50">
          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </button>
        <button onClick={handleImprimir} disabled={cargandoGlobal || estaAnulada} title="Imprimir" className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50">
          <Printer className="w-4 h-4" />
        </button>
        <button onClick={handleAnular} disabled={cargandoGlobal || estaAnulada} title="Anular" className={`p-1.5 rounded transition-colors disabled:opacity-50 ${estaAnulada ? 'text-gray-400' : 'text-red-600 hover:bg-red-50'}`}>
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {modalAbierto && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4 whitespace-normal text-left">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col relative overflow-hidden animate-in zoom-in-95">
            
            {/* CABECERA MODAL */}
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-start shrink-0">
              <div>
                <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                  <Package className="w-6 h-6 text-[#233b6b]" /> {tracking}
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="bg-[#233b6b] text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                    {datosFicha?.envio?.courier || "Cargando..."}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${datosFicha?.envio?.estadoActual === 'CANCELADO' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                    {datosFicha?.envio?.estadoActual || "Cargando..."}
                  </span>
                </div>
              </div>
              <button onClick={() => setModalAbierto(false)} disabled={cargandoGlobal} className="text-gray-400 hover:text-gray-700 bg-gray-200/50 hover:bg-gray-200 rounded-full p-1.5 transition-colors disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* BARRA DE PESTAÑAS */}
            <div className="flex border-b border-gray-200 bg-white px-6 pt-2 overflow-x-auto shrink-0">
              <button onClick={() => {setTabActiva('trazabilidad'); setModoExcepcion('ninguno');}} className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${tabActiva === 'trazabilidad' ? 'border-[#233b6b] text-[#233b6b]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Clock className="w-4 h-4" /> Trazabilidad
              </button>
              <button onClick={() => {setTabActiva('detalles'); setModoExcepcion('ninguno');}} className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${tabActiva === 'detalles' ? 'border-[#233b6b] text-[#233b6b]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Info className="w-4 h-4" /> Detalles
              </button>
              <button onClick={() => {setTabActiva('inversa'); setModoExcepcion('ninguno');}} className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${tabActiva === 'inversa' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <ArrowLeftRight className="w-4 h-4" /> Logística Inversa
              </button>
              <button onClick={() => {setTabActiva('excepciones');}} className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${tabActiva === 'excepciones' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <ShieldAlert className="w-4 h-4" /> Gestión Excepciones
              </button>
            </div>

            {/* CONTENIDO PESTAÑAS */}
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50/30">
              {cargandoDatos && !datosFicha ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#233b6b]" />
                  <p className="text-sm font-bold">Cargando Ficha 360...</p>
                </div>
              ) : datosFicha ? (
                <>
                  {/* TRAZABILIDAD */}
                  {tabActiva === 'trazabilidad' && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <span className="text-sm font-bold text-gray-700">Línea de Tiempo</span>
                        <button onClick={() => obtenerDatos(true)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors text-xs">
                          <RefreshCw className="w-3 h-3" /> Forzar Actualización
                        </button>
                      </div>
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        {datosFicha.historial.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-4">No hay eventos registrados.</p>
                        ) : (
                          <div className="relative pl-3 border-l-2 border-gray-100 space-y-6 ml-2">
                            {datosFicha.historial.map((evento: any, index: number) => {
                              const esUltimo = index === 0;
                              return (
                                <div key={evento.id} className="relative">
                                  <div className={`absolute -left-[17px] top-1 w-3 h-3 rounded-full border-2 border-white ${esUltimo ? 'bg-[#233b6b] ring-2 ring-blue-100' : 'bg-gray-300'}`}></div>
                                  <div className="pl-4">
                                    <p className={`text-sm font-bold ${esUltimo ? 'text-[#233b6b]' : 'text-gray-700'}`}>{evento.estado}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{evento.observacion}</p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* DETALLES */}
                  {tabActiva === 'detalles' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-2 sm:col-span-1">
                        <h4 className="text-[10px] uppercase font-black text-gray-400 flex items-center gap-2 mb-3"><User className="w-3 h-3"/> Destinatario</h4>
                        <p className="text-sm font-bold text-gray-800">{datosFicha.envio.destinatario.nombre}</p>
                        <p className="text-xs text-gray-600 mt-1">{datosFicha.envio.destinatario.documento}</p>
                        <p className="text-xs text-gray-600">{datosFicha.envio.destinatario.telefono}</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-2 sm:col-span-1">
                        <h4 className="text-[10px] uppercase font-black text-gray-400 flex items-center gap-2 mb-3"><MapPin className="w-3 h-3"/> Destino</h4>
                        <p className="text-sm font-bold text-gray-800">{datosFicha.envio.destinatario.direccionStr}</p>
                        <p className="text-xs text-gray-600 mt-1">{datosFicha.envio.destinatario.localidad}</p>
                        <p className="text-xs text-gray-600">CP: {datosFicha.envio.destinatario.cp}</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-2">
                        <h4 className="text-[10px] uppercase font-black text-gray-400 flex items-center gap-2 mb-3"><DollarSign className="w-3 h-3"/> Paquete y Finanzas</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-xs text-gray-500">Peso Registrado</p>
                            <p className="text-sm font-bold text-gray-800">{datosFicha.envio.peso} Kg</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Seguro / Valor Decl.</p>
                            <p className="text-sm font-bold text-gray-800">${datosFicha.envio.finanzas.valorDeclarado}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Costo del Envío</p>
                            <p className="text-sm font-bold text-green-600">${datosFicha.envio.finanzas.costoEnvio}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* INVERSA */}
                  {tabActiva === 'inversa' && (
                    <div className="space-y-4">
                      <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl flex items-start gap-3">
                        <ArrowLeftRight className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-sm font-bold text-orange-800">Centro de Cambios y Devoluciones</h4>
                          <p className="text-xs text-orange-700 mt-1 leading-relaxed">
                            Al generar una etiqueta inversa, el destinatario original pasa a ser el remitente, y el paquete vuelve a tu depósito central de forma automática.
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                         <button onClick={() => handleGenerarInversa('cambio')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-orange-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative overflow-hidden">
                           <ArrowLeftRight className="w-5 h-5 text-gray-400 group-hover:text-orange-500 mb-2 transition-colors" />
                           <h5 className="font-black text-gray-800 text-sm group-hover:text-orange-600">Cambio (Domicilio)</h5>
                           <p className="text-[10px] text-gray-500 mt-1 leading-tight">El correo pasa por la casa del cliente a hacer el cambio mano a mano.</p>
                         </button>
                         <button onClick={() => handleGenerarInversa('devolucion_domicilio')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-red-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative overflow-hidden">
                           <Truck className="w-5 h-5 text-gray-400 group-hover:text-red-500 mb-2 transition-colors" />
                           <h5 className="font-black text-gray-800 text-sm group-hover:text-red-600">Devolución (Domicilio)</h5>
                           <p className="text-[10px] text-gray-500 mt-1 leading-tight">El correo pasa a retirar el paquete por la casa del cliente.</p>
                         </button>
                         
                         {/* Ocultamos el botón de Sucursal si el courier es Moci's */}
                         {datosFicha?.envio?.courier?.nombre?.toLowerCase().replace(/['\s]/g, '') !== 'mocis' && (
                           <button onClick={() => handleGenerarInversa('devolucion_sucursal')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative overflow-hidden">
                             <Store className="w-5 h-5 text-gray-400 group-hover:text-blue-500 mb-2 transition-colors" />
                             <h5 className="font-black text-gray-800 text-sm group-hover:text-blue-600">Devolución (Sucursal)</h5>
                             <p className="text-[10px] text-gray-500 mt-1 leading-tight">El cliente lleva el paquete a una sucursal para despacharlo.</p>
                           </button>
                         )}
                      </div>
                    </div>
                  )}

                  {/* EXCEPCIONES: MENÚ PRINCIPAL */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'ninguno' && (
                    <div className="space-y-4 animate-in fade-in">
                      <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3">
                        <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-sm font-bold text-red-800">Centro de Operaciones y Rescate</h4>
                          <p className="text-xs text-red-700 mt-1 leading-relaxed">
                            Estas acciones impactan directamente en el flujo logístico de Andreani. Utilizalas únicamente frente a contingencias o requerimientos del cliente.
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                        <button onClick={() => handleExcepcionAndreani('cambio_domicilio')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative">
                          <MapPin className="w-5 h-5 text-gray-400 group-hover:text-blue-500 mb-2 transition-colors" />
                          <h5 className="font-black text-gray-800 text-sm group-hover:text-blue-600">Cambio de Domicilio</h5>
                          <p className="text-[10px] text-gray-500 mt-1 leading-tight">Modificar dirección de entrega original.</p>
                        </button>
                        <button onClick={() => handleExcepcionAndreani('rescate_devolucion')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-red-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative">
                          <AlertTriangle className="w-5 h-5 text-gray-400 group-hover:text-red-500 mb-2 transition-colors" />
                          <h5 className="font-black text-gray-800 text-sm group-hover:text-red-600">Rescate de Envío</h5>
                          <p className="text-[10px] text-gray-500 mt-1 leading-tight">Frenar distribución y devolver paquete.</p>
                        </button>
                        <button onClick={() => handleExcepcionAndreani('custodia')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-orange-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative">
                          <PauseCircle className="w-5 h-5 text-gray-400 group-hover:text-orange-500 mb-2 transition-colors" />
                          <h5 className="font-black text-gray-800 text-sm group-hover:text-orange-600">Custodia en Sucursal</h5>
                          <p className="text-[10px] text-gray-500 mt-1 leading-tight">Retener temporalmente el paquete.</p>
                        </button>
                        <button onClick={() => handleExcepcionAndreani('reenvio')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-green-400 hover:shadow-md transition-all text-left group disabled:opacity-50 relative">
                          <RefreshCw className="w-5 h-5 text-gray-400 group-hover:text-green-500 mb-2 transition-colors" />
                          <h5 className="font-black text-gray-800 text-sm group-hover:text-green-600">Solicitar Re-envío</h5>
                          <p className="text-[10px] text-gray-500 mt-1 leading-tight">Reiniciar distribución por entrega fallida.</p>
                        </button>
                        <button onClick={() => handleExcepcionAndreani('actualizar_preenvio')} disabled={cargandoGlobal} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-gray-400 hover:shadow-md transition-all text-left group disabled:opacity-50 col-span-1 sm:col-span-2 relative">
                          <Edit className="w-5 h-5 text-gray-400 group-hover:text-gray-600 mb-2 transition-colors" />
                          <h5 className="font-black text-gray-800 text-sm group-hover:text-gray-700">Actualización Pre-Envío</h5>
                          <p className="text-[10px] text-gray-500 mt-1 leading-tight">Modificar datos antes de que el paquete inicie viaje.</p>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* VISTA: FORMULARIO DE CAMBIO DE DOMICILIO */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'cambio_domicilio' && (
                    <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-bold text-blue-800 flex items-center gap-2">
                          <MapPin className="w-5 h-5" /> Nuevo Domicilio de Entrega
                        </h4>
                        <button onClick={() => setModoExcepcion('ninguno')} className="text-gray-400 hover:text-gray-600 text-sm font-bold flex items-center gap-1">
                          <X className="w-4 h-4" /> Cancelar
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-6 border-b border-gray-100 pb-4">
                        Ingresá los datos del nuevo domicilio. La API verificará si es posible realizar el cambio según el estado actual del paquete.
                      </p>

                      <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-4">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin inline text-blue-500" />}
                          </label>
                          <input type="text" value={nuevoCP} onChange={e => setNuevoCP(e.target.value)} className="w-full border-2 border-blue-100 rounded-lg p-2.5 text-sm font-black text-blue-700 outline-none focus:border-blue-500" placeholder="Ej: 1614" />
                        </div>
                        <div className="col-span-12 md:col-span-8">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Localidad *</label>
                          <select value={nuevaLocalidad} onChange={e => setNuevaLocalidad(e.target.value)} disabled={opcionesLocalidad.length === 0} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500 disabled:bg-gray-50">
                            {opcionesLocalidad.length === 0 ? <option>Ingresá un CP válido...</option> : opcionesLocalidad.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                          </select>
                        </div>
                        <div className="col-span-12 sm:col-span-6">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Calle *</label>
                          <input type="text" value={nuevaCalle} onChange={e => setNuevaCalle(e.target.value)} maxLength={100} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura *</label>
                          <input type="text" value={nuevaAltura} onChange={e => setNuevaAltura(e.target.value)} maxLength={10} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Piso</label>
                          <input type="text" value={nuevoPiso} onChange={e => setNuevoPiso(e.target.value)} maxLength={5} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Depto</label>
                          <input type="text" value={nuevoDpto} onChange={e => setNuevoDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button 
                          onClick={enviarCambioDomicilio}
                          disabled={cargandoGlobal || !nuevoCP || !nuevaCalle || !nuevaAltura || !nuevaLocalidad}
                          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                        >
                          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          Confirmar Cambio en Andreani
                        </button>
                      </div>
                    </div>
                  )}

                  {/* VISTA 3: FORMULARIO DE RESCATE DE ENVÍO */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'rescate_devolucion' && (
                    <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-bold text-red-800 flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5" /> Iniciar Rescate de Envío
                        </h4>
                        <button onClick={() => setModoExcepcion('ninguno')} className="text-gray-400 hover:text-gray-600 text-sm font-bold flex items-center gap-1">
                          <X className="w-4 h-4" /> Cancelar
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-6 border-b border-gray-100 pb-4">
                        Esta acción ordenará a Andreani detener la distribución del paquete y enviarlo a una sucursal de guarda. Se cobrarán cargos por logística inversa.
                      </p>

                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Motivo del Rescate *</label>
                          <select 
                            value={motivoRescate} 
                            onChange={e => setMotivoRescate(e.target.value)} 
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm font-medium outline-none focus:border-red-500 bg-gray-50 cursor-pointer"
                          >
                            <option value="" disabled>Seleccioná un motivo...</option>
                            <option value="Fraude detectado">Sospecha de Fraude / Contracargo</option>
                            <option value="Cliente canceló la compra">El cliente canceló la compra</option>
                            <option value="Error en producto enviado">Error grave en la preparación del pedido</option>
                            <option value="Otro motivo administrativo">Otro motivo administrativo</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Sucursal de Destino para el Rescate *</label>
                          <input 
                            type="text" 
                            value={sucursalRescate} 
                            onChange={e => setSucursalRescate(e.target.value)} 
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-red-500" 
                            placeholder="Ej: 10021 (Ingresá el número de sucursal Andreani)" 
                          />
                          <p className="text-[10px] text-gray-400 mt-1">Ingresá el código numérico de la sucursal Andreani donde querés que quede el bulto.</p>
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button 
                          onClick={enviarRescateEnvio}
                          disabled={cargandoGlobal || !motivoRescate || !sucursalRescate}
                          className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors text-sm disabled:opacity-50"
                        >
                          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                          Confirmar Rescate Oficial
                        </button>
                      </div>
                    </div>
                  )}

                  {/* VISTA 4: FORMULARIO DE CUSTODIA */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'custodia' && (
                    <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-bold text-orange-800 flex items-center gap-2">
                          <PauseCircle className="w-5 h-5" /> Iniciar Custodia en Sucursal
                        </h4>
                        <button onClick={() => setModoExcepcion('ninguno')} className="text-gray-400 hover:text-gray-600 text-sm font-bold flex items-center gap-1">
                          <X className="w-4 h-4" /> Cancelar
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-6 border-b border-gray-100 pb-4">
                        Retendrá el envío temporalmente en la sucursal seleccionada antes de que inicie la distribución final.
                      </p>

                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Sucursal de Custodia *</label>
                          <input 
                            type="text" 
                            value={sucursalRescate} 
                            onChange={e => setSucursalRescate(e.target.value)} 
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-orange-500" 
                            placeholder="Ej: 10021" 
                          />
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button 
                          onClick={enviarCustodia}
                          disabled={cargandoGlobal || !sucursalRescate}
                          className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700 transition-colors text-sm disabled:opacity-50"
                        >
                          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                          Confirmar Custodia
                        </button>
                      </div>
                    </div>
                  )}

                  {/* VISTA 5: FORMULARIO DE RE-ENVÍO */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'reenvio' && (
                    <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-bold text-green-800 flex items-center gap-2">
                          <RefreshCw className="w-5 h-5" /> Solicitar Re-envío
                        </h4>
                        <button onClick={() => setModoExcepcion('ninguno')} className="text-gray-400 hover:text-gray-600 text-sm font-bold flex items-center gap-1">
                          <X className="w-4 h-4" /> Cancelar
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-6 border-b border-gray-100 pb-4">
                        Ingresá los datos del domicilio para reiniciar el ciclo de entrega.
                      </p>

                      <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-4">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin inline text-green-500" />}
                          </label>
                          <input type="text" value={nuevoCP} onChange={e => setNuevoCP(e.target.value)} className="w-full border-2 border-green-100 rounded-lg p-2.5 text-sm font-black text-green-700 outline-none focus:border-green-500" placeholder="Ej: 1614" />
                        </div>
                        <div className="col-span-12 md:col-span-8">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Localidad *</label>
                          <select value={nuevaLocalidad} onChange={e => setNuevaLocalidad(e.target.value)} disabled={opcionesLocalidad.length === 0} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-medium outline-none focus:border-green-500 disabled:bg-gray-50">
                            {opcionesLocalidad.length === 0 ? <option>Ingresá un CP válido...</option> : opcionesLocalidad.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                          </select>
                        </div>
                        <div className="col-span-12 sm:col-span-6">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Calle *</label>
                          <input type="text" value={nuevaCalle} onChange={e => setNuevaCalle(e.target.value)} maxLength={100} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura *</label>
                          <input type="text" value={nuevaAltura} onChange={e => setNuevaAltura(e.target.value)} maxLength={10} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-green-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Piso</label>
                          <input type="text" value={nuevoPiso} onChange={e => setNuevoPiso(e.target.value)} maxLength={5} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Depto</label>
                          <input type="text" value={nuevoDpto} onChange={e => setNuevoDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button 
                          onClick={enviarReenvio}
                          disabled={cargandoGlobal || !nuevoCP || !nuevaCalle || !nuevaAltura || !nuevaLocalidad}
                          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors text-sm disabled:opacity-50"
                        >
                          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          Confirmar Re-envío
                        </button>
                      </div>
                    </div>
                  )}

                  {/* VISTA 6: FORMULARIO DE ACTUALIZACIÓN PRE-ENVÍO */}
                  {tabActiva === 'excepciones' && modoExcepcion === 'actualizar_preenvio' && (
                    <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                          <Edit className="w-5 h-5" /> Actualizar Datos Pre-Envío
                        </h4>
                        <button onClick={() => setModoExcepcion('ninguno')} className="text-gray-400 hover:text-gray-600 text-sm font-bold flex items-center gap-1">
                          <X className="w-4 h-4" /> Cancelar
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-6 border-b border-gray-100 pb-4">
                        Modificar los datos del destino antes de que el envío comience su ciclo de distribución.
                      </p>

                      <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-4">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Código Postal * {buscandoCP && <Loader2 className="w-3 h-3 animate-spin inline text-gray-500" />}
                          </label>
                          <input type="text" value={nuevoCP} onChange={e => setNuevoCP(e.target.value)} className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-sm font-black text-gray-700 outline-none focus:border-gray-500" placeholder="Ej: 1614" />
                        </div>
                        <div className="col-span-12 md:col-span-8">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Localidad *</label>
                          <select value={nuevaLocalidad} onChange={e => setNuevaLocalidad(e.target.value)} disabled={opcionesLocalidad.length === 0} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-medium outline-none focus:border-gray-500 disabled:bg-gray-50">
                            {opcionesLocalidad.length === 0 ? <option>Ingresá un CP válido...</option> : opcionesLocalidad.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                          </select>
                        </div>
                        <div className="col-span-12 sm:col-span-6">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Calle *</label>
                          <input type="text" value={nuevaCalle} onChange={e => setNuevaCalle(e.target.value)} maxLength={100} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-gray-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura *</label>
                          <input type="text" value={nuevaAltura} onChange={e => setNuevaAltura(e.target.value)} maxLength={10} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-gray-500" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Piso</label>
                          <input type="text" value={nuevoPiso} onChange={e => setNuevoPiso(e.target.value)} maxLength={5} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Depto</label>
                          <input type="text" value={nuevoDpto} onChange={e => setNuevoDpto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none" />
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button 
                          onClick={enviarActualizacionPreenvio}
                          disabled={cargandoGlobal || !nuevoCP || !nuevaCalle || !nuevaAltura || !nuevaLocalidad}
                          className="flex items-center gap-2 px-6 py-3 bg-gray-800 text-white font-bold rounded-lg hover:bg-gray-900 transition-colors text-sm disabled:opacity-50"
                        >
                          {cargandoGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit className="w-4 h-4" />}
                          Actualizar Datos
                        </button>
                      </div>
                    </div>
                  )}

                </>
              ) : (
                <p className="text-center text-red-500 py-4">No se pudo cargar la información.</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}