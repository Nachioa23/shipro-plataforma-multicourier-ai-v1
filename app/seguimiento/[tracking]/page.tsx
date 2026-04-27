"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Package, Truck, CheckCircle2, Clock, MapPin, Loader2, ShieldAlert } from 'lucide-react';

export default function SeguimientoPublico() {
  const params = useParams();
  const trackingNumber = params.tracking as string;

  const [cargando, setCargando] = useState(true);
  const [datos, setDatos] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const buscarTracking = async () => {
      if (!trackingNumber) return;
      try {
        // Reutilizamos tu API de rastreo para buscar la info de este paquete
        const res = await fetch('/api/envios/rastreo-manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracking: trackingNumber, forzarActualizacion: false })
        });
        
        const data = await res.json();
        
        if (res.ok && data.envio) {
          setDatos(data);
        } else {
          setError("No se encontró información para este número de seguimiento.");
        }
      } catch (err) {
        setError("Error de conexión al buscar el envío.");
      } finally {
        setCargando(false);
      }
    };

    buscarTracking();
  }, [trackingNumber]);

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#233b6b] mb-4" />
        <p className="text-[#233b6b] font-bold">Buscando tu paquete...</p>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center max-w-md w-full border border-gray-200">
          <ShieldAlert className="w-16 h-16 text-red-100 mx-auto mb-4" />
          <h2 className="text-xl font-black text-gray-800 mb-2">Envío no encontrado</h2>
          <p className="text-gray-500 text-sm mb-6">{error || "Verificá que el número ingresado sea correcto."}</p>
          <p className="text-xs font-bold text-gray-400">TRACKING: {trackingNumber}</p>
        </div>
      </div>
    );
  }

  const envio = datos.envio;
  const historial = datos.historial || [];
  const estadoActual = envio.estadoActual;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      {/* BRANDING SHIPRO FLOW */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl tracking-tight">
          <span className="font-black text-[#233b6b]">SHIPRO</span> <span className="font-light text-[#4d85cc]">FLOW</span>
        </h1>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Portal de Seguimiento</p>
      </div>

      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        
        {/* CABECERA DEL ENVÍO */}
        <div className="bg-[#233b6b] p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 opacity-10 translate-x-1/4 -translate-y-1/4">
            <Package className="w-48 h-48" />
          </div>
          
          <div className="relative z-10">
            <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-1">Código de Seguimiento</p>
            <h2 className="text-3xl font-black mb-4">{envio.trackingNumber}</h2>
            
            <div className="inline-flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/20">
              <Truck className="w-4 h-4 text-blue-200" />
              <span className="text-sm font-bold capitalize">Operador: {envio.courier}</span>
            </div>
          </div>
        </div>

        <div className="p-8">
          {/* INFO DESTINO */}
          <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl mb-8 border border-gray-100">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <MapPin className="w-5 h-5 text-[#4d85cc]" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">Destino de entrega</p>
              <p className="font-bold text-gray-800 text-sm mt-0.5">{envio.destinatario?.direccionStr || "Domicilio del comprador"}</p>
              <p className="text-xs text-gray-500">{envio.destinatario?.localidad} (CP: {envio.destinatario?.cp})</p>
            </div>
          </div>

          {/* ESTADO ACTUAL DESTACADO */}
          <div className="text-center mb-10 pb-10 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-2">Estado Actual</h3>
            <p className={`text-2xl font-black ${estadoActual === 'ENTREGADO' ? 'text-green-600' : 'text-[#233b6b]'}`}>
              {estadoActual}
            </p>
          </div>

          {/* LÍNEA DE TIEMPO (HISTORIAL) */}
          <h3 className="text-sm font-bold text-gray-800 mb-6 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Movimientos del paquete
          </h3>
          
          {historial.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">Aún no hay movimientos registrados en el correo.</p>
          ) : (
            <div className="relative pl-4 border-l-2 border-gray-100 space-y-8 ml-2">
              {historial.map((evento: any, index: number) => {
                const esUltimo = index === 0;
                return (
                  <div key={evento.id} className="relative">
                    <div className={`absolute -left-[21px] top-1 w-4 h-4 rounded-full border-2 border-white ${esUltimo ? 'bg-[#4d85cc] ring-4 ring-blue-50' : 'bg-gray-300'}`}></div>
                    <div className="pl-6">
                      <p className={`text-sm font-black ${esUltimo ? 'text-[#233b6b]' : 'text-gray-600'}`}>{evento.estado}</p>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{evento.observacion}</p>
                      <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase">
                        {new Date(evento.fecha).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}