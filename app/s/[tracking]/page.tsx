"use client";

import { useState, useEffect, Suspense, use } from "react";
import { Package, Truck, MapPin, CheckCircle2, AlertCircle, Loader2, AlertTriangle, ArrowRight, Star } from 'lucide-react';
import Link from "next/link";
import { useSearchParams, useRouter } from 'next/navigation';

// =========================================================================
// SUB-COMPONENTE NPS (MATRIZ DE FRICCIÓN COMPLETA)
// =========================================================================
function ModuloNPS({ tracking, estaEntregado }: { tracking: string, estaEntregado: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const parametroNps = searchParams.get('nps');
  const scoreUrl = searchParams.get('score');
  
  // Si viene del mail con ?nps=success, arrancamos el proceso avanzado
  const vieneDeVotarNPS = parametroNps === 'success';

  // ESTADOS DEL FORMULARIO
  const [paso, setPaso] = useState(vieneDeVotarNPS ? 2 : 1);
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [comentarioEnviado, setComentarioEnviado] = useState(false);

  // RESPUESTAS
  const [scoreCentral, setScoreCentral] = useState<number | null>(scoreUrl ? parseInt(scoreUrl) : null);
  const [comentario, setComentario] = useState("");
  const [experienciaEntrega, setExperienciaEntrega] = useState("");
  const [satisfaccionProducto, setSatisfaccionProducto] = useState<number | null>(null);
  const [probabilidadRecompra, setProbabilidadRecompra] = useState<number | null>(null);
  const [sugerenciaMejora, setSugerenciaMejora] = useState("");

  if (!estaEntregado) return null;

  // Acción cuando clica un número en la grilla inicial (si no vino desde el mail)
  const handleVotoInicial = async (nota: number) => {
    setScoreCentral(nota);
    // Acá no lo mandamos a la API vieja, simplemente lo guardamos en memoria y pasamos al Paso 2
    // La redirección vieja del mail sigue funcionando y llamará a la API vieja, que luego lo trae a este Paso 2.
    setPaso(2);
  };

  const enviarFormularioCompleto = async () => {
    if (scoreCentral === null) return;
    setEnviandoComentario(true);
    try {
      // 1. Si NO vino desde el mail (o sea, votó recién acá en la pantalla), primero disparamos el voto base
      if (!vieneDeVotarNPS) {
        await fetch(`/api/nps?tracking=${tracking}&score=${scoreCentral}`, { method: 'GET' });
      }

      // 2. Disparamos la encuesta detallada a la nueva API
      const res = await fetch(`/api/nps/comentario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tracking, 
          comentario,
          experienciaEntrega,
          satisfaccionProducto,
          probabilidadRecompra,
          sugerenciaMejora
        })
      });
      
      if (res.ok) setComentarioEnviado(true);
    } catch (err) {
      console.error("Error NPS:", err);
    } finally {
      setEnviandoComentario(false);
    }
  };

  if (comentarioEnviado) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-3xl p-6 shadow-sm flex flex-col items-center text-center animate-in fade-in duration-500">
        <div className="bg-green-100 p-4 rounded-full mb-4"><CheckCircle2 className="w-8 h-8 text-green-600" /></div>
        <h4 className="text-xl font-black text-green-900 mb-2">¡Mil gracias por tu tiempo!</h4>
        <p className="text-sm text-green-700 font-medium">Tus respuestas nos ayudan a mejorar el servicio todos los días.</p>
      </div>
    );
  }

  // PANTALLA 1: La grilla inicial (Por si entró al tracking directo sin tocar el mail)
  if (paso === 1) {
    return (
      <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm animate-in fade-in duration-300">
        <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest mb-4 text-center leading-relaxed">
          Basado en tu experiencia de compra,<br/>¿qué probabilidad hay de que nos recomiendes?
        </h3>
        <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
            <button 
              key={score}
              onClick={() => handleVotoInicial(score)}
              className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl font-bold text-sm sm:text-base transition-all
                ${score <= 6 ? 'bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100' : ''}
                ${score >= 7 && score <= 8 ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-500 hover:text-white border border-yellow-100' : ''}
                ${score >= 9 ? 'bg-green-50 text-green-600 hover:bg-green-500 hover:text-white border border-green-100' : ''}
              `}
            >
              {score}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase mt-4 px-2">
          <span>0 = Nada probable</span>
          <span>10 = Muy probable</span>
        </div>
      </div>
    );
  }

  // PANTALLA 2: El Formulario Avanzado
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-6 md:p-8 shadow-sm animate-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-6">
        <h3 className="text-xl font-black text-gray-800 mb-1">Cuentanos un poco más</h3>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Encuesta de Calidad (1 minuto)</p>
      </div>

      <div className="space-y-6">
        
        {/* Q2: Motivo */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">¿Cuál es el motivo principal de la nota ({scoreCentral}) que nos pusiste?</label>
          <textarea 
            value={comentario} onChange={(e) => setComentario(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 min-h-[80px]"
            placeholder="Tu respuesta..."
          />
        </div>

        {/* Q3: Entrega */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <label className="block text-sm font-bold text-gray-700 mb-3">¿Cómo evaluás el proceso de envío?</label>
          <div className="space-y-2">
            {["Llegó a tiempo y en perfecto estado", "Llegó a tiempo, pero el paquete estaba dañado", "Llegó más tarde de lo prometido", "Tuve problemas graves con la entrega"].map(opcion => (
              <label key={opcion} className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${experienciaEntrega === opcion ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white group-hover:border-blue-400'}`}>
                   {experienciaEntrega === opcion && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                </div>
                <input type="radio" name="entrega" value={opcion} className="hidden" onChange={(e) => setExperienciaEntrega(e.target.value)} />
                <span className="text-sm font-medium text-gray-600">{opcion}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Q4: Producto */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-3 text-center">¿Qué tan satisfecho estás con el producto?</label>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={() => setSatisfaccionProducto(star)} className="group transition-transform hover:scale-110">
                <Star className={`w-8 h-8 ${satisfaccionProducto && star <= satisfaccionProducto ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-100 text-gray-200 group-hover:fill-yellow-200 group-hover:text-yellow-200'}`} />
              </button>
            ))}
          </div>
        </div>

        {/* Q5: Recompra */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
           <label className="block text-sm font-bold text-gray-700 mb-3 text-center">¿Volverías a comprarnos en el futuro?</label>
           <div className="flex justify-between items-center bg-white border border-gray-200 rounded-xl p-1">
             {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
               <button key={n} onClick={() => setProbabilidadRecompra(n)} className={`w-6 h-8 sm:w-8 sm:h-10 rounded-lg text-xs font-bold transition-all ${probabilidadRecompra === n ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}>
                 {n}
               </button>
             ))}
           </div>
        </div>

        {/* Q6: Mejora */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">¿En qué podríamos mejorar?</label>
          <input 
            type="text" 
            value={sugerenciaMejora} onChange={(e) => setSugerenciaMejora(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500"
            placeholder="Opcional..."
          />
        </div>

        <button 
          onClick={enviarFormularioCompleto}
          disabled={enviandoComentario || !comentario || !experienciaEntrega || !satisfaccionProducto || probabilidadRecompra === null}
          className="w-full bg-[#233b6b] text-white px-6 py-4 rounded-xl font-black text-lg shadow-lg hover:bg-blue-900 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none transition-all flex items-center justify-center"
        >
          {enviandoComentario ? <Loader2 className="w-6 h-6 animate-spin" /> : "Enviar Respuestas"}
        </button>

      </div>
    </div>
  );
}

// =========================================================================
// COMPONENTE PRINCIPAL DE LA PÁGINA (Sin cambios importantes, solo estéticos)
// =========================================================================
export default function TrackingPublico({ params }: { params: Promise<{ tracking: string }> }) {
  const brandColor = '#233b6b';
  const { tracking } = use(params);

  const [envio, setEnvio] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchEnvio = async () => {
      try {
        const res = await fetch(`/api/envios/buscar?tracking=${tracking}`);
        if (!res.ok) throw new Error("404");
        const data = await res.json();
        setEnvio(data);
      } catch (err) {
        setError(true);
      } finally {
        setCargando(false);
      }
    };
    fetchEnvio();
  }, [tracking]);

  if (cargando) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-[#233b6b]" />
        <p className="font-bold text-gray-400 text-sm">Consultando estado oficial...</p>
      </div>
    );
  }

  if (error || !envio) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-red-50 p-4 rounded-full mb-4"><AlertCircle className="w-12 h-12 text-red-500" /></div>
        <h2 className="text-2xl font-black text-gray-800">Envío no encontrado</h2>
        <p className="text-gray-500 mt-2 text-sm">No pudimos localizar el seguimiento <strong>{tracking}</strong>.</p>
        <Link href="/" className="mt-8 px-8 py-3 bg-[#233b6b] text-white font-bold rounded-xl shadow-lg">Ir a la web de Shipro</Link>
      </div>
    );
  }

  const estadoLimpio = (envio.estadoActual || "").toUpperCase();
  const estaEntregado = estadoLimpio === "ENTREGADO";
  const estaEnCamino = ["EN_TRANSITO", "RECOLECTADO", "EN_SUCURSAL", "EN_REPARTO", "DESPACHADO"].includes(estadoLimpio);
  const esRetenido = estadoLimpio === "RETENIDO"; 

  const formatearFecha = (fechaStr: string) => {
    if (!fechaStr) return '';
    const d = new Date(fechaStr);
    const fecha = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
    const horas = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${fecha} - ${horas}:${mins} horas`;
  };

  const eventos = envio.eventos || [];
  
  const eventoEntregado = eventos.find((e: any) => e.estado.toUpperCase() === 'ENTREGADO');
  const fechaEntregado = eventoEntregado ? eventoEntregado.fecha : envio.fechaEntrega;

  const eventoEnCamino = [...eventos].reverse().find((e: any) => 
    ["EN_TRANSITO", "RECOLECTADO", "EN_SUCURSAL", "EN_REPARTO", "DESPACHADO"].includes(e.estado.toUpperCase())
  );
  const fechaEnCamino = eventoEnCamino ? eventoEnCamino.fecha : envio.fechaRecoleccion;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="h-16 bg-white border-b border-gray-200 flex justify-center items-center sticky top-0 z-50 shadow-sm">
        <h1 className="text-2xl font-black tracking-tighter" style={{ color: brandColor }}>
          SHIPRO<span className="text-blue-500">.</span>
        </h1>
      </header>

      <div className="flex-1 flex flex-col items-center py-8 px-4">
        <main className="w-full max-w-lg space-y-5">
          
          <Suspense fallback={<div className="h-20 bg-gray-100 rounded-3xl animate-pulse"></div>}>
            <ModuloNPS tracking={tracking} estaEntregado={estaEntregado} />
          </Suspense>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
            {estaEntregado ? (
              <div className="bg-green-500 p-8 text-center text-white">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/30"><CheckCircle2 className="w-12 h-12 text-white" /></div>
                <h2 className="text-2xl font-black tracking-tight mb-1">¡Paquete Entregado!</h2>
                <p className="text-green-50 text-sm font-medium opacity-90">El correo completó la entrega con éxito.</p>
              </div>
            ) : esRetenido ? (
              <div className="bg-red-600 p-8 text-center text-white">
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/20"><AlertTriangle className="w-10 h-10 text-red-100" /></div>
                <h2 className="text-2xl font-black tracking-tight mb-1">Envío Retenido</h2>
                <p className="text-red-100 text-sm font-medium opacity-90">Se requiere tu atención para liberar el paquete.</p>
              </div>
            ) : (
              <div className="bg-[#233b6b] p-8 text-center text-white">
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/20"><Truck className="w-10 h-10 text-blue-300" /></div>
                <h2 className="text-2xl font-black tracking-tight mb-1 capitalize">{envio.estadoActual.toLowerCase().replace(/_/g, ' ')}</h2>
                <p className="text-blue-200 text-sm font-medium opacity-80">Estamos monitoreando tu envío.</p>
              </div>
            )}
            
            <div className="p-6 bg-gray-50/50 flex justify-between items-center border-t border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-lg border border-gray-200"><Package className="w-4 h-4 text-gray-400" /></div>
                <div>
                   <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tracking Oficial</p>
                   <p className="font-bold text-gray-800 text-sm">{envio.trackingNumber}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-8 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Hoja de Ruta
            </h3>

            {esRetenido ? (
              <div className="bg-red-50 rounded-2xl p-6 border border-red-100 text-center animate-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-lg font-black text-red-800 mb-2">Problema con la Dirección</h3>
                <p className="text-sm text-red-700/80 font-medium mb-6">
                  El sistema de validación rechazó la dirección de entrega que nos brindaste. Necesitamos que la corrijas para poder entregarle el paquete al correo.
                </p>
                <Link 
                  href={`/corregir/${envio.trackingNumber}`} 
                  className="flex items-center justify-center gap-2 w-full bg-red-600 text-white font-bold py-3.5 px-6 rounded-xl shadow-md hover:bg-red-700 transition-colors"
                >
                  Corregir Dirección Aquí <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <div className="space-y-0">
                <div className={`flex gap-5 ${!estaEntregado ? 'opacity-30 grayscale' : ''}`}>
                  <div className="flex flex-col items-center">
                    <div className={`w-5 h-5 rounded-full border-4 border-white shadow-sm z-10 shrink-0 ${estaEntregado ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                    <div className="w-0.5 h-full bg-gray-100 -my-1"></div>
                  </div>
                  <div className="pb-8 pt-0.5">
                    <p className={`text-sm font-black ${estaEntregado ? 'text-green-600' : 'text-gray-500'}`}>Entregado</p>
                    {estaEntregado && fechaEntregado && (
                      <p className="text-xs font-bold text-green-700 mt-1">{formatearFecha(fechaEntregado)}</p>
                    )}
                  </div>
                </div>

                <div className={`flex gap-5 ${(!estaEnCamino && !estaEntregado) ? 'opacity-30 grayscale' : ''}`}>
                  <div className="flex flex-col items-center">
                    <div className={`w-5 h-5 rounded-full border-4 border-white shadow-sm z-10 shrink-0 ${estaEnCamino || estaEntregado ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <div className="w-0.5 h-full bg-gray-100 -my-1"></div>
                  </div>
                  <div className="pb-8 pt-0.5">
                    <p className="text-sm font-black text-gray-800">En tránsito</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">El paquete está en manos del correo.</p>
                    {(estaEnCamino || estaEntregado) && fechaEnCamino && (
                      <p className="text-xs font-bold text-blue-600 mt-1">{formatearFecha(fechaEnCamino)}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-5">
                  <div className="flex flex-col items-center">
                    <div className="w-5 h-5 rounded-full border-4 border-white bg-blue-600 shadow-sm z-10 shrink-0"></div>
                  </div>
                  <div className="pb-2 pt-0.5">
                    <p className="text-sm font-black text-gray-800">Etiqueta Generada</p>
                    <p className="text-[11px] font-bold text-blue-600 mt-1">
                      {envio.fechaImpresion ? formatearFecha(envio.fechaImpresion) : 'Recientemente'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8 space-y-5">
             <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">Tienda</span>
                <span className="font-black text-gray-800">{envio.empresa?.nombre || "Vendedor Shipro"}</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">Destinatario</span>
                <span className="font-bold text-gray-700">{envio.destino?.nombre || "Cliente"}</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">Correo</span>
                <span className="font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-xs">{envio.courier?.nombre}</span>
             </div>
          </div>
        </main>

        <footer className="mt-12 text-center">
          <p className="text-[10px] font-bold text-gray-300 uppercase tracking-[0.2em] mb-2">Powered by</p>
          <span className="font-black text-gray-200 text-2xl tracking-tighter">SHIPRO<span className="text-blue-400">.</span></span>
        </footer>
      </div>
    </div>
  );
}