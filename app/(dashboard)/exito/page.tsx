"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Printer, Download, Copy, Plus, Home } from 'lucide-react';

function ExitoContenido() {
  const brandColor = '#233b6b';
  
  // Leemos el tracking real que acaba de crear la base de datos
  const searchParams = useSearchParams();
  const trackingReal = searchParams.get("tracking") || "SHP-000000";

  return (
    <div className="flex flex-col h-screen bg-gray-50 items-center justify-center p-8 relative overflow-hidden w-full">
      <div className="absolute top-0 left-0 w-full h-96 -z-10" style={{ backgroundColor: brandColor, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 75%)' }}></div>

      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl border border-gray-100 p-10 text-center relative z-10">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border-4 border-white ring-4 ring-green-50">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>

        <h1 className="text-3xl font-extrabold text-gray-800 mb-2">¡Envío Generado con Éxito!</h1>
        <p className="text-gray-500 font-medium mb-8">La etiqueta ya está lista para imprimir y el Courier ha sido notificado.</p>

        {/* Tarjeta del Tracking Real */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 mb-8 text-left flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Código de Seguimiento Oficial</p>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-black text-[#233b6b] tracking-tight">{trackingReal}</p>
              <button onClick={() => navigator.clipboard.writeText(trackingReal)} className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-400 hover:text-[#233b6b] hover:border-blue-200 transition-colors shadow-sm" title="Copiar Tracking">
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-500 font-medium mt-2">Ya podés ir a imprimirla o seguir operando.</p>
          </div>
          
          <div className="hidden sm:flex gap-1 h-12 opacity-40">
            <div className="w-1 bg-gray-800 h-full"></div><div className="w-2 bg-gray-800 h-full"></div><div className="w-0.5 bg-gray-800 h-full"></div><div className="w-1.5 bg-gray-800 h-full"></div><div className="w-1 bg-gray-800 h-full"></div><div className="w-3 bg-gray-800 h-full"></div><div className="w-1 bg-gray-800 h-full"></div><div className="w-2 bg-gray-800 h-full"></div><div className="w-0.5 bg-gray-800 h-full"></div><div className="w-1.5 bg-gray-800 h-full"></div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Link href="/etiquetas" className="flex items-center justify-center gap-2 px-8 py-4 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-opacity text-base flex-1 sm:flex-none" style={{ backgroundColor: brandColor }}>
            <Printer className="w-5 h-5" />
            Ir a Imprimir
          </Link>
          <button className="flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-colors text-base flex-1 sm:flex-none">
            <Download className="w-5 h-5 text-gray-400" />
            Descargar PDF
          </button>
        </div>

        <div className="border-t border-gray-100 pt-8 flex items-center justify-center gap-6">
          <Link href="/nuevo-envio" className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors">
            <Plus className="w-4 h-4" /> Crear otro envío
          </Link>
          <span className="w-1 h-1 rounded-full bg-gray-300"></span>
          <Link href="/" className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors">
            <Home className="w-4 h-4" /> Volver a Bandeja
          </Link>
        </div>

      </div>
    </div>
  );
}

export default function ExitoEnvio() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-500 font-bold">Cargando...</div>}>
      <ExitoContenido />
    </Suspense>
  );
}