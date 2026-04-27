"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { CreditCard, FileText, Download, TrendingUp, BarChart3, Receipt, CheckCircle2, Scale, DollarSign, Loader2, AlertTriangle, ArrowUpRight, ArrowDownRight, FileSpreadsheet } from 'lucide-react';

export default function Facturacion() {
  const brandColor = '#233b6b';
  const { data: session } = useSession();

  // Agregamos "liquidaciones" al estado
  const [billeteraData, setBilleteraData] = useState<{saldo: number, modalidadPago: string, movimientos: any[], liquidaciones: any[]}>({ saldo: 0, modalidadPago: 'POSTPAGO', movimientos: [], liquidaciones: [] });
  const [cargando, setCargando] = useState(true);
  const [errorApi, setErrorApi] = useState(false);

  useEffect(() => {
    const fetchCuentaCorriente = async () => {
      if (!session?.user?.empresaId) return;
      
      setCargando(true);
      setErrorApi(false);
      
      try {
        const res = await fetch(`/api/finanzas?empresaId=${session.user.empresaId}`);
        
        if (res.ok) {
          const data = await res.json();
          setBilleteraData(data);
        } else {
          setErrorApi(true);
        }
      } catch (err) {
        console.error("Error trayendo datos financieros", err);
        setErrorApi(true);
      } finally {
        setCargando(false);
      }
    };

    fetchCuentaCorriente();
  }, [session]);

  const formatearMoneda = (monto: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(monto);
  };

  const formatearFecha = (fechaStr: string) => {
    return new Date(fechaStr).toLocaleDateString("es-AR", { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  const informarPago = () => {
    alert("Para informar un pago o cargar saldo, por favor enviá el comprobante de transferencia a tu asesor comercial de Shipro por WhatsApp.");
  };

  const esPostpago = billeteraData.modalidadPago === 'POSTPAGO';

  return (
    <div className="flex flex-col h-full relative bg-gray-50">
      
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <CreditCard className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Facturación y Billetera Virtual</h2>
          </div>
        </div>
      </header>

      <div className="flex-1 p-8 overflow-y-auto pb-32">
        <div className="max-w-6xl mx-auto space-y-6">
          
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 flex items-start gap-4">
            <BarChart3 className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-blue-900 mb-1">Estado de Cuenta Oficial (Shipro)</h3>
              <p className="text-xs text-blue-800 leading-relaxed">
                Aquí podés ver tu saldo en tiempo real, recargar dinero para generar más envíos y descargar tus liquidaciones mensuales consolidadas.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <DollarSign className="w-4 h-4" /> Modalidad Activa
              </p>
              <div className="flex items-end gap-3 mb-2">
                <h3 className="text-2xl font-black text-gray-800 tracking-wider">{billeteraData.modalidadPago}</h3>
              </div>
              <p className="text-xs font-medium text-gray-500">
                {esPostpago ? 'Tenés línea de crédito activa a 7 días.' : 'El saldo debe ser positivo para operar.'}
              </p>
            </div>
            
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Scale className="w-4 h-4" /> Envíos Liquidados
              </p>
              <div className="flex items-end gap-3 mb-2">
                <h3 className="text-3xl font-black text-gray-800">{billeteraData.liquidaciones?.length || 0}</h3>
              </div>
              <p className="text-xs font-medium text-gray-500">Proformas cerradas históricamente.</p>
            </div>

            {/* KPI BILLETERA */}
            <div className={`p-6 rounded-2xl shadow-md border relative overflow-hidden text-white
                ${errorApi ? 'bg-gray-800 border-gray-700' : (billeteraData.saldo < 0 && !esPostpago) ? 'bg-red-900 border-red-800' : 'bg-[#233b6b] border-blue-900'}`}>
              <div className="absolute -right-6 -top-6 text-white/10"><CreditCard className="w-32 h-32" /></div>
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div>
                  <p className="text-xs font-bold text-blue-200 uppercase tracking-wider mb-1">
                    {esPostpago ? 'Crédito Utilizado' : 'Saldo en Billetera'}
                  </p>
                  {cargando ? (
                     <Loader2 className="w-8 h-8 animate-spin text-white my-2" />
                  ) : errorApi ? (
                     <h3 className="text-xl font-bold text-white mt-2">Error de Conexión</h3>
                  ) : (
                    <h3 className="text-3xl font-black text-white">
                      {esPostpago && billeteraData.saldo < 0 ? formatearMoneda(Math.abs(billeteraData.saldo)) : formatearMoneda(billeteraData.saldo)}
                    </h3>
                  )}
                  <p className="text-[10px] text-blue-200 mt-1">
                    {esPostpago && billeteraData.saldo < 0 ? 'A abonar según liquidación' : 
                     billeteraData.saldo < 0 ? 'Saldo en contra (Deuda con Shipro)' : 
                     billeteraData.saldo > 0 ? 'Saldo a favor disponible para operar' : 'Cuenta en cero'}
                  </p>
                </div>
                <div className="mt-4">
                  <button onClick={informarPago} disabled={errorApi || cargando} className="w-full text-xs font-bold bg-white text-slate-900 px-4 py-2.5 rounded-lg hover:bg-gray-100 transition-colors shadow-sm disabled:opacity-50">
                    {esPostpago ? 'Informar Pago' : 'Cargar Saldo'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ================= NUEVO: TABLA DE LIQUIDACIONES ================= */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-cyan-50/30">
              <h3 className="text-lg font-bold text-[#233b6b] flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" /> Mis Liquidaciones (Proformas)
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                    <th className="px-6 py-4">Proforma Nro</th>
                    <th className="px-6 py-4">Período</th>
                    <th className="px-6 py-4 text-right">Monto Total</th>
                    <th className="px-6 py-4 text-center">Factura AFIP</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100">
                  {cargando ? (
                    <tr><td colSpan={4} className="py-12 text-center text-gray-400">Cargando liquidaciones...</td></tr>
                  ) : billeteraData.liquidaciones && billeteraData.liquidaciones.length === 0 ? (
                    <tr><td colSpan={4} className="py-12 text-center text-gray-500 font-medium">No tenés liquidaciones cerradas aún.</td></tr>
                  ) : (
                    billeteraData.liquidaciones?.map((liq) => (
                      <tr key={liq.id} className="transition-colors hover:bg-gray-50">
                        <td className="px-6 py-4 font-mono font-black text-[#233b6b]">LIQ-{String(liq.id).padStart(4, '0')}</td>
                        <td className="px-6 py-4 font-bold text-gray-700">{liq.periodo}</td>
                        <td className="px-6 py-4 text-right font-black text-gray-800">{formatearMoneda(liq.montoTotal)}</td>
                        <td className="px-6 py-4 text-center">
                          {liq.facturaXubioUrl ? (
                             <a href={liq.facturaXubioUrl} target="_blank" className="text-green-600 hover:text-green-800 font-bold text-xs inline-flex items-center gap-1 bg-green-50 px-3 py-1.5 rounded transition-colors">
                               <Download className="w-3.5 h-3.5" /> Descargar Factura
                             </a>
                          ) : (
                             <span className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1.5 rounded">Pendiente de Emisión</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ================= EXTRACTO BANCARIO ================= */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-gray-400" /> Movimientos Diarios (Cuenta Corriente)
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4">Concepto</th>
                    <th className="px-6 py-4">Referencia</th>
                    <th className="px-6 py-4 text-right">Monto</th>
                    <th className="px-6 py-4 text-right">Saldo Resultante</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100">
                  {cargando ? (
                    <tr><td colSpan={5} className="py-12 text-center text-gray-400"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />Obteniendo movimientos...</td></tr>
                  ) : errorApi ? (
                    <tr><td colSpan={5} className="py-16 text-center text-red-500 font-medium"><AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-200" /><h3 className="text-lg font-bold text-gray-800 mb-1">Error Interno</h3></td></tr>
                  ) : billeteraData.movimientos.length === 0 ? (
                    <tr><td colSpan={5} className="py-12 text-center text-gray-500 font-medium">No hay movimientos registrados en tu billetera virtual.</td></tr>
                  ) : (
                    billeteraData.movimientos.map((mov) => {
                      const esDebito = mov.monto < 0;
                      return (
                        <tr key={mov.id} className="transition-colors hover:bg-gray-50">
                          <td className="px-6 py-4 text-gray-600 font-medium text-xs">{formatearFecha(mov.fecha)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {esDebito ? <ArrowDownRight className="w-4 h-4 text-red-500" /> : <ArrowUpRight className="w-4 h-4 text-green-500" />}
                              <span className="font-bold text-gray-800">{mov.descripcion || mov.tipo}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-gray-500 bg-gray-50 rounded px-2">{mov.referencia || "-"}</td>
                          <td className={`px-6 py-4 text-right font-black ${esDebito ? 'text-red-600' : 'text-green-600'}`}>
                            {formatearMoneda(mov.monto)}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-600">
                            {formatearMoneda(mov.saldoPosterior)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}