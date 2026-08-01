"use client";

// FASE 2 sub 2a (2026-08-01): pantalla admin del markup Shipro GLOBAL con
// vigencias. Mirror del patrón de admin-finanzas (useEffect fetch → form →
// POST → alert() → reload). Ver docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md.
// Este screen escribe historia; el motor de plata aún no lee esta tabla.

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Percent,
  Loader2,
  CheckCircle2,
  History,
  Save,
  ShieldAlert,
} from "lucide-react";

type Vigencia = {
  id: number;
  valorPorcentaje: string;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
  createdAt: string;
};

export default function AdminParametrosTarifa() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [activa, setActiva] = useState<Vigencia | null>(null);
  const [historial, setHistorial] = useState<Vigencia[]>([]);
  const [nuevoValor, setNuevoValor] = useState("");

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/markup-shipro");
      if (res.ok) {
        const data = await res.json();
        setActiva(data.activa);
        setHistorial(data.historial || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (esAdminShipro) cargar();
    else setCargando(false);
  }, [esAdminShipro]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = parseFloat(nuevoValor);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      alert("Ingresá un porcentaje válido entre 0 y 100.");
      return;
    }

    const actualStr = activa ? `${Number(activa.valorPorcentaje)}%` : "sin vigencia activa";
    const ok = confirm(
      `Vas a crear una nueva vigencia del markup Shipro global con valor ${valor}%. ` +
        `La vigencia actual (${actualStr}) queda jubilada (activo=false, vigenciaHasta=hoy) — ` +
        `es un asiento inverso, nunca se pisa el valor anterior. ¿Confirmás?`
    );
    if (!ok) return;

    setGuardando(true);
    try {
      const res = await fetch("/api/admin/markup-shipro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorPorcentaje: valor }),
      });
      if (res.ok) {
        alert("Nueva vigencia guardada.");
        setNuevoValor("");
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar");
      }
    } catch (e) {
      alert("Error de conexión");
    } finally {
      setGuardando(false);
    }
  };

  const fmtFecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "—";
  const fmtPct = (v: string) => `${Number(v)}%`;

  if (!esAdminShipro) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 p-8">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-100 max-w-md text-center">
          <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800 mb-1">Acceso restringido</h3>
          <p className="text-sm text-gray-500">
            Esta pantalla es solo para <strong>admin_shipro</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-blue-50 text-[#233b6b] border border-blue-100">
            <Percent className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">
              Parámetros de Tarifa
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Markup Shipro global — editable con vigencias (asiento inverso).
            </p>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            Markup Shipro global (vigente)
          </h3>

          {cargando ? (
            <div className="py-12 text-center text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando…
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
                  Valor vigente
                </p>
                <p className="text-4xl font-black text-[#233b6b]">
                  {activa ? fmtPct(activa.valorPorcentaje) : "—"}
                </p>
                <p className="text-xs text-blue-700 mt-2">
                  Vigente desde: {activa ? fmtFecha(activa.vigenciaDesde) : "—"}
                </p>
              </div>
              <form
                onSubmit={guardar}
                className="bg-slate-50 border border-slate-100 rounded-xl p-5 flex flex-col gap-3"
              >
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Nuevo valor (%)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  max="100"
                  required
                  value={nuevoValor}
                  onChange={(e) => setNuevoValor(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg p-3 text-lg font-black text-gray-800 focus:border-blue-500 outline-none"
                  placeholder="Ej: 12.5"
                />
                <button
                  type="submit"
                  disabled={guardando}
                  className="py-3 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-blue-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {guardando ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                  Guardar nuevo valor
                </button>
                <p className="text-[10px] text-gray-500">
                  Cierra la vigencia actual y crea una nueva. Nunca sobrescribe.
                </p>
              </form>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center gap-2">
            <History className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-bold text-gray-800">Historial de vigencias</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                <tr>
                  <th className="px-6 py-4">Valor</th>
                  <th className="px-6 py-4">Vigencia desde</th>
                  <th className="px-6 py-4">Vigencia hasta</th>
                  <th className="px-6 py-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {historial.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400">
                      Sin vigencias todavía.
                    </td>
                  </tr>
                ) : (
                  historial.map((h) => (
                    <tr key={h.id} className={h.activo ? "bg-emerald-50/40" : ""}>
                      <td className="px-6 py-3 font-bold text-gray-800">
                        {fmtPct(h.valorPorcentaje)}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {fmtFecha(h.vigenciaDesde)}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {fmtFecha(h.vigenciaHasta)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        {h.activo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">
                            <CheckCircle2 className="w-3 h-3" /> Vigente
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-1 rounded bg-gray-100 text-gray-500 text-[10px] font-bold uppercase">
                            Jubilada
                          </span>
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
