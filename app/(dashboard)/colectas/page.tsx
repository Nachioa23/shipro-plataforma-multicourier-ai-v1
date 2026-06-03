"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Package, Search, Filter, Printer, FileText, CheckSquare, Square, Building2, AlertCircle, Loader2, ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { NOMBRES_DISPLAY } from "@/lib/couriers/serviciosSoportados";

export default function Colectas() {
  const brandColor = '#233b6b';
  const flowColor = '#4d85cc'; 
  const { data: session } = useSession();
  
  const rolActual = session?.user?.rol || 'operador_cliente'; 
  const esEquipoShipro = rolActual === 'operador_shipro' || rolActual === 'admin_shipro';
  
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [empresaSeleccionadaId, setEmpresaSeleccionadaId] = useState<string>(
    esEquipoShipro ? "" : session?.user?.empresaId?.toString() || ""
  );
  const [empresaActivaInfo, setEmpresaActivaInfo] = useState<any>(null);

  const [paquetesListos, setPaquetesListos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalEnvios, setTotalEnvios] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [busqueda, setBusqueda] = useState("");
  const [filtroCourier, setFiltroCourier] = useState("Todos");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  // Menor 4 (2026-06-04): single source of truth desde NOMBRES_DISPLAY.
  // Ver lib/couriers/serviciosSoportados.ts.
  const couriersLista = Object.values(NOMBRES_DISPLAY);

  const [seleccionadas, setSeleccionadas] = useState<number[]>([]);

  useEffect(() => {
    const fetchEmpresas = async () => {
      if (!esEquipoShipro) return;
      try {
        const res = await fetch('/api/clientes'); 
        if (res.ok) {
          const data = await res.json();
          setEmpresas(data);
          if (data.length > 0 && !empresaSeleccionadaId) {
            setEmpresaSeleccionadaId(data[0].id.toString());
            setEmpresaActivaInfo(data[0]);
          }
        }
      } catch (err) {
        console.error("Error cargando empresas");
      }
    };
    fetchEmpresas();
  }, [esEquipoShipro]);

  useEffect(() => {
    if (empresas.length > 0 && empresaSeleccionadaId) {
      const empresaInfo = empresas.find(e => e.id.toString() === empresaSeleccionadaId);
      setEmpresaActivaInfo(empresaInfo);
    }
  }, [empresaSeleccionadaId, empresas]);

  const fetchEnvios = async () => {
    if (!empresaSeleccionadaId) return; 
    setCargando(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: empresaSeleccionadaId,
        page: page.toString(),
        limit: limit.toString(),
        search: busqueda,
        courier: filtroCourier,
        fechaDesde: fechaDesde,
        fechaHasta: fechaHasta,
        estadoExacto: "Impreso / Listo" 
      });

      const res = await fetch(`/api/envios?${queryParams}`);
      const result = await res.json();
      
      setPaquetesListos(result.data || []);
      setTotalEnvios(result.meta?.total || 0);
      setTotalPages(result.meta?.totalPages || 1);
      setSeleccionadas([]);
    } catch (err) {
      console.error("Error al cargar paquetes");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchEnvios();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [empresaSeleccionadaId, page, limit, busqueda, filtroCourier, fechaDesde, fechaHasta]);

  const handleFiltroChange = (setter: any, value: any) => {
    setter(value);
    setPage(1); 
  };

  // =========================================================================
  // UX: LÓGICA DE SELECCIÓN INTELIGENTE
  // =========================================================================
  
  // 1. Identificamos dinámicamente de qué courier son los paquetes seleccionados
  const getCourierSeleccionado = () => {
    if (seleccionadas.length === 0) return null;
    const primerPaquete = paquetesListos.find(p => p.id === seleccionadas[0]);
    return primerPaquete?.courier?.nombre || 'Genérico';
  };

  const courierActivo = getCourierSeleccionado();

  const toggleSeleccion = (paquete: any) => {
    const id = paquete.id;
    const isSelected = seleccionadas.includes(id);

    // UX: Bloqueo activo. Si intenta seleccionar otro courier, le avisamos.
    if (!isSelected && courierActivo && paquete.courier?.nombre !== courierActivo) {
      alert(`⚠️ Acción no permitida.\n\nYa estás armando un manifiesto para ${courierActivo}. No podés mezclar paquetes de ${paquete.courier?.nombre || 'otro courier'}.`);
      return;
    }

    if (isSelected) {
      setSeleccionadas(seleccionadas.filter(item => item !== id));
    } else {
      setSeleccionadas([...seleccionadas, id]);
    }
  };

  const toggleTodas = () => {
    if (seleccionadas.length > 0) {
      // Si hay seleccionadas, limpiamos todo
      setSeleccionadas([]);
    } else {
      // UX: Si toca "Seleccionar Todas" en una vista mezclada, agarramos el primer courier que aparece
      // y seleccionamos solo esos paquetes.
      if (paquetesListos.length > 0) {
        const primerCourierFila = paquetesListos[0].courier?.nombre;
        const paquetesDelMismoCourier = paquetesListos.filter(p => p.courier?.nombre === primerCourierFila);
        setSeleccionadas(paquetesDelMismoCourier.map(p => p.id));
      }
    }
  };

  const isTodasSeleccionadasDelActivo = () => {
    if (paquetesListos.length === 0) return false;
    const courierReferencia = courierActivo || paquetesListos[0].courier?.nombre;
    const paquetesValidos = paquetesListos.filter(p => p.courier?.nombre === courierReferencia);
    return paquetesValidos.length > 0 && seleccionadas.length === paquetesValidos.length;
  };

  // =========================================================================

  const generarManifiesto = async () => {
    // Validación de seguridad
    const courierFinal = getCourierSeleccionado();
    if (!courierFinal) return alert("Seleccioná al menos un paquete.");

    setProcesando(true);
    try {
      const paquetesParaManifiesto = paquetesListos.filter(p => seleccionadas.includes(p.id));
      const fechaHoy = new Date().toLocaleDateString("es-AR");
      const horaHoy = new Date().toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' });

      // Guardamos en la base de datos (Usando el courier autodetectado)
      const res = await fetch("/api/envios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          ids: seleccionadas, 
          nuevoEstado: "Despachado",
          generarManifiestoParaCourier: courierFinal, // Autodetectado, independiente del filtro visual
          empresaId: empresaSeleccionadaId
        }),
      });

      if (!res.ok) throw new Error("Fallo al guardar en DB");
      const dataManifiesto = await res.json();
      
      // Creamos el PDF
      const doc = new jsPDF();
      const startX = 14;
      const startY = 22;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(35, 59, 107);
      doc.text("SHIPRO", startX, startY);

      const shiproWidth = doc.getTextWidth("SHIPRO");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(77, 133, 204); 
      doc.text("FLOW", startX + shiproWidth + 1.5, startY); 
      
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text("Plataforma Multicourier", startX, startY + 6);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      const datosY = startY + 15;
      doc.text(`Empresa: ${empresaActivaInfo?.nombre || 'Tu Empresa'}`, startX, datosY);
      doc.text(`Courier: ${courierFinal}`, startX, datosY + 6);
      doc.text(`Fecha de emisión: ${fechaHoy} - ${horaHoy} hs`, startX, datosY + 12);
      doc.text(`Total de paquetes: ${seleccionadas.length}`, startX, datosY + 18);
      
      doc.setFont("helvetica", "bold");
      doc.text(`Nro. Manifiesto: #${dataManifiesto.numeroCorrelativo.toString().padStart(4, '0')}`, 140, datosY);

      const tableColumn = ["#", "Tracking", "Pedido", "Destinatario", "C.P.", "Firma Recepción"];
      const tableRows = paquetesParaManifiesto.map((p, index) => [
        index + 1,
        p.trackingNumber,
        p.pedidoEcommerce || "-",
        p.destino?.nombre || p.destinatarioNombre || "Sin Nombre",
        p.destino?.cp || p.cpDestino || "-",
        "" 
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: datosY + 25, 
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 3, font: "helvetica" },
        headStyles: { fillColor: [35, 59, 107], textColor: 255, fontStyle: 'bold' }, 
        columnStyles: { 
          0: { cellWidth: 8, halign: 'center' },
          1: { fontStyle: 'bold', textColor: [35, 59, 107] }, 
          5: { cellWidth: 40 } 
        } 
      });

      const finalY = (doc as any).lastAutoTable.finalY || datosY + 30;
      const firmasY = finalY + 25;

      doc.setDrawColor(200);
      doc.line(14, firmasY, 90, firmasY); 
      doc.line(110, firmasY, 190, firmasY); 

      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text("Firma y Aclaración Despachante", 52, firmasY + 5, { align: 'center' });
      doc.text("Firma y Aclaración Chofer/Courier", 150, firmasY + 5, { align: 'center' });

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          const footerY = 285;
          let currentX = startX;

          doc.setFont("helvetica", "normal");
          doc.setTextColor(150, 150, 150);
          doc.text("Generado por ", currentX, footerY);
          currentX += doc.getTextWidth("Generado por ");

          doc.setFont("helvetica", "bold");
          doc.setTextColor(35, 59, 107);
          doc.text("SHIPRO", currentX, footerY);
          currentX += doc.getTextWidth("SHIPRO") + 0.5;

          doc.setFont("helvetica", "normal");
          doc.setTextColor(77, 133, 204);
          doc.text("FLOW", currentX, footerY);
          currentX += doc.getTextWidth("FLOW") + 1;

          doc.setFont("helvetica", "normal");
          doc.setTextColor(150, 150, 150);
          doc.text(` | Plataforma Multicourier - ${fechaHoy}`, currentX, footerY);

          doc.text(`Página ${i} de ${pageCount}`, 196, footerY, { align: "right" });
      }

      const nombreArchivo = `ShiproFlow_Manifiesto_${courierFinal.replace(/\s+/g, '')}_#${dataManifiesto.numeroCorrelativo}.pdf`;
      doc.save(nombreArchivo);
      
      setSeleccionadas([]);
      fetchEnvios(); 
    } catch (err) {
      console.error(err);
      alert("Error al generar el manifiesto.");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto font-sans pb-20">
      
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-800 tracking-tight">Armado y Colectas</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">Consolidación de paquetes y manifiestos de despacho.</p>
            </div>
          </div>
        </div>

        {esEquipoShipro && (
          <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between bg-blue-50/50 p-4 rounded-xl border border-blue-100 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-700"><Building2 className="w-5 h-5" /></div>
              <div>
                <p className="text-xs font-bold text-blue-800 uppercase tracking-wider">Contexto Operativo (Requerido)</p>
                <p className="text-xs text-blue-600 font-medium">Estás operando internamente. Elegí la cuenta a gestionar:</p>
              </div>
            </div>
            <div className="relative min-w-[300px]">
              <select 
                value={empresaSeleccionadaId}
                onChange={(e) => setEmpresaSeleccionadaId(e.target.value)}
                className="w-full pl-4 pr-10 py-2.5 border-2 border-blue-200 rounded-lg text-sm font-black text-[#233b6b] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer appearance-none"
              >
                <option value="" disabled>Seleccioná un cliente...</option>
                {empresas.map((emp) => (
                  <option key={emp.id} value={emp.id.toString()}>{emp.nombre} (CUIT: {emp.cuit})</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-blue-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="p-8 max-w-[90rem] mx-auto w-full space-y-6">
        
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center font-black text-blue-600 text-xl border-2 border-dashed border-blue-200 shrink-0 uppercase">
              {empresaActivaInfo?.nombre?.substring(0, 2) || 'CL'}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">
                {empresaActivaInfo ? `Depósito de ${empresaActivaInfo.nombre}` : 'Seleccioná un depósito operativo'}
              </h3>
              <p className="text-sm text-gray-500 font-medium flex items-center gap-2">
                <span className="text-green-600 font-bold flex items-center gap-1"><CheckSquare className="w-4 h-4"/> {totalEnvios} listos para despachar</span>
                <span className="text-gray-300">|</span>
                <span>Corte de colecta: {empresaActivaInfo?.horarioCorte || 'A convenir'}</span>
              </p>
            </div>
          </div>
          <Link href="/historial-manifiestos" className="px-6 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 text-sm w-full sm:w-auto">
            <FileText className="w-4 h-4" /> Historial de Manifiestos
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 items-center">
          <div className="relative flex-1 w-full">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Buscar por cliente o nro de tracking..." 
              value={busqueda}
              onChange={(e) => handleFiltroChange(setBusqueda, e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]" 
            />
          </div>
          <div className="flex-shrink-0 min-w-[200px] w-full lg:w-auto">
            <select 
              value={filtroCourier}
              onChange={(e) => handleFiltroChange(setFiltroCourier, e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer"
            >
              <option value="Todos">Todos los Couriers</option>
              {couriersLista.map((courier) => (
                <option key={courier} value={courier}>{courier}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-36">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[9px] font-bold text-gray-500 uppercase tracking-wider">Desde</label>
              <input type="date" value={fechaDesde} onChange={(e) => handleFiltroChange(setFechaDesde, e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer" />
            </div>
            <div className="relative flex-1 lg:w-36">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[9px] font-bold text-gray-500 uppercase tracking-wider">Hasta</label>
              <input type="date" value={fechaHasta} min={fechaDesde} onChange={(e) => handleFiltroChange(setFechaHasta, e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer" />
            </div>
          </div>
          {(busqueda || filtroCourier !== "Todos" || fechaDesde || fechaHasta) && (
            <button onClick={() => { setBusqueda(""); setFiltroCourier("Todos"); setFechaDesde(""); setFechaHasta(""); setPage(1); }} className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full lg:w-auto">
              Limpiar
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4" /> Paquetes Impresos (Sin Manifiesto)
            </h3>
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full border border-blue-200">
              {totalEnvios} Listos
            </span>
          </div>
          <div className="overflow-x-auto min-h-[300px]">
            {cargando ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p className="font-bold text-sm">Consultando Base de Datos...</p>
              </div>
            ) : !empresaSeleccionadaId ? (
               <div className="text-center py-20 text-gray-500">
                <Building2 className="w-12 h-12 text-gray-300 mb-4 mx-auto" />
                <h3 className="text-lg font-bold text-gray-800">Esperando Cliente</h3>
                <p className="text-sm mt-1">Seleccioná un cliente en el menú superior para ver sus paquetes.</p>
              </div>
            ) : paquetesListos.length === 0 ? (
              <div className="text-center py-20">
                <Package className="w-12 h-12 text-gray-300 mb-4 mx-auto" />
                <h3 className="text-lg font-bold text-gray-800">No hay paquetes listos</h3>
                <p className="text-sm text-gray-500 mt-1">No se encontraron etiquetas impresas para consolidar.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-white border-b border-gray-200 text-xs uppercase tracking-wider text-gray-400 font-bold">
                    <th className="px-6 py-4 w-10 cursor-pointer text-center" onClick={toggleTodas}>
                      {isTodasSeleccionadasDelActivo() ? (
                        <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-300 hover:text-gray-400 transition-colors mx-auto" />
                      )}
                    </th>
                    <th className="px-6 py-4">Tracking / Pedido</th>
                    <th className="px-6 py-4">Destinatario</th>
                    <th className="px-6 py-4">Courier Asignado</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100">
                  {paquetesListos.map((paquete) => {
                    const isSelected = seleccionadas.includes(paquete.id);
                    // UX VISUAL: Si ya elegí un courier y este es de otro, lo opacamos
                    const isDisabled = courierActivo !== null && paquete.courier?.nombre !== courierActivo;

                    return (
                      <tr 
                        key={paquete.id}
                        className={`transition-colors group 
                          ${isSelected ? 'bg-blue-50/50' : ''}
                          ${isDisabled ? 'opacity-40 grayscale bg-gray-50/50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                        onClick={() => toggleSeleccion(paquete)}
                      >
                        <td className="px-6 py-4 text-center">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#233b6b] mx-auto" />
                          ) : (
                            <Square className={`w-4 h-4 mx-auto transition-colors ${isDisabled ? 'text-gray-200' : 'text-gray-300 group-hover:text-gray-400'}`} />
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className={`font-bold font-mono text-xs ${isDisabled ? 'text-gray-500' : 'text-gray-800'}`}>{paquete.trackingNumber}</p>
                          <p className="text-[10px] font-bold text-gray-400 mt-0.5 uppercase">PEDIDO: {paquete.pedidoEcommerce || '-'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className={`font-bold text-xs ${isDisabled ? 'text-gray-500' : 'text-gray-800'}`}>{paquete.destino?.nombre || paquete.destinatarioNombre || 'Sin Nombre'}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">CP: {paquete.destino?.cp || paquete.cpDestino || ''}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded border bg-white ${
                              isDisabled ? 'text-gray-400 border-gray-200' :
                              paquete.courierId === 1 ? 'text-purple-700 border-purple-200' :
                              paquete.courierId === 2 ? 'text-red-700 border-red-200' :
                              'text-yellow-700 border-yellow-200'
                            }`}>
                            {paquete.courier?.nombre || 'Genérico'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="p-4 bg-white border-t border-gray-200 flex justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-500">Filas:</span>
              <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="border rounded-lg px-2 py-1 text-sm font-bold text-gray-700 cursor-pointer">
                <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
              </select>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-500">Página <strong>{page}</strong> de <strong>{totalPages || 1}</strong></span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || cargando} className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0 || cargando} className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>

        {/* ALERTA INTELIGENTE */}
        <div className={`p-4 rounded-xl flex items-start gap-3 shadow-sm transition-all ${filtroCourier === 'Todos' ? 'bg-yellow-50 border border-yellow-100' : 'bg-green-50 border border-green-100'}`}>
          {filtroCourier === 'Todos' ? (
            <>
              <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-800 font-medium">Recordá que <strong>no podés mezclar couriers</strong> en una misma hoja de ruta. Seleccioná el primer paquete y el sistema filtrará automáticamente a su courier.</p>
            </>
          ) : (
             <>
              <Truck className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <p className="text-xs text-green-800 font-medium">Estás viendo solo los paquetes de <strong>{filtroCourier}</strong>. Podés seleccionarlos todos tranquilos para armar el manifiesto.</p>
            </>
          )}
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-gray-200 p-4 sm:p-5 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] transition-transform duration-300 z-30 flex justify-between items-center px-8 ${seleccionadas.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-indigo-700">{seleccionadas.length}</span>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">Cajas seleccionadas</p>
            <p className="text-xs text-indigo-600 font-bold hidden sm:block">
              Listas para entregar a {courierActivo}
            </p>
          </div>
        </div>
        
        <button 
          onClick={generarManifiesto}
          disabled={procesando || seleccionadas.length === 0}
          className="flex items-center gap-2 px-8 py-3 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl shadow-md transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed" 
        >
          {procesando ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</> : <><FileText className="w-5 h-5" /> Generar Hoja de Ruta ({courierActivo})</>}
        </button>
      </div>

    </div>
  );
}