"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Calculator, MapPin, Package, Loader2, Truck, Store, X, Building2 } from 'lucide-react';

interface CotizadorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CotizadorModal({ isOpen, onClose }: CotizadorModalProps) {
  const { data: session } = useSession();
  const brandColor = '#233b6b';
  const rol = session?.user?.rol || '';
  const esShipro = rol === 'admin_shipro' || rol === 'operador_shipro';

  // HARDCODED: CP de origen del depósito.
  // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
  // Ver DEUDAS.md
  const [cpOrigen, setCpOrigen] = useState("1050");
  const [cpDestino, setCpDestino] = useState("");
  const [peso, setPeso] = useState("1");
  const [largo, setLargo] = useState("10");
  const [ancho, setAncho] = useState("10");
  const [alto, setAlto] = useState("10");

  const [cargando, setCargando] = useState(false);
  const [resultados, setResultados] = useState<{ domicilio: any[], sucursal: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dropdown shipro: empresa elegida + lista de clientes activos
  const [empresaSeleccionadaId, setEmpresaSeleccionadaId] = useState<string>("");
  const [listaClientes, setListaClientes] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen || !esShipro) return;
    fetch('/api/clientes')
      .then(r => r.json())
      .then(data => setListaClientes(Array.isArray(data) ? data.filter((c: any) => c.activo) : []))
      .catch(() => setListaClientes([]));
  }, [isOpen, esShipro]);

  if (!isOpen) return null;

  const consultarTarifas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpOrigen || !cpDestino || !peso || !largo || !ancho || !alto) {
      setError("Por favor, completá todos los campos.");
      return;
    }
    if (esShipro && !empresaSeleccionadaId) {
      setError("Seleccioná una empresa antes de cotizar.");
      return;
    }

    setCargando(true);
    setError(null);
    setResultados(null);

    try {
      const bodyRequest: any = {
        cpOrigen,
        cpDestino,
        paquetes: [{
          pesoKg: parseFloat(peso), largoCm: parseFloat(largo), anchoCm: parseFloat(ancho), altoCm: parseFloat(alto),
          valorDeclarado: 0, requiereSeguro: false
        }]
      };
      if (esShipro && empresaSeleccionadaId) {
        bodyRequest.filtroEmpresa = empresaSeleccionadaId;
      }

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
        const errData = await res.json().catch(() => ({}));
        if (errData?.code === 'EMPRESA_REQUERIDA') {
          setError(errData.error || "Seleccioná una empresa para cotizar.");
        } else {
          setError("Error al consultar las tarifas.");
        }
      }
    } catch (err) {
      setError("Error de conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      <div className="relative bg-gray-50 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-800">Cotizador Rápido</h2>
              <p className="text-xs text-gray-500 font-medium">Consulta de tarifas en tiempo real</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

          <div className="lg:col-span-5">
            <form onSubmit={consultarTarifas} className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-5">

              {esShipro && (
                <div>
                  <label className="block text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Cotizar para empresa:
                  </label>
                  <select
                    value={empresaSeleccionadaId}
                    onChange={(e) => setEmpresaSeleccionadaId(e.target.value)}
                    className="w-full border border-indigo-200 bg-indigo-50 text-indigo-900 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="" disabled>Seleccionar empresa…</option>
                    {listaClientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 text-red-700 text-xs font-bold rounded-lg border border-red-200">
                  {error}
                </div>
              )}

              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Códigos Postales</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Origen</label>
                    <input type="text" value={cpOrigen} onChange={e => setCpOrigen(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm font-bold outline-none focus:border-[#233b6b]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Destino *</label>
                    <input type="text" value={cpDestino} onChange={e => setCpDestino(e.target.value)} className="w-full border-2 border-blue-100 bg-blue-50/30 rounded-lg p-2 text-sm font-black text-blue-800 outline-none focus:border-[#233b6b]" autoFocus />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Dimensiones</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-3">
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Peso Físico (Kg) *</label>
                    <input type="number" step="0.1" value={peso} onChange={e => setPeso(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm font-bold outline-none focus:border-[#233b6b]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Largo *</label>
                    <input type="number" value={largo} onChange={e => setLargo(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-[#233b6b]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Ancho *</label>
                    <input type="number" value={ancho} onChange={e => setAncho(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-[#233b6b]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Alto *</label>
                    <input type="number" value={alto} onChange={e => setAlto(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-[#233b6b]" />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={cargando || (esShipro && !empresaSeleccionadaId)}
                className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold rounded-lg shadow-md hover:opacity-90 transition-all text-sm disabled:opacity-50"
                style={{ backgroundColor: brandColor }}
              >
                {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                {cargando ? "Cotizando..." : "Calcular Tarifas"}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7">
            {cargando ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center bg-white rounded-xl border border-gray-200">
                 <Loader2 className="w-8 h-8 text-[#233b6b] animate-spin mb-3" />
                 <p className="text-gray-500 font-bold text-sm">Consultando matriz tarifaria...</p>
              </div>
            ) : !resultados ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center bg-white/50 rounded-xl border border-dashed border-gray-300">
                 <Calculator className="w-10 h-10 text-gray-300 mb-3" />
                 <p className="text-gray-400 font-bold text-sm">
                   {esShipro && !empresaSeleccionadaId ? "Seleccioná una empresa para cotizar" : "Ingresá los datos para ver las tarifas"}
                 </p>
              </div>
            ) : (
              <div className="bg-white p-5 rounded-xl border border-gray-200 space-y-6 min-h-[300px]">

                <div>
                  <h4 className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-3"><Truck className="w-3.5 h-3.5" /> Entrega a Domicilio</h4>
                  {resultados.domicilio.length === 0 ? (
                    <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-lg">No hay opciones disponibles.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {resultados.domicilio.map((tarifa) => (
                        <div key={tarifa.id} className="border border-gray-200 rounded-lg p-3">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-black text-gray-800 text-xs">{tarifa.courier}</span>
                            <span className="text-[9px] font-bold text-white bg-[#233b6b] px-1.5 py-0.5 rounded">{tarifa.slaHs}hs</span>
                          </div>
                          <p className="text-lg font-black text-[#233b6b] mt-2">$ {new Intl.NumberFormat('es-AR').format(tarifa.precioFinal)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-3"><Store className="w-3.5 h-3.5" /> Retiro en Sucursal</h4>
                  {resultados.sucursal.length === 0 ? (
                    <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-lg">No hay opciones disponibles.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {resultados.sucursal.map((tarifa) => (
                        <div key={tarifa.id} className="border border-blue-100 rounded-lg p-3 bg-blue-50/20">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-black text-gray-800 text-xs">{tarifa.courier}</span>
                            <span className="text-[9px] font-bold text-white bg-blue-500 px-1.5 py-0.5 rounded">{tarifa.slaHs}hs</span>
                          </div>
                          <p className="text-lg font-black text-blue-700 mt-2">$ {new Intl.NumberFormat('es-AR').format(tarifa.precioFinal)}</p>
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
    </div>
  );
}
