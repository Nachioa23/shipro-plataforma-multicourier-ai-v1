"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { UploadCloud, ShieldCheck, Scale, AlertTriangle, Loader2, FileSpreadsheet, CheckCircle2, DollarSign, Undo2, ShieldAlert, Info } from "lucide-react";

export default function ConciliacionAforos() {
  const [cargando, setCargando] = useState(false);
  const [datosExcel, setDatosExcel] = useState<any[]>([]);
  const [referenciaFactura, setReferenciaFactura] = useState("");
  // Nacho: la convención IVA del Excel se declara explícita, no se asume.
  // Sin default. El backend rechaza con 400 si no viene "SIN_IVA" o "CON_IVA".
  const [ivaDeclarado, setIvaDeclarado] = useState<"" | "SIN_IVA" | "CON_IVA">("");
  const [resultado, setResultado] = useState<any>(null);
  const [errorTexto, setErrorTexto] = useState<string | null>(null);
  // Undo state
  const [confirmandoUndo, setConfirmandoUndo] = useState(false);
  const [ejecutandoUndo, setEjecutandoUndo] = useState(false);
  const [undoResultado, setUndoResultado] = useState<{ restauradas: number } | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

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
    if (!ivaDeclarado) {
      setErrorTexto("Tenés que declarar si los costos del archivo incluyen IVA o no antes de auditar.");
      return;
    }

    setCargando(true);
    setResultado(null);
    setErrorTexto(null);

    try {
      const res = await fetch("/api/conciliacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filasExcel: datosExcel,
          referenciaFactura: referenciaFactura.trim(),
          ivaDeclarado,
        })
      });

      const data = await res.json();
      if (res.ok) {
        setResultado(data);
        setDatosExcel([]);
        setReferenciaFactura("");
        setIvaDeclarado("");
      } else {
        setErrorTexto(data.error || "Error al procesar la conciliación.");
      }
    } catch (err) {
      setErrorTexto("Error de conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  };

  const ejecutarUndo = async () => {
    if (!resultado?.runId) return;
    setEjecutandoUndo(true);
    setUndoError(null);
    try {
      const res = await fetch("/api/conciliacion/revertir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: resultado.runId }),
      });
      const data = await res.json();
      if (res.ok) {
        setUndoResultado({ restauradas: data.restauradas });
        setConfirmandoUndo(false);
      } else {
        // Surface exactly what el server dice — para el 409 de mes cerrado y
        // el 409 de "ya fue revertida" el mensaje ya viene explicativo.
        setUndoError(data.error || "No se pudo revertir la conciliación.");
      }
    } catch (err) {
      setUndoError("Error de conexión al intentar revertir.");
    } finally {
      setEjecutandoUndo(false);
    }
  };

  const reiniciar = () => {
    setResultado(null);
    setDatosExcel([]);
    setReferenciaFactura("");
    setIvaDeclarado("");
    setConfirmandoUndo(false);
    setUndoResultado(null);
    setUndoError(null);
    setErrorTexto(null);
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

              {/* IVA declarado (Obligatorio) — sin default: el usuario elige a conciencia. */}
              <div className="mb-6 text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Convención IVA del archivo (Obligatorio) *</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 border-2 rounded-lg p-3 cursor-pointer transition-colors ${ivaDeclarado === "SIN_IVA" ? "border-[#233b6b] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                    <input
                      type="radio"
                      name="ivaDeclarado"
                      value="SIN_IVA"
                      checked={ivaDeclarado === "SIN_IVA"}
                      onChange={() => setIvaDeclarado("SIN_IVA")}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="font-bold text-gray-800">Los costos del archivo NO incluyen IVA (neto)</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-3 border-2 rounded-lg p-3 cursor-pointer transition-colors ${ivaDeclarado === "CON_IVA" ? "border-[#233b6b] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                    <input
                      type="radio"
                      name="ivaDeclarado"
                      value="CON_IVA"
                      checked={ivaDeclarado === "CON_IVA"}
                      onChange={() => setIvaDeclarado("CON_IVA")}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="font-bold text-gray-800">Los costos del archivo YA incluyen IVA</span>
                    </span>
                  </label>
                </div>
                <p className="text-[10px] text-gray-500 mt-2 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>La factura del courier suele mostrar ambas columnas; elegí la que corresponde a la columna de costo que subiste.</span>
                </p>
              </div>

              {(() => {
                const listo = referenciaFactura.trim() && ivaDeclarado;
                return (
                  <>
                    <label className={`relative cursor-pointer text-white font-bold py-3 px-6 rounded-xl transition-colors inline-flex items-center gap-2 shadow-sm ${!listo ? 'bg-gray-400 pointer-events-none' : 'bg-[#233b6b] hover:bg-blue-900'}`}>
                      <UploadCloud className="w-5 h-5" /> Seleccionar Archivo Excel/CSV
                      <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={!listo} className="hidden" />
                    </label>
                    {!listo && (
                      <p className="text-xs text-gray-500 mt-2">
                        {!referenciaFactura.trim() && !ivaDeclarado
                          ? "Completá el Nro. de Factura y elegí la convención IVA para poder subir el archivo."
                          : !referenciaFactura.trim()
                          ? "Completá el Nro. de Factura para poder subir el archivo."
                          : "Elegí la convención IVA del archivo para poder subir."}
                      </p>
                    )}
                  </>
                );
              })()}
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
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={ejecutarConciliacion}
                  disabled={cargando || !ivaDeclarado || !referenciaFactura.trim()}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-xl transition-colors inline-flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cargando ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  {cargando ? "Ejecutando escudos..." : "Ejecutar Escudo Tarifario"}
                </button>
                {!cargando && (!ivaDeclarado || !referenciaFactura.trim()) && (
                  <p className="text-[11px] text-amber-700 font-medium">
                    {!referenciaFactura.trim() && !ivaDeclarado
                      ? "Falta Nro. de Factura y convención IVA."
                      : !referenciaFactura.trim()
                      ? "Falta Nro. de Factura."
                      : "Falta declarar la convención IVA del archivo."}
                  </p>
                )}
              </div>
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

        {resultado && undoResultado && (
          <div className="animate-in zoom-in-95">
            <div className="bg-emerald-50 border-2 border-emerald-300 p-8 rounded-2xl text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto mb-3" />
              <h2 className="text-2xl font-black text-emerald-900 mb-2">Reversión exitosa</h2>
              <p className="text-emerald-800 font-medium">
                Se restauraron <strong>{undoResultado.restauradas}</strong> envío(s) a su estado previo.
                La marca de factura quedó liberada — ya podés subir un archivo corregido.
              </p>
              <button
                onClick={reiniciar}
                className="mt-6 bg-[#233b6b] hover:bg-blue-900 text-white font-bold py-3 px-6 rounded-xl inline-flex items-center gap-2 shadow-md"
              >
                <UploadCloud className="w-5 h-5" /> Subir un archivo corregido
              </button>
            </div>
          </div>
        )}

        {resultado && !undoResultado && (
          <div className="animate-in zoom-in-95 space-y-6">

            {/* WARNING: posible IVA no declarado (Nacho: no bloquea, pero es prominente). */}
            {resultado.advertenciaPosibleIva && (
              <div className="bg-amber-50 border-2 border-amber-400 p-5 rounded-2xl flex items-start gap-4 shadow-sm">
                <ShieldAlert className="w-8 h-8 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-black text-amber-900 text-base mb-1">
                    ¿El archivo incluía IVA?
                  </h3>
                  <p className="text-sm text-amber-900">
                    Declaraste que los costos venían SIN IVA, pero <strong>{resultado.rowsSospechosasIva} de {resultado.rowsEnMainBranch}</strong> filas
                    muestran un costo que supera en más de 15% al esperado, sin que haya subido el peso.
                    Es un patrón típico de un archivo que en realidad viene CON IVA.
                  </p>
                  <p className="text-sm text-amber-900 mt-2 font-medium">
                    Revisá el archivo. Si te equivocaste al declarar, usá <strong>"Deshacer"</strong> abajo y volvé a subirlo con la convención correcta.
                  </p>
                </div>
              </div>
            )}

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

            {/* runId + botón Deshacer — siempre que la corrida haya persistido un ConciliacionRun. */}
            {resultado.runId && (
              <div className="bg-white p-5 rounded-2xl border-2 border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="text-sm">
                  <p className="text-gray-500">Corrida registrada</p>
                  <p className="font-mono text-lg font-black text-gray-800">RUN-{String(resultado.runId).padStart(6, "0")}</p>
                  <p className="text-[11px] text-gray-500 mt-1">Si detectaste un error (IVA equivocado, archivo cambiado, etc.), podés deshacer esta corrida y volver a subir.</p>
                </div>
                <button
                  onClick={() => { setConfirmandoUndo(true); setUndoError(null); }}
                  disabled={ejecutandoUndo}
                  className="bg-red-100 hover:bg-red-200 text-red-800 font-bold py-2 px-4 rounded-xl inline-flex items-center gap-2 border-2 border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Undo2 className="w-4 h-4" /> Deshacer esta conciliación
                </button>
              </div>
            )}

            <div className="text-center pt-4">
              <button
                onClick={reiniciar}
                className="text-[#233b6b] font-bold hover:underline"
              >
                Volver al inicio
              </button>
            </div>
          </div>
        )}

        {/* Modal de confirmación del Undo (overlay). */}
        {confirmandoUndo && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl">
              <div className="flex items-start gap-4 mb-4">
                <div className="bg-red-100 p-2 rounded-xl">
                  <Undo2 className="w-6 h-6 text-red-700" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-800">¿Deshacer la conciliación?</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Esta acción restaura los valores previos de los envíos de esta corrida
                    (peso aforado, costo esperado, costo facturado, estado de auditoría, referencia de factura
                    y costo de aforo) y libera la marca de factura para poder reimportar el archivo corregido.
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    No se puede deshacer si algún envío de esta corrida ya fue cerrado en una liquidación mensual.
                    En ese caso, el servidor devuelve un aviso y hay que corregir con un ajuste, no con reversión.
                  </p>
                </div>
              </div>

              {undoError && (
                <div className="bg-red-50 border-2 border-red-300 text-red-800 p-4 rounded-xl text-sm font-medium mb-4 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{undoError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setConfirmandoUndo(false); setUndoError(null); }}
                  disabled={ejecutandoUndo}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={ejecutarUndo}
                  disabled={ejecutandoUndo}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-xl inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {ejecutandoUndo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                  {ejecutandoUndo ? "Deshaciendo..." : "Sí, deshacer"}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}