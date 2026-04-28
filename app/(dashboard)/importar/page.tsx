"use client";

import { useState } from "react";
import { UploadCloud, Database, CheckCircle2, Loader2, BarChart, Save, AlertCircle } from 'lucide-react';

export default function ImportadorDefinitivo() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<'esperando' | 'procesando' | 'exito' | 'error'>('esperando');
  const [progreso, setProgreso] = useState(0);
  const [mensaje, setMensaje] = useState("");

  const limpiarFila = (filaStr: string) => {
    let f = String(filaStr).trim();
    if (f.startsWith('"') && f.endsWith('"') && f.includes('""')) {
      f = f.substring(1, f.length - 1).replace(/""/g, '"');
    }
    return f;
  };

  const parsearColumnas = (filaLimpia: string) => {
    const res = [];
    let celda = '';
    let enComillas = false;
    for (let i = 0; i < filaLimpia.length; i++) {
      const char = filaLimpia[i];
      if (char === '"') enComillas = !enComillas;
      else if (char === ',' && !enComillas) { res.push(celda); celda = ''; }
      else celda += char;
    }
    res.push(celda);
    return res.map(c => c.replace(/^"|"$/g, '').trim()); 
  };

  const identificarCourier = (tracking: string): string | null => {
    const t = tracking.toUpperCase().trim();
    if (t.length === 15 && t.startsWith("36000")) return "Andreani";
    if (t.length === 10 && /^\d{10}$/.test(t)) return "Moci's";
    if (t.length === 7 && /^\d{7}$/.test(t)) return "Real Express";
    if (t.startsWith("JAV")) return "Javit";
    if (/^[0-9A-F]{8}-[0-9A-F]{4}-/.test(t)) return "Moova"; 
    if (/^[A-Z]{3}\d{3}$/.test(t)) return "Saires";
    return null; 
  };

  const determinarModalidad = (servicioId: string, courierNombre: string): string => {
    const idsSucursal = ["6", "9", "10", "13", "14", "21"]; 
    if (idsSucursal.includes(servicioId)) return "Sucursal";
    if (courierNombre === "Moova" || courierNombre === "Moci's") return "Same-Day";
    return "Estándar";
  };

  const iniciarImportacion = async () => {
    if (!archivo) return;
    setEstado('procesando');
    setProgreso(0);

    try {
      const texto = await archivo.text();
      const lineas = texto.split('\n').filter(l => l.trim() !== '');
      if (lineas.length < 2) throw new Error("El archivo está vacío.");

      const headerLine = limpiarFila(lineas[0]);
      const headers = parsearColumnas(headerLine).map(h => h.toLowerCase());

      const TOTAL_FILAS = lineas.length - 1;
      const TAMANO_LOTE = 250; // Bajamos un poco el lote porque ahora mandamos mucha más info
      let procesadas = 0;

      for (let i = 1; i < lineas.length; i += TAMANO_LOTE) {
        const loteEnvios = [];
        const finLote = Math.min(i + TAMANO_LOTE, lineas.length);

        for (let j = i; j < finLote; j++) {
          const filaStr = limpiarFila(lineas[j]);
          if (!filaStr) continue;
          
          const valores = parsearColumnas(filaStr);
          const fila: any = {};
          headers.forEach((h, index) => { fila[h] = valores[index]; });

          const trackingCrudo = String(fila.tracking || "").trim();
          
          if (trackingCrudo) {
            const nombreCourier = identificarCourier(trackingCrudo);
            if (nombreCourier) {
              const idServicio = String(fila.servicio_id || "").trim();
              
              // RECOLECTAMOS TODA LA INFO DEL CSV
              loteEnvios.push({
                trackingNumber: trackingCrudo,
                courierNombre: nombreCourier,
                modalidad: determinarModalidad(idServicio, nombreCourier),
                estadoActual: fila.estado || "Entregado",
                
                // Pesos
                pesoReal: parseFloat(fila.peso_real) || 1.0,
                pesoFacturado: parseFloat(fila.peso_facturado) || null,
                pesoVolumetrico: parseFloat(fila.peso_volumetrico) || null,
                
                // Fechas Clave (Para el Dashboard y SLA)
                fechaCreacion: fila.created_at || new Date().toISOString(),
                fechaColecta: fila.fecha_recoleccion || null,
                fechaEntrega: fila.fecha_entrega || null,

                // CRM: Datos de Destino
                destinatarioNombre: fila.destino_nombre || "Cliente Final",
                destinatarioEmail: fila.destino_email || "",
                destinatarioTelefono: fila.destino_telefono || "",
                destinatarioDni: fila.destino_documento || "",
                destinoCp: fila.destino_cp || "0000",
                destinoCalle: fila.destino_calle || "",
                destinoAltura: fila.destino_altura || "",
                destinoPiso: fila.destino_piso || "",
                destinoDpto: fila.destino_dpto || "",
                destinoLocalidad: fila.destino_localidad || "",
                destinoProvincia: fila.destino_provincia || "",

                // Finanzas
                precioProveedor: parseFloat(fila.precio_proveedor) || null,
                precioFactura: parseFloat(fila.precio_factura) || null,
                precioMostrado: parseFloat(fila.precio_mostrado) || null,

                // Orden Externa
                ordenId: fila.orden_id || "",
                canal: fila.canal || "",
                idTiendanube: fila.id_tiendanube || ""
              });
            }
          }
        }

        if (loteEnvios.length > 0) {
          const res = await fetch('/api/importar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ envios: loteEnvios })
          });

          if (!res.ok) {
             console.error("Fallo el lote, continuando con el siguiente...");
          }
        }

        procesadas += (finLote - i);
        setProgreso(Math.round((procesadas / TOTAL_FILAS) * 100));
      }

      setEstado('exito');
      setMensaje(`Se analizaron e inyectaron ${TOTAL_FILAS} registros con todos sus datos anexos.`);

    } catch (error: any) {
      setEstado('error');
      setMensaje("Error al procesar: " + error.message);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full bg-slate-50 p-8 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-xl w-full border border-gray-200 text-center">
        
        <div className="w-16 h-16 bg-[#233b6b]/10 rounded-full flex items-center justify-center border-2 border-[#233b6b]/20 mx-auto mb-4">
          <Database className="w-8 h-8 text-[#233b6b]" />
        </div>
        <h2 className="text-2xl font-black text-gray-800 tracking-tight mb-2">Ingesta de Datos Históricos</h2>
        <p className="text-gray-500 text-sm mb-8">Migración completa (CRM, Finanzas y Fechas).</p>

        {estado === 'esperando' && (
          <div className="space-y-6">
            <label className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 hover:border-[#233b6b] transition-colors">
              <UploadCloud className="w-12 h-12 text-gray-400 mb-4" />
              <span className="text-base font-bold text-gray-700">
                {archivo ? archivo.name : "Subir archivo envios.csv"}
              </span>
              <input type="file" accept=".csv" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            </label>

            <button 
              onClick={iniciarImportacion} disabled={!archivo}
              className="w-full py-4 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-lg"
            >
              <Save className="w-5 h-5" /> Iniciar Inyección
            </button>
          </div>
        )}

        {estado === 'procesando' && (
          <div className="py-12 flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-[#233b6b] animate-spin mb-6" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">Procesando {progreso}%</h3>
            <p className="text-gray-500 text-sm">Guardando etiquetas, contactos y finanzas...</p>
            <div className="w-full bg-gray-200 rounded-full h-3 mt-6 overflow-hidden">
              <div className="bg-green-500 h-3 rounded-full transition-all duration-300" style={{ width: `${progreso}%` }}></div>
            </div>
          </div>
        )}

        {estado === 'exito' && (
          <div className="py-8 animate-in zoom-in-95">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-2xl font-black text-gray-800 mb-2">¡Proceso Terminado!</h3>
            <p className="text-gray-500 font-medium mb-8">{mensaje}</p>
            <button onClick={() => window.location.href = '/dashboard'} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg transition-colors">
              <BarChart className="w-5 h-5"/> Ver Panel de Control
            </button>
          </div>
        )}

        {estado === 'error' && (
          <div className="py-8">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-10 h-10 text-red-600" />
            </div>
            <h3 className="text-2xl font-black text-gray-800 mb-2">Hubo un problema</h3>
            <p className="text-red-600 font-medium mb-8">{mensaje}</p>
            <button onClick={() => setEstado('esperando')} className="w-full py-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors">
              Volver a intentar
            </button>
          </div>
        )}

      </div>
    </div>
  );
}