"use client";

import { useState, useEffect } from "react";
import { Landmark, Search, DollarSign, TrendingUp, TrendingDown, ArrowRightCircle, PlusCircle, Loader2, CheckCircle2, X } from "lucide-react";

export default function TorreControlFinanciera() {
  const brandColor = '#233b6b';
  
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  // Estados del Modal de Pagos
  const [modalAbierto, setModalAbierto] = useState(false);
  const [empresaSeleccionada, setEmpresaSeleccionada] = useState<any>(null);
  const [montoPago, setMontoPago] = useState("");
  const [referenciaPago, setReferenciaPago] = useState("");
  const [notasPago, setNotasPago] = useState("");
  const [procesandoPago, setProcesandoPago] = useState(false);

  const cargarFinanzas = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/finanzas");
      if (res.ok) {
        const data = await res.json();
        setEmpresas(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarFinanzas();
  }, []);

  const abrirModalPago = (empresa: any) => {
    setEmpresaSeleccionada(empresa);
    // Si la empresa tiene deuda (saldo negativo), autocompletamos el input con el monto exacto de la deuda
    setMontoPago(empresa.saldoActivo < 0 ? Math.abs(empresa.saldoActivo).toString() : "");
    setReferenciaPago("");
    setNotasPago("");
    setModalAbierto(true);
  };

  const registrarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!montoPago || isNaN(parseFloat(montoPago))) return;

    setProcesandoPago(true);
    try {
      const res = await fetch("/api/admin/finanzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresaId: empresaSeleccionada.id,
          monto: parseFloat(montoPago),
          referencia: referenciaPago,
          notas: notasPago
        })
      });

      if (res.ok) {
        alert("¡Pago acreditado con éxito!");
        setModalAbierto(false);
        cargarFinanzas(); // Recargamos la tabla para ver el saldo en cero
      } else {
        const data = await res.json();
        alert(data.error || "Error al registrar el pago");
      }
    } catch (error) {
      alert("Error de conexión");
    } finally {
      setProcesandoPago(false);
    }
  };

  const formatMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
  };

  // Cálculos Rápidos para KPIs
  const deudaEnCalle = empresas.filter(e => e.saldoActivo < 0).reduce((acc, e) => acc + Math.abs(e.saldoActivo), 0);
  const saldoAFavor = empresas.filter(e => e.saldoActivo > 0).reduce((acc, e) => acc + e.saldoActivo, 0);

  const empresasFiltradas = empresas.filter(e => 
    e.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
    e.cuit.includes(busqueda)
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-50 text-[#233b6b] border border-blue-100">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Caja General (Super Admin)</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Monitoreá la deuda de tus clientes y acreditá pagos manuales.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
        
        {/* KPIs GLOBALES */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <TrendingDown className="w-4 h-4 text-red-500" /> Deuda en la Calle (Por cobrar)
            </p>
            <h3 className="text-3xl font-black text-red-600">{formatMoneda(deudaEnCalle)}</h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-green-500" /> Saldos a Favor (Prepagos)
            </p>
            <h3 className="text-3xl font-black text-green-600">{formatMoneda(saldoAFavor)}</h3>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <DollarSign className="w-4 h-4 text-blue-500" /> Clientes Activos
            </p>
            <h3 className="text-3xl font-black text-gray-800">{empresas.length}</h3>
          </div>
        </div>

        {/* TABLA MAESTRA */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <h3 className="text-lg font-bold text-gray-800">Estado de Cuentas por Cliente</h3>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar por nombre o CUIT..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                <tr>
                  <th className="px-6 py-4">Cliente / Empresa</th>
                  <th className="px-6 py-4">Modalidad</th>
                  <th className="px-6 py-4 text-right">Saldo Actual</th>
                  <th className="px-6 py-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {cargando ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-gray-400">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Carga Financiera...
                    </td>
                  </tr>
                ) : empresasFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-gray-500">No se encontraron clientes.</td>
                  </tr>
                ) : (
                  empresasFiltradas.map((emp) => {
                    const debe = emp.saldoActivo < 0;
                    const aFavor = emp.saldoActivo > 0;
                    
                    return (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-bold text-gray-800">{emp.nombre}</p>
                          <p className="text-xs text-gray-500">CUIT: {emp.cuit}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${emp.modalidadPago === 'PREPAGO' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                            {emp.modalidadPago}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`text-lg font-black ${debe ? 'text-red-600' : aFavor ? 'text-green-600' : 'text-gray-400'}`}>
                            {formatMoneda(emp.saldoActivo)}
                          </span>
                          {debe && <p className="text-[10px] font-bold text-red-400 uppercase mt-1">Deuda Activa</p>}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button 
                            onClick={() => abrirModalPago(emp)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#233b6b] text-white font-bold text-xs rounded-lg hover:bg-blue-900 transition-colors shadow-sm"
                          >
                            <PlusCircle className="w-4 h-4" /> Acreditar Pago
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL DE ACREDITACIÓN DE PAGO */}
      {modalAbierto && empresaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
            <div className="p-5 bg-slate-50 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" /> Registrar Ingreso
              </h3>
              <button onClick={() => setModalAbierto(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={registrarPago} className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-4">
                <p className="text-xs text-blue-600 font-bold uppercase mb-1">Cliente</p>
                <p className="text-sm font-black text-blue-900">{empresaSeleccionada.nombre}</p>
                <p className="text-xs text-blue-700 mt-2">Saldo actual: <strong className={empresaSeleccionada.saldoActivo < 0 ? 'text-red-600' : 'text-green-600'}>{formatMoneda(empresaSeleccionada.saldoActivo)}</strong></p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Monto a Acreditar ($) *</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  value={montoPago} 
                  onChange={(e) => setMontoPago(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg p-3 text-lg font-black text-gray-800 focus:border-green-500 outline-none"
                  placeholder="Ej: 50000"
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Referencia (Ej: Nro Transferencia)</label>
                <input 
                  type="text" 
                  value={referenciaPago} 
                  onChange={(e) => setReferenciaPago(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:border-[#233b6b] outline-none"
                  placeholder="TR-987654321"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas Internas</label>
                <textarea 
                  value={notasPago} 
                  onChange={(e) => setNotasPago(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:border-[#233b6b] outline-none min-h-[80px]"
                  placeholder="Pago correspondiente a la liquidación de Mayo..."
                ></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setModalAbierto(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors">Cancelar</button>
                <button type="submit" disabled={procesandoPago} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
                  {procesandoPago ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} 
                  Confirmar Pago
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}