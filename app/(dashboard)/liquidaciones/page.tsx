"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Calculator, FileSpreadsheet, CheckCircle2, Loader2, AlertTriangle, CalendarDays, Receipt, Download, Search, X } from "lucide-react";

// STEP 1 (dos-vías-liquidación): sección reutilizable para pendientes Fee/Logistica.
// Cada item de `items` viene con { empresaId, empresaNombre, cuit, periodo, totalEnvios, montoTotal }.
function PendientesSection({
  titulo, descripcion, items, tipo, cargando, procesandoKey, onCerrar, formatMoneda,
}: {
  titulo: string;
  descripcion: string;
  items: any[];
  tipo: "FEE" | "LOGISTICA";
  cargando: boolean;
  procesandoKey: string | null;
  onCerrar: (empresaId: number, nombreEmpresa: string, tipo: "FEE" | "LOGISTICA", periodo: string) => void;
  formatMoneda: (v: number) => string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100 bg-cyan-50/30">
        <h3 className="text-lg font-bold text-[#233b6b] flex items-center gap-2">
          <CalendarDays className="w-5 h-5" /> {titulo}
        </h3>
        <p className="text-xs text-gray-500 mt-1">{descripcion}</p>
      </div>
      <div className="p-6">
        {cargando ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Analizando base de datos...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
            <p className="text-sm">Sin pendientes en esta vía.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {items.map((emp: any) => {
              const key = `${emp.empresaId}:${tipo}:${emp.periodo}`;
              const enCurso = procesandoKey === key;
              return (
                <div key={key} className="border border-gray-200 rounded-xl p-5 hover:border-[#233b6b] transition-colors flex flex-col justify-between">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-black text-gray-800 text-lg">{emp.empresaNombre}</h4>
                      <p className="text-xs font-bold text-gray-400">CUIT: {emp.cuit || "—"} · Período: <span className="text-[#233b6b]">{emp.periodo}</span></p>
                    </div>
                    <div className="bg-amber-50 text-amber-700 px-3 py-1 rounded-lg border border-amber-200 text-xs font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {emp.totalEnvios} envíos
                    </div>
                  </div>
                  <div className="flex items-end justify-between mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Monto a Liquidar</p>
                      <p className="text-2xl font-black text-[#233b6b]">{formatMoneda(emp.montoTotal)}</p>
                    </div>
                    <button
                      onClick={() => onCerrar(emp.empresaId, emp.empresaNombre, tipo, emp.periodo)}
                      disabled={enCurso}
                      className="bg-[#233b6b] hover:bg-blue-900 text-white font-bold py-2.5 px-5 rounded-lg transition-colors text-sm flex items-center gap-2 shadow-sm disabled:opacity-50"
                    >
                      {enCurso ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                      Generar Proforma {tipo === "FEE" ? "FEE" : "LOGÍSTICA"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CierreMensual() {
  const brandColor = '#233b6b';

  // STEP 1 (dos-vías-liquidación): dos listas de pendientes (Fee / Logistica).
  const [pendientesFee, setPendientesFee] = useState<any[]>([]);
  const [pendientesLogistica, setPendientesLogistica] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  // Clave de row en curso: `${empresaId}:${tipo}:${periodo}` para no bloquear rows distintas.
  const [procesandoKey, setProcesandoKey] = useState<string | null>(null);

  // Súper Buscador
  const [busquedaTracking, setBusquedaTracking] = useState("");
  const [resultadoBuscador, setResultadoBuscador] = useState<any>(null);
  const [buscandoForense, setBuscandoForense] = useState(false);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/liquidaciones");
      if (res.ok) {
        const data = await res.json();
        setPendientesFee(data.pendientesFee || []);
        setPendientesLogistica(data.pendientesLogistica || []);
        setHistorial(data.historial || []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const formatMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
  };

  // BUSCADOR FORENSE
  const buscarTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!busquedaTracking.trim()) return;
    
    setBuscandoForense(true);
    setResultadoBuscador(null);
    try {
      const res = await fetch(`/api/admin/liquidaciones?tracking=${busquedaTracking.trim()}`);
      const data = await res.json();
      if (res.ok) setResultadoBuscador(data);
      else alert(data.error || "Tracking no encontrado.");
    } catch (err) {
      alert("Error de conexión");
    } finally {
      setBuscandoForense(false);
    }
  };

  const ejecutarCierre = async (empresaId: number, nombreEmpresa: string, tipo: "FEE" | "LOGISTICA", periodo: string) => {
    const rotulo = tipo === "FEE" ? "Fee de plataforma" : "Logística (courier)";
    const confirmar = confirm(`¿Generar proforma ${rotulo} de ${nombreEmpresa} para el período ${periodo}?`);
    if (!confirmar) return;

    const key = `${empresaId}:${tipo}:${periodo}`;
    setProcesandoKey(key);
    try {
      const res = await fetch("/api/admin/liquidaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId, periodo, tipo }),
      });

      const data = await res.json();

      if (res.ok) {
        generarExcelProforma(data.envios, data.liquidacion, nombreEmpresa, tipo);
        alert(`Proforma ${rotulo} generada. Los envíos fueron marcados como LIQUIDADO en esa vía.`);
        cargarDatos();
      } else {
        alert(data.error || "Error al generar la liquidación");
      }
    } catch (error) {
      alert("Error de conexión");
    } finally {
      setProcesandoKey(null);
    }
  };

  const generarExcelProforma = (envios: any[], liquidacion: any, nombreEmpresa: string, tipo: "FEE" | "LOGISTICA") => {
    // STEP 1: dos formatos de Excel, uno por vía. Los importes vienen del
    // breakdown persistido (feeNetoFacturado / logisticaNetaFacturada / ivaFacturado)
    // — NO recalculamos precioFactura − precioProveedor (heurística vieja errada).
    const IVA = 1.21;
    const filasExcel = envios.map(e => {
      const f = e.finanzas || {};
      const feeNeto = Number(f.feeNetoFacturado ?? 0);
      const logNeto = Number(f.logisticaNetaFacturada ?? 0);
      const aforo = Number(f.costoAforo ?? 0);
      if (tipo === "FEE") {
        return {
          "Fecha Creado": new Date(e.fechaImpresion).toLocaleDateString(),
          "Tracking": e.trackingNumber,
          "Courier": e.courier?.nombre?.toUpperCase() || "",
          "Modalidad": e.modalidad,
          "Fee Shipro (Neto)": feeNeto,
          "IVA 21%": +(feeNeto * (IVA - 1)).toFixed(2),
          "TOTAL FEE": +(feeNeto * IVA).toFixed(2),
        };
      }
      // LOGISTICA
      const netoTotal = logNeto + aforo;
      return {
        "Fecha Creado": new Date(e.fechaImpresion).toLocaleDateString(),
        "Tracking": e.trackingNumber,
        "Courier": e.courier?.nombre?.toUpperCase() || "",
        "Modalidad": e.modalidad,
        "Provincia Destino": e.destino?.provincia || "",
        "CP Destino": e.destino?.cp || "",
        "Peso Cotizado (Kg)": f.pesoCobrado || e.pesoReal,
        "Peso Aforado (Kg)": f.pesoAforado || "-",
        "Logística Neta (Cascada + SMO)": logNeto,
        "Ajuste por Aforo": aforo,
        "IVA 21%": +(netoTotal * (IVA - 1)).toFixed(2),
        "TOTAL LOGÍSTICA": +(netoTotal * IVA).toFixed(2),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(filasExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, tipo === "FEE" ? "Fee_Detalle" : "Logistica_Detalle");

    XLSX.writeFile(workbook, `PROFORMA_${tipo}_${nombreEmpresa.replace(/\s/g, '_')}_${liquidacion.periodo.replace(/\s/g, '_')}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-cyan-50 text-cyan-700 border border-cyan-100">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Cierres de Mes y Liquidaciones</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Regla Activa: Solo se facturan los envíos validados en la Auditoría de Aforos.
              </p>
            </div>
          </div>

          {/* BARRA DE SUPER BUSCADOR */}
          <form onSubmit={buscarTracking} className="relative hidden md:block">
            <input 
              type="text" 
              placeholder="Súper Buscador: Tracking..." 
              value={busquedaTracking}
              onChange={(e) => setBusquedaTracking(e.target.value)}
              className="pl-10 pr-4 py-2 border-2 border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#233b6b] w-64 font-mono font-bold"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <button type="submit" className="hidden"></button>
          </form>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
        
        {/* RESULTADO SÚPER BUSCADOR */}
        {resultadoBuscador && (
          <div className="bg-[#233b6b] rounded-2xl shadow-lg border border-blue-900 p-6 text-white animate-in slide-in-from-top-4 relative">
            <button onClick={() => setResultadoBuscador(null)} className="absolute top-4 right-4 text-blue-300 hover:text-white"><X className="w-5 h-5" /></button>
            <h3 className="text-xs font-black text-blue-300 uppercase tracking-widest mb-4 flex items-center gap-2"><Search className="w-4 h-4" /> Resultado Forense</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-blue-300 font-bold mb-1">Tracking Nro</p>
                <p className="text-lg font-mono font-black">{resultadoBuscador.trackingNumber}</p>
              </div>
              <div>
                <p className="text-xs text-blue-300 font-bold mb-1">Cliente</p>
                <p className="text-lg font-bold">{resultadoBuscador.empresa?.nombre}</p>
              </div>
              <div>
                <p className="text-xs text-blue-300 font-bold mb-1">Rama</p>
                <p className="text-lg font-bold">{resultadoBuscador.finanzas?.ramaCongelada ? "B (creds propias)" : "A (Shipro)"}</p>
              </div>
              <div>
                <p className="text-xs text-blue-300 font-bold mb-1">Vía FEE</p>
                <span className={`px-2 py-1 text-xs font-bold rounded ${resultadoBuscador.finanzas?.estadoLiquidacionFee === 'LIQUIDADO' ? 'bg-green-500/20 text-green-300' : resultadoBuscador.finanzas?.estadoLiquidacionFee === 'OBSERVADO' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  {resultadoBuscador.finanzas?.estadoLiquidacionFee || '—'}
                </span>
                <p className="text-xs text-blue-300 mt-1">
                  {resultadoBuscador.finanzas?.liquidacionFee ? `LIQ-${String(resultadoBuscador.finanzas.liquidacionFee.id).padStart(4, '0')}` : 'Sin cerrar'}
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-300 font-bold mb-1">Vía LOGÍSTICA</p>
                <span className={`px-2 py-1 text-xs font-bold rounded ${
                  resultadoBuscador.finanzas?.estadoLiquidacionLogistica === 'LIQUIDADO' ? 'bg-green-500/20 text-green-300'
                  : resultadoBuscador.finanzas?.estadoLiquidacionLogistica === 'NO_APLICA' ? 'bg-gray-500/30 text-gray-300'
                  : resultadoBuscador.finanzas?.estadoLiquidacionLogistica === 'OBSERVADO' ? 'bg-red-500/20 text-red-300'
                  : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {resultadoBuscador.finanzas?.estadoLiquidacionLogistica || '—'}
                </span>
                <p className="text-xs text-blue-300 mt-1">
                  {resultadoBuscador.finanzas?.liquidacionLogistica ? `LIQ-${String(resultadoBuscador.finanzas.liquidacionLogistica.id).padStart(4, '0')}` : 'Sin cerrar'}
                  {resultadoBuscador.finanzas?.periodoLogistica ? ` · ${resultadoBuscador.finanzas.periodoLogistica}` : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* BLOQUE 1a: PENDIENTES DE CIERRE — FEE */}
        <PendientesSection
          titulo="Pendientes: Fee de Plataforma"
          descripcion="Se cobra al mes de creación del envío. Cubre AMBAS ramas."
          items={pendientesFee}
          tipo="FEE"
          cargando={cargando || buscandoForense}
          procesandoKey={procesandoKey}
          onCerrar={ejecutarCierre}
          formatMoneda={formatMoneda}
        />

        {/* BLOQUE 1b: PENDIENTES DE CIERRE — LOGÍSTICA */}
        <PendientesSection
          titulo="Pendientes: Logística (Courier)"
          descripcion="Se cobra al mes de la factura del courier. Rama A solamente (Rama B es NO_APLICA)."
          items={pendientesLogistica}
          tipo="LOGISTICA"
          cargando={cargando || buscandoForense}
          procesandoKey={procesandoKey}
          onCerrar={ejecutarCierre}
          formatMoneda={formatMoneda}
        />

        {/* BLOQUE 2: HISTORIAL DE LIQUIDACIONES */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-gray-400" /> Historial de Proformas Emitidas
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap text-sm">
              <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                <tr>
                  <th className="px-6 py-4">Proforma Nro</th>
                  <th className="px-6 py-4">Tipo</th>
                  <th className="px-6 py-4">Cliente</th>
                  <th className="px-6 py-4">Período</th>
                  <th className="px-6 py-4 text-right">Total Liquidado</th>
                  <th className="px-6 py-4 text-center">Factura Xubio (AFIP)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cargando ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">Cargando...</td></tr>
                ) : historial.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-500">Aún no hay liquidaciones históricas.</td></tr>
                ) : (
                  historial.map(liq => (
                    <tr key={liq.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono font-black text-[#233b6b]">
                        LIQ-{String(liq.id).padStart(4, '0')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-black ${liq.tipo === 'FEE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                          {liq.tipo || 'LOGISTICA'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-800">{liq.empresa?.nombre}</td>
                      <td className="px-6 py-4">
                        <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded text-xs font-bold">{liq.periodo}</span>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-gray-800">
                        {formatMoneda(liq.montoTotal)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {liq.facturaXubioUrl ? (
                          <a href={liq.facturaXubioUrl} target="_blank" className="text-green-600 font-bold text-xs">Ver Factura A/B</a>
                        ) : (
                          <button className="text-gray-400 hover:text-blue-600 font-bold text-xs inline-flex items-center gap-1 border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5 rounded transition-colors">
                            <Download className="w-3.5 h-3.5" /> Vincular PDF (API)
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}