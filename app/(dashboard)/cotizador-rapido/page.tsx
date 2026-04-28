"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Calculator, MapPin, Package, Loader2, Truck, Store, ArrowRightCircle } from 'lucide-react';

export default function CotizadorRapido() {
  const { data: session } = useSession();
  const brandColor = '#233b6b';

  // Estados del Formulario
  // HARDCODED: CP de origen del depósito.
  // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
  // Ver DEUDAS.md
  const [cpOrigen, setCpOrigen] = useState("1050");
  const [cpDestino, setCpDestino] = useState("");
  const [peso, setPeso] = useState("1");
  const [largo, setLargo] = useState("10");
  const [ancho, setAncho] = useState("10");
  const [alto, setAlto] = useState("10");

  // Estados de Resultados
  const [cargando, setCargando] = useState(false);
  const [resultados, setResultados] = useState<{ domicilio: any[], sucursal: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consultarTarifas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpOrigen || !cpDestino || !peso || !largo || !ancho || !alto) {
      setError("Por favor, completá todos los campos.");
      return;
    }

    setCargando(true);
    setError(null);
    setResultados(null);

    try {
      const bodyRequest = {
        empresaId: session?.user?.empresaId || 1, 
        cpOrigen, 
        cpDestino, 
        paquetes: [{
          pesoKg: parseFloat(peso), largoCm: parseFloat(largo), anchoCm: parseFloat(ancho), altoCm: parseFloat(alto),
          valorDeclarado: 0, requiereSeguro: false
        }]
      };

      const res = await fetch("/api/cotizar", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyRequest)
      });

      if (res.ok) {
        const data = await res.json();
        setResultados({
          domicilio: data.domicilio || [],
          sucursal: data.sucursal || []
        });
      } else {
        setError("Error al consultar las tarifas con el Courier.");
      }
    } catch (err) {
      setError("Error de conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  };

  const limpiarConsulta = () => {
    setCpDestino("");
    setPeso("1");
    setLargo("10");
    setAncho("10");
    setAlto("10");
    setResultados(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Cotizador Rápido</h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Consultá tarifas en tiempo real sin generar un envío.
            </p>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* PANEL IZQUIERDO: FORMULARIO */}
        <div className="lg:col-span-4 space-y-6">
          <form onSubmit={consultarTarifas} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-6">
            
            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-sm font-bold rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><MapPin className="w-4 h-4" /> Códigos Postales</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CP Origen</label>
                  <input type="text" value={cpOrigen} onChange={e => setCpOrigen(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold outline-none focus:border-[#233b6b]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CP Destino *</label>
                  <input type="text" value={cpDestino} onChange={e => setCpDestino(e.target.value)} placeholder="Ej: 5000" className="w-full border-2 border-blue-100 bg-blue-50/30 rounded-lg p-2.5 text-sm font-black text-blue-800 outline-none focus:border-[#233b6b]" autoFocus />
                </div>
              </div>
            </div>

            <hr className="border-gray-100" />

            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Package className="w-4 h-4" /> Dimensiones del Bulto</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Peso Físico (Kg) *</label>
                  <input type="number" step="0.1" value={peso} onChange={e => setPeso(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold outline-none focus:border-[#233b6b]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Largo (cm) *</label>
                  <input type="number" value={largo} onChange={e => setLargo(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Ancho (cm) *</label>
                  <input type="number" value={ancho} onChange={e => setAncho(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Alto (cm) *</label>
                  <input type="number" value={alto} onChange={e => setAlto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]" />
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={cargando}
              className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-all text-sm disabled:opacity-70 mt-4" 
              style={{ backgroundColor: brandColor }}
            >
              {cargando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Calculator className="w-5 h-5" />}
              {cargando ? "Cotizando en Andreani..." : "Calcular Tarifas"}
            </button>
          </form>
        </div>

        {/* PANEL DERECHO: RESULTADOS */}
        <div className="lg:col-span-8">
          {cargando ? (
             <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-200 shadow-sm">
                <Loader2 className="w-12 h-12 text-[#233b6b] animate-spin mb-4" />
                <p className="text-gray-500 font-bold">Consultando matriz tarifaria...</p>
             </div>
          ) : !resultados ? (
             <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-white/50 rounded-2xl border border-dashed border-gray-300">
                <ArrowRightCircle className="w-16 h-16 text-gray-200 mb-4" />
                <p className="text-gray-400 font-bold text-lg">Ingresá los datos para ver las opciones</p>
             </div>
          ) : (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-8">
              <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                <h3 className="text-xl font-black text-gray-800">Resultados de la Cotización</h3>
                <button onClick={limpiarConsulta} className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors">Nueva Consulta</button>
              </div>

              {/* TARJETAS DOMICILIO */}
              <div>
                <h4 className="text-sm font-bold text-gray-500 flex items-center gap-2 mb-4"><Truck className="w-4 h-4" /> Entrega a Domicilio</h4>
                {resultados.domicilio.length === 0 ? (
                  <p className="text-sm text-gray-400 italic bg-gray-50 p-4 rounded-lg">No hay opciones a domicilio disponibles.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {resultados.domicilio.map((tarifa) => (
                      <div key={tarifa.id} className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-black text-gray-800 text-sm tracking-wider">{tarifa.courier}</span>
                          <span className="text-[10px] font-bold text-white bg-[#233b6b] px-2 py-0.5 rounded uppercase">{tarifa.slaHs}hs</span>
                        </div>
                        <p className="text-2xl font-black text-[#233b6b] mt-4">$ {new Intl.NumberFormat('es-AR').format(tarifa.precioFinal)}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Final con IVA</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* TARJETAS SUCURSAL */}
              <div>
                <h4 className="text-sm font-bold text-gray-500 flex items-center gap-2 mb-4"><Store className="w-4 h-4" /> Retiro en Sucursal</h4>
                {resultados.sucursal.length === 0 ? (
                  <p className="text-sm text-gray-400 italic bg-gray-50 p-4 rounded-lg">No hay opciones a sucursal disponibles.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {resultados.sucursal.map((tarifa) => (
                      <div key={tarifa.id} className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-blue-50/10">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-black text-gray-800 text-sm tracking-wider">{tarifa.courier}</span>
                          <span className="text-[10px] font-bold text-white bg-blue-500 px-2 py-0.5 rounded uppercase">{tarifa.slaHs}hs</span>
                        </div>
                        <p className="text-2xl font-black text-blue-700 mt-4">$ {new Intl.NumberFormat('es-AR').format(tarifa.precioFinal)}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Final con IVA</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}