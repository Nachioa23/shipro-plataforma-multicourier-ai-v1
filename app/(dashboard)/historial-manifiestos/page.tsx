"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ArrowLeft, FileText, Search, Download, Loader2, Package, Building2 } from 'lucide-react';

export default function HistorialManifiestos() {
  const { data: session } = useSession();
  const [manifiestos, setManifiestos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  
  const [busqueda, setBusqueda] = useState("");
  const [filtroCourier, setFiltroCourier] = useState("Todos");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const couriersLista = ["Moova", "Andreani", "Correo Argentino", "Moci's", "Javit"];

  const fetchManifiestos = async () => {
    if (!session?.user?.empresaId) return;
    setCargando(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: session.user.empresaId.toString(),
        search: busqueda,
        courier: filtroCourier,
        fechaDesde: fechaDesde,
        fechaHasta: fechaHasta
      });

      const res = await fetch(`/api/manifiestos?${queryParams}`);
      if (res.ok) {
        const data = await res.json();
        setManifiestos(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => { fetchManifiestos(); }, 400);
    return () => clearTimeout(timeout);
  }, [session, busqueda, filtroCourier, fechaDesde, fechaHasta]);

  const handleFiltroChange = (setter: any, value: any) => {
    setter(value);
  };

  const formatearFecha = (fechaStr: string) => {
    return new Date(fechaStr).toLocaleDateString("es-AR", { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  if (session && session.user.empresaId === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
          <Building2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-gray-800 mb-2">Sección para usuarios cliente</h2>
          <p className="text-sm text-gray-600 mb-6">El historial de manifiestos corresponde a las colectas de cada empresa. Como usuario Shipro no tenés una empresa propia.</p>
          <Link href="/torre-de-control" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-lg transition-colors">
            Ir a Torre de Control
          </Link>
        </div>
      </div>
    );
  }

  // ================= GENERADOR DE PDF (REIMPRESIÓN) =================
  const reimprimirManifiesto = (manifiesto: any) => {
    try {
      const doc = new jsPDF();
      const startX = 14;
      const startY = 22;

      const fechaObj = new Date(manifiesto.fechaCreacion);
      const fechaHoy = fechaObj.toLocaleDateString("es-AR");
      const horaHoy = fechaObj.toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' });

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
      
      // Acá usamos el nombre de la empresa real que nos trajo la API
      doc.text(`Empresa: ${manifiesto.empresa?.nombre || 'Tu Empresa'}`, startX, datosY);
      doc.text(`Courier: ${manifiesto.courier}`, startX, datosY + 6);
      doc.text(`Fecha de emisión: ${fechaHoy} - ${horaHoy} hs`, startX, datosY + 12);
      doc.text(`Total de paquetes: ${manifiesto.cantidadPaquetes}`, startX, datosY + 18);
      
      doc.setFont("helvetica", "bold");
      doc.text(`Nro. Manifiesto: #${manifiesto.numeroCorrelativo.toString().padStart(4, '0')}`, 140, datosY);

      const tableColumn = ["#", "Tracking", "Pedido", "Destinatario", "C.P.", "Firma Recepción"];
      // Mapeamos los envíos que están DENTRO de este manifiesto específico
      const tableRows = manifiesto.envios.map((p: any, index: number) => [
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

      // Descargamos usando los datos históricos
      const nombreArchivo = `ShiproFlow_Manifiesto_${manifiesto.courier.replace(/\s+/g, '')}_Nro${manifiesto.numeroCorrelativo}.pdf`;
      doc.save(nombreArchivo);
      
    } catch (err) {
      console.error(err);
      alert("Error al generar el manifiesto.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8 z-10 shrink-0">
        <Link href="/colectas" className="mr-4 p-2 -ml-2 text-gray-400 hover:text-[#233b6b] rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-xl font-bold text-gray-800">Historial de Manifiestos</h2>
      </header>

      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          
          <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 items-center">
            
            <div className="relative flex-1 w-full">
              <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar por nro de tracking o nro de manifiesto..." 
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
                <input 
                  type="date" 
                  value={fechaDesde}
                  onChange={(e) => handleFiltroChange(setFechaDesde, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer"
                />
              </div>
              <div className="relative flex-1 lg:w-36">
                <label className="absolute -top-2 left-2 bg-white px-1 text-[9px] font-bold text-gray-500 uppercase tracking-wider">Hasta</label>
                <input 
                  type="date" 
                  value={fechaHasta}
                  min={fechaDesde} 
                  onChange={(e) => handleFiltroChange(setFechaHasta, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 bg-gray-50 focus:outline-none cursor-pointer"
                />
              </div>
            </div>

            {(busqueda || filtroCourier !== "Todos" || fechaDesde || fechaHasta) && (
              <button 
                onClick={() => { setBusqueda(""); setFiltroCourier("Todos"); setFechaDesde(""); setFechaHasta(""); }}
                className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full lg:w-auto"
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {cargando ? (
              <div className="p-12 text-center text-gray-500"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando...</div>
            ) : manifiestos.length === 0 ? (
               <div className="p-12 text-center text-gray-500"><FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" /> No se encontraron manifiestos.</div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                    <th className="px-6 py-4">Nro. Manifiesto</th>
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4">Courier</th>
                    <th className="px-6 py-4">Paquetes</th>
                    <th className="px-6 py-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {manifiestos.map((man) => (
                    <tr key={man.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-black text-[#233b6b]">#{man.numeroCorrelativo.toString().padStart(4, '0')}</td>
                      <td className="px-6 py-4 text-gray-600 font-medium">{formatearFecha(man.fechaCreacion)}</td>
                      <td className="px-6 py-4 font-bold">{man.courier}</td>
                      <td className="px-6 py-4"><span className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded font-bold w-max"><Package className="w-3.5 h-3.5"/> {man.cantidadPaquetes}</span></td>
                      <td className="px-6 py-4 text-right">
                        
                        {/* ACÁ ESTÁ EL BOTÓN FUNCIONANDO */}
                        <button 
                          className="flex items-center justify-end w-full gap-2 text-blue-600 hover:text-blue-800 font-bold text-xs transition-colors" 
                          onClick={() => reimprimirManifiesto(man)}
                        >
                           <Download className="w-4 h-4"/> Reimprimir
                        </button>
                        
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}