"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { UploadCloud, ShieldCheck, Scale, AlertTriangle, Loader2, FileSpreadsheet, CheckCircle2, DollarSign } from "lucide-react";

export default function ConciliacionAforos() {
  const [cargando, setCargando] = useState(false);
  const [datosExcel, setDatosExcel] = useState<any[]>([]);
  const [referenciaFactura, setReferenciaFactura] = useState("");
  const [resultado, setResultado] = useState<any>(null);
  const [errorTexto, setErrorTexto] = useState<string | null>(null);

  const brandColor = '#233b6b';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorTexto(null);
    setResultado(null);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(sheet);

        const filasNormalizadas = rawJson.map((row: any) => {
          let tracking = "";
          let peso = 0;
          let costo = 0;

          for (const key in row) {
            const lowKey = key.toLowerCase();
            const val = row[key];

            if (lowKey === "tracking" || lowKey.includes("guia") || lowKey.includes("remito") || lowKey === "numero_paquete" || (lowKey.includes("paquete") && !lowKey.includes("cantidad") && !lowKey.includes("valor"))) {
              if (String(val).length > 4) tracking = String(val);
            }
            if (lowKey.includes("peso") || lowKey.includes("kilo") || lowKey.includes("aforo") || lowKey.includes("volumen")) {
              let p = parseFloat(val);
              if (!isNaN(p)) {
                if (p > 150) p = p / 1000; 
                peso = p;
              }
            }
            if (lowKey.includes("total") || lowKey.includes("importe") || lowKey === "costo" || lowKey === "mocis" || lowKey === "andreani" || lowKey === "envio") {
              let c = parseFloat(val);
              if (!isNaN(c) && c > costo) costo = c;
            }
          }
          return { tracking, peso, costo };
        }).filter(f => f.tracking && f.peso > 0 && f.costo > 0);

        if (filasNormalizadas.length === 0) setErrorTexto("No se detectaron columnas válidas en el Excel.");
        else setDatosExcel(filasNormalizadas);

      } catch (err) {
        setErrorTexto("Error al leer el archivo. Asegurate de que sea .xlsx o .csv");
      }
    };
    reader.readAsBinaryString(file);
  };

  const ejecutarConciliacion = async () => {
    if (datosExcel.length === 0) return;
    if (!referenciaFactura.trim()) {
      setErrorTexto("Debes ingresar el Nro. de Factura del Courier para poder auditar.");
      return;
    }
    
    setCargando(true);
    setResultado(null);

    try {
      const res = await fetch("/api/conciliacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filasExcel: datosExcel, referenciaFactura: referenciaFactura.trim() })
      });

      const data = await res.json();
      if (res.ok) {
        setResultado(data);
        setDatosExcel([]); 
        setReferenciaFactura("");
      } else {
        setErrorTexto(data.error || "Error al procesar la conciliación.");
      }
    } catch (err) {
      setErrorTexto("Error de conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  };

  const formatMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Motor de Escudo Tarifario</h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Validá la facturación de los couriers. Lo correcto se envía a los clientes, los errores quedan en cuarentena.
            </p>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-5xl mx-auto w-full space-y-6">
        
        {!resultado && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center">
            <div className="max-w-md mx-auto">
              <FileSpreadsheet className="w-16 h-16 text-[#233b6b] mx-auto mb-4 opacity-80" />
              <h3 className="text-lg font-bold text-gray-800 mb-2">Importar Liquidación del Courier</h3>
              
              <div className="mb-6 text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Nro de Factura del Courier (Obligatorio) *</label>
                <input 
                  type="text" 
                  value={referenciaFactura}
                  onChange={(e) => setReferenciaFactura(e.target.value)}
                  placeholder="Ej: FC-0004-00001234"
                  className="w-full border-2 border-gray-200 rounded-lg p-3 text-sm font-bold focus:border-[#233b6b] outline-none"
                />
                <p className="text-[10px] text-gray-400 mt-1">Este dato es clave para que el sistema bloquee cobros duplicados en el futuro.</p>
              </div>
              
              <label className={`relative cursor-pointer text-white font-bold py-3 px-6 rounded-xl transition-colors inline-flex items-center gap-2 shadow-sm ${!referenciaFactura.trim() ? 'bg-gray-400 pointer-events-none' : 'bg-[#233b6b] hover:bg-blue-900'}`}>
                <UploadCloud className="w-5 h-5" /> Seleccionar Archivo Excel/CSV
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={!referenciaFactura.trim()} className="hidden" />
              </label>
            </div>
            
            {errorTexto && (
              <div className="mt-6 bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 flex items-center justify-center gap-2 text-sm font-bold">
                <AlertTriangle className="w-4 h-4" /> {errorTexto}
              </div>
            )}
          </div>
        )}

        {datosExcel.length > 0 && !resultado && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Scale className="w-5 h-5 text-amber-500" /> Archivo Listo para Procesar
                </h3>
                <p className="text-sm text-gray-500">Se detectaron <strong>{datosExcel.length}</strong> envíos a auditar en la Factura {referenciaFactura}.</p>
              </div>
              <button 
                onClick={ejecutarConciliacion}
                disabled={cargando}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-xl transition-colors inline-flex items-center gap-2 shadow-md disabled:opacity-50"
              >
                {cargando ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                {cargando ? "Ejecutando escudos..." : "Ejecutar Escudo Tarifario"}
              </button>
            </div>

            <div className="bg-slate-50 border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 sticky top-0 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase">
                  <tr>
                    <th className="px-6 py-3">Tracking Reconocido</th>
                    <th className="px-6 py-3">Peso Facturado</th>
                    <th className="px-6 py-3">Importe Facturado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {datosExcel.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      <td className="px-6 py-2 font-mono text-[#233b6b] font-bold">{row.tracking}</td>
                      <td className="px-6 py-2">{row.peso} kg</td>
                      <td className="px-6 py-2">{formatMoneda(row.costo)}</td>
                    </tr>
                  ))}
                  {datosExcel.length > 10 && (
                    <tr><td colSpan={3} className="px-6 py-3 text-center text-gray-400 font-medium italic">Y {datosExcel.length - 10} filas más...</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {resultado && (
          <div className="animate-in zoom-in-95 space-y-6">
            
            <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-l-blue-500">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-6 h-6 text-blue-500" /> Resultados del Procesamiento
              </h2>
              <p className="text-sm text-gray-500">Se analizaron {resultado.procesados} envíos. La información fue derivada a los canales correspondientes.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* CANAL 1: CLIENTES */}
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-blue-600 p-2 rounded-lg text-white"><CheckCircle2 className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-black text-blue-900 text-lg">Bandeja de Clientes</h3>
                    <p className="text-xs font-bold text-blue-700">Listos para facturar en Liquidaciones</p>
                  </div>
                </div>
                <div className="bg-white rounded-xl p-5 border border-blue-100 shadow-sm">
                  <p className="text-4xl font-black text-blue-600">{resultado.aprobadosParaCliente}</p>
                  <p className="text-sm font-bold text-gray-500 mt-1">Envíos validados y aprobados.</p>
                </div>
              </div>

              {/* CANAL 2: RECLAMOS INTERNOS */}
              <div className="bg-red-50 p-6 rounded-2xl border border-red-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-red-600 p-2 rounded-lg text-white"><ShieldCheck className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-black text-red-900 text-lg">Cuarentena de Couriers</h3>
                    <p className="text-xs font-bold text-red-700">Envíos frenados por errores del proveedor</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="bg-white rounded-xl p-4 border border-red-100 shadow-sm flex justify-between items-center">
                    <div>
                      <p className="text-sm font-black text-gray-800">Doble Cobro (Fraudes)</p>
                      <p className="text-xs text-gray-500">Trackings ya liquidados</p>
                    </div>
                    <span className="text-xl font-black text-red-600">{resultado.alertasDobleCobro}</span>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-red-100 shadow-sm flex justify-between items-center">
                    <div>
                      <p className="text-sm font-black text-gray-800">Sobreprecios de Tarifario</p>
                      <p className="text-xs text-gray-500">Cobraron más de lo pactado</p>
                    </div>
                    <span className="text-xl font-black text-red-600">{resultado.alertasSobreprecio}</span>
                  </div>
                  <div className="bg-[#233b6b] rounded-xl p-4 shadow-sm flex justify-between items-center text-white mt-2">
                    <p className="text-sm font-bold">Total a Exigir (NC)</p>
                    <span className="text-xl font-black">{formatMoneda(resultado.montoARecuperar)}</span>
                  </div>
                </div>
              </div>

            </div>

            <div className="text-center pt-4">
              <button 
                onClick={() => { setResultado(null); setDatosExcel([]); }}
                className="text-[#233b6b] font-bold hover:underline"
              >
                Volver al inicio
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}