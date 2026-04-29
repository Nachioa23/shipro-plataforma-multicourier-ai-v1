"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, MapPin, CheckCircle2, Truck, Clock, Loader2, Store, Building2 } from 'lucide-react';

function CotizadorContenido() {
  const brandColor = '#233b6b';
  const router = useRouter();
  const { data: session } = useSession();
  const rol = session?.user?.rol || '';
  const esShipro = rol === 'admin_shipro' || rol === 'operador_shipro';

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const [tabActivo, setTabActivo] = useState<'domicilio' | 'sucursal'>('domicilio');

  const [tarifasDomicilio, setTarifasDomicilio] = useState<any[]>([]);
  const [tarifasSucursal, setTarifasSucursal] = useState<any[]>([]);
  const [cotizando, setCotizando] = useState(false);

  const [sucursales, setSucursales] = useState<any[]>([]);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [sucursalElegidaId, setSucursalElegidaId] = useState<string>("");

  const searchParams = useSearchParams();
  const cpOrigen = searchParams.get("origen") || "1050";
  const cpDestino = searchParams.get("destino") || "0000";
  const localidadDestino = searchParams.get("localidad") || "Destino";
  const peso = searchParams.get("peso") || "1";
  const largo = searchParams.get("largo") || "10";
  const ancho = searchParams.get("ancho") || "10";
  const alto = searchParams.get("alto") || "10";

  const nombreDestino = searchParams.get("nombre") || "Consumidor Final";
  const calleDestino = searchParams.get("calle") || "";
  const alturaDestino = searchParams.get("altura") || "";
  const dniDestino = searchParams.get("dni") || "";
  const emailDestino = searchParams.get("email") || "";
  const telefonoDestino = searchParams.get("telefono") || "";

  // Dropdown shipro: empresa elegida (puede venir desde URL si vino de /nuevo-envio) + lista de clientes activos
  const filtroEmpresaUrl = searchParams.get("filtroEmpresa") || "";
  const [empresaSeleccionadaId, setEmpresaSeleccionadaId] = useState<string>(filtroEmpresaUrl);
  const [listaClientes, setListaClientes] = useState<any[]>([]);

  useEffect(() => {
    if (!esShipro) return;
    fetch('/api/clientes')
      .then(r => r.json())
      .then(data => setListaClientes(Array.isArray(data) ? data.filter((c: any) => c.activo) : []))
      .catch(() => setListaClientes([]));
  }, [esShipro]);

  useEffect(() => {
    // Gate: si shipro y no hay empresa elegida, no cotizar todavía.
    if (esShipro && !empresaSeleccionadaId) {
      setCotizando(false);
      setTarifasDomicilio([]);
      setTarifasSucursal([]);
      return;
    }

    const buscarTarifas = async () => {
      setCotizando(true);
      try {
        const bodyRequest: any = {
          cpOrigen, cpDestino, localidadDestino: decodeURIComponent(localidadDestino),
          paquetes: [{
            pesoKg: parseFloat(peso), largoCm: parseFloat(largo), anchoCm: parseFloat(ancho), altoCm: parseFloat(alto),
            valorDeclarado: 0, requiereSeguro: false
          }]
        };
        if (esShipro && empresaSeleccionadaId) {
          bodyRequest.filtroEmpresa = empresaSeleccionadaId;
        }

        const res = await fetch("/api/cotizar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyRequest)
        });

        if (res.ok) {
          const data = await res.json();
          setTarifasDomicilio(data.domicilio || []);
          setTarifasSucursal(data.sucursal || []);

          if (data.domicilio && data.domicilio.length > 0) setSelectedOption(data.domicilio[0].id);
        }
      } catch (error) {
        console.error("Error al cotizar", error);
      } finally {
        setCotizando(false);
      }
    };
    buscarTarifas();
  }, [cpOrigen, cpDestino, peso, largo, ancho, alto, session, localidadDestino, esShipro, empresaSeleccionadaId]);

  useEffect(() => {
    if (esShipro && !empresaSeleccionadaId) return;

    if (tabActivo === 'sucursal' && sucursales.length === 0) {
      const fetchSucursales = async () => {
        setCargandoSucursales(true);
        try {
          const locEncoded = encodeURIComponent(localidadDestino);
          const empresaIdParaSucursales = (esShipro && empresaSeleccionadaId)
            ? empresaSeleccionadaId
            : (session?.user?.empresaId || 1);
          const res = await fetch(`/api/envios/sucursales?cp=${cpDestino}&localidad=${locEncoded}&courier=andreani&filtroEmpresa=${empresaIdParaSucursales}`);
          if (res.ok) {
            const data = await res.json();
            setSucursales(data);
            if (data.length > 0) setSucursalElegidaId(data[0].id);
          }
        } catch (error) {
          console.error("Error buscando sucursales", error);
        } finally {
          setCargandoSucursales(false);
        }
      };
      fetchSucursales();
    }
  }, [tabActivo, cpDestino, localidadDestino, session, esShipro, empresaSeleccionadaId]);

  const generarEtiquetaFinal = async () => {
    if (!selectedOption) return;

    if (esShipro && !empresaSeleccionadaId) {
      alert("Seleccioná una empresa antes de generar la etiqueta.");
      return;
    }

    if (tabActivo === 'sucursal' && !sucursalElegidaId) {
      alert("Por favor, seleccioná una sucursal de destino en la lista.");
      return;
    }

    setCreando(true);

    let listaActiva = tarifasDomicilio;
    if (tabActivo === 'sucursal') listaActiva = tarifasSucursal;

    const tarifaElegida = listaActiva.find(t => t.id === selectedOption);
    if (!tarifaElegida) return;

    let modalidadDespacho = "Estándar";
    if (tabActivo === 'sucursal') modalidadDespacho = "sucursal";

    // EL PAYLOAD AHORA LLEVA AMBOS PRECIOS (VENTA Y COSTO)
    const payload: any = {
      nombreCourier: tarifaElegida.courier.toLowerCase(),
      modalidad: modalidadDespacho,
      destinatarioNombre: nombreDestino,
      cpDestino: cpDestino,
      localidad: decodeURIComponent(localidadDestino),
      calle: calleDestino, altura: alturaDestino, piso: "", dpto: "",
      dni: dniDestino, email: emailDestino, telefono: telefonoDestino,
      pesoReal: peso,
      valorDeclarado: 0,
      costoEnvio: tarifaElegida.precioFinal,
      costoProveedor: tarifaElegida.precioProveedor,
      sucursalDestinoId: tabActivo === 'sucursal' ? sucursalElegidaId : undefined
    };
    if (esShipro && empresaSeleccionadaId) {
      payload.filtroEmpresa = empresaSeleccionadaId;
    }

    try {
      const res = await fetch("/api/envios/manual", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.trackingNumber) {
        router.push(`/exito?tracking=${data.trackingNumber}`);
      } else {
        alert("Hubo un problema: " + (data.error || "Desconocido"));
        setCreando(false);
      }
    } catch (error) {
      alert("Error de conexión al despachar el envío.");
      setCreando(false);
    }
  };

  let listaActiva = tarifasDomicilio;
  if (tabActivo === 'sucursal') listaActiva = tarifasSucursal;

  const tarifaSeleccionadaObj = listaActiva.find(t => t.id === selectedOption);
  const precioFinalMostrar = tarifaSeleccionadaObj ? new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(tarifaSeleccionadaObj.precioFinal) : "0.00";

  const gateShipro = esShipro && !empresaSeleccionadaId;
  const footerVisible = !!selectedOption && !gateShipro;

  return (
    <div className="flex flex-col h-full relative bg-gray-50">
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8 z-10 shrink-0">
        <Link href="/nuevo-envio" className="mr-4 p-2 -ml-2 text-gray-400 hover:text-[#233b6b] hover:bg-gray-50 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-xl font-bold text-gray-800">Opciones de Envío (Ida)</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-4xl mx-auto space-y-6">

          {esShipro && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-indigo-200">
              <label className="block text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-1">
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

          {gateShipro ? (
            <div className="py-12 flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200 shadow-sm">
              <Building2 className="w-10 h-10 mb-3 text-indigo-300" />
              <p className="font-bold text-sm text-center">
                Seleccioná una empresa arriba para ver las opciones de cotización.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-[#233b6b] rounded-xl p-5 text-white shadow-md flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Origen</span>
                    <span className="font-semibold text-sm">CABA (CP {cpOrigen})</span>
                  </div>
                  <div className="flex-1 w-32 border-t border-dashed border-blue-400/50 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#233b6b] px-2 text-blue-300">
                      <Truck className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Destino</span>
                    <span className="font-semibold text-sm">{decodeURIComponent(localidadDestino)} (CP {cpDestino})</span>
                    <span className="text-blue-200 text-xs mt-1 truncate max-w-[150px]">{nombreDestino}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 border-b border-gray-200 pb-px mt-8 overflow-x-auto whitespace-nowrap">
                <button
                  onClick={() => { setTabActivo('domicilio'); if(tarifasDomicilio.length > 0) setSelectedOption(tarifasDomicilio[0].id); }}
                  className={`pb-3 px-4 font-bold text-sm flex items-center gap-2 transition-colors relative ${tabActivo === 'domicilio' ? 'text-[#233b6b]' : 'text-gray-400 hover:text-gray-600'}`}>
                  <Truck className="w-4 h-4" /> A Domicilio
                  {tabActivo === 'domicilio' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#233b6b]"></div>}
                </button>
                <button
                  onClick={() => { setTabActivo('sucursal'); if(tarifasSucursal.length > 0) setSelectedOption(tarifasSucursal[0].id); }}
                  className={`pb-3 px-4 font-bold text-sm flex items-center gap-2 transition-colors relative ${tabActivo === 'sucursal' ? 'text-[#233b6b]' : 'text-gray-400 hover:text-gray-600'}`}>
                  <Store className="w-4 h-4" /> A Sucursal
                  {tabActivo === 'sucursal' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#233b6b]"></div>}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 pt-4">
                {cotizando ? (
                  <div className="py-12 flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#233b6b]" />
                    <p className="font-bold text-sm">Consultando tarifas en tiempo real...</p>
                  </div>
                ) : listaActiva.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <p className="font-bold text-sm">No hay servicios de {tabActivo} disponibles para este destino.</p>
                  </div>
                ) : (
                  <>
                    {tabActivo === 'sucursal' && (
                      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 mb-2 animate-in fade-in slide-in-from-top-4">
                        <h4 className="font-bold text-[#233b6b] text-sm mb-3 flex items-center gap-2">
                          <MapPin className="w-4 h-4" /> Geolocalizador: Sucursales más cercanas
                        </h4>

                        {cargandoSucursales ? (
                          <div className="flex items-center gap-3 text-sm font-medium text-gray-500 bg-white p-3 rounded-lg border border-gray-200">
                            <Loader2 className="w-4 h-4 animate-spin text-[#233b6b]" /> Midiendo distancias satelitales a {cpDestino}...
                          </div>
                        ) : sucursales.length === 0 ? (
                          <div className="text-sm font-medium text-red-500 bg-white p-3 rounded-lg border border-red-200">
                            No encontramos sucursales comerciales para este Código Postal.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <select
                              value={sucursalElegidaId}
                              onChange={(e) => setSucursalElegidaId(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-bold text-gray-700 focus:outline-none focus:border-[#233b6b] shadow-sm cursor-pointer"
                            >
                              <option value="" disabled>Seleccioná una sucursal...</option>
                              {sucursales.map(suc => (
                                <option key={suc.id} value={suc.id}>
                                  {suc.nombre} - {suc.direccion} {suc.distanciaKm && suc.distanciaKm !== 999 ? `(a ${suc.distanciaKm} km)` : ''}
                                </option>
                              ))}
                            </select>
                            {sucursalElegidaId && (
                              <div className="text-xs text-gray-600 bg-white p-3 rounded-lg border border-gray-200 flex items-start gap-2 shadow-sm">
                                <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                                <p><strong>Horarios:</strong> {sucursales.find(s => s.id === sucursalElegidaId)?.horarios}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {listaActiva.map((tarifa) => (
                      <div
                        key={tarifa.id}
                        onClick={() => setSelectedOption(tarifa.id)}
                        className={`relative bg-white rounded-xl p-6 cursor-pointer transition-all duration-200 border-2 shadow-sm ${selectedOption === tarifa.id ? 'border-[#233b6b] bg-blue-50/10' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        {selectedOption === tarifa.id && <div className="absolute top-6 right-6 text-[#233b6b]"><CheckCircle2 className="w-6 h-6 fill-blue-50" /></div>}

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-5">
                            <div className="w-16 h-16 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-200 shadow-sm px-2">
                              <span className="font-black text-center text-gray-800 text-xs tracking-wider break-words">{tarifa.courier}</span>
                            </div>
                            <div>
                              <h4 className="text-lg font-bold text-gray-800 flex items-center gap-2">{tarifa.modalidad}</h4>
                              <div className="flex items-center gap-4 mt-3">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-md shadow-sm">
                                  <Clock className="w-3.5 h-3.5" /> SLA: {tarifa.slaHs} hs
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-3xl font-black text-gray-800 tracking-tight">$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(tarifa.precioFinal)}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Final con IVA</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-6 shadow-[0_-15px_40px_rgba(0,0,0,0.06)] transition-transform duration-300 z-20 flex justify-between items-center px-12 ${footerVisible ? 'translate-y-0' : 'translate-y-full'}`}>
        <div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Total a Facturar</p>
          <p className="text-2xl font-black text-[#233b6b] tracking-tight">$ {precioFinalMostrar}</p>
        </div>

        <button
          onClick={generarEtiquetaFinal}
          disabled={creando || !selectedOption}
          className="flex items-center gap-2 px-10 py-4 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-opacity text-base disabled:opacity-50"
          style={{ backgroundColor: brandColor }}>
          {creando ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
          {creando ? "Generando Etiqueta..." : "Confirmar Envío"}
        </button>
      </div>
    </div>
  );
}

export default function CotizarTarifas() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[#233b6b] font-bold flex flex-col items-center"><Loader2 className="w-8 h-8 animate-spin mb-4" />Cargando plataforma...</div>}>
      <CotizadorContenido />
    </Suspense>
  );
}
