"use client";

// DEUDA 157 Paso 1 (2026-08-31): pantalla admin del markup Shipro GENERAL por
// courier con vigencias. Mirror de la pantalla del SMO por courier (admin-smo,
// FASE 2 sub 3), adaptada de "$ neto" a "% porcentual". Un valor por courier,
// igual para TODOS los clientes.
//
// DEUDA 157 Pieza 2 (2026-09-01): agregado toggle HEREDA/PROPIO por courier.
// - HEREDA: el courier sigue el markup global (MarkupShiproVigencia) en vivo;
//   el % de la fila queda deshabilitado y se muestra el global entre paréntesis.
// - PROPIO: el courier usa el % de la fila (editable, permite 0 — apagado
//   intencional, distinto de heredar 0).
// VALOR RECORDADO: aún en HEREDA se persiste el último valorPorcentaje que el
// user tenía en PROPIO, para que al volver a PROPIO se recupere sin re-tipear.
// El motor NO consume `modo` todavía — se conecta en Pieza 3 (aislamiento
// intencional). Editar acá hoy no cambia precios.

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Percent,
  Loader2,
  CheckCircle2,
  History,
  Save,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type ModoMarkup = "HEREDA" | "PROPIO";

type Vigencia = {
  id: number;
  courierId: number;
  valorPorcentaje: string;
  modo: ModoMarkup;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
  createdAt: string;
};

type Fila = {
  courier: { id: number; nombre: string };
  activa: Vigencia | null;
  historial: Vigencia[];
};

type GlobalActivo = {
  id: number;
  valorPorcentaje: string;
  vigenciaDesde: string;
} | null;

export default function AdminMarkupCourier() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [globalActivo, setGlobalActivo] = useState<GlobalActivo>(null);
  const [nuevoValor, setNuevoValor] = useState<Record<number, string>>({});
  const [nuevoModo, setNuevoModo] = useState<Record<number, ModoMarkup>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [expandido, setExpandido] = useState<Record<number, boolean>>({});

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/markup-courier");
      if (res.ok) {
        const data = await res.json();
        const filasResp: Fila[] = data.filas || [];
        setFilas(filasResp);
        setGlobalActivo(data.globalActivo ?? null);
        // Prefill state per-courier con lo que ya tiene la vigencia activa
        // (modo + valor). Si no hay vigencia activa: default HEREDA + valor "".
        const valores: Record<number, string> = {};
        const modos: Record<number, ModoMarkup> = {};
        for (const f of filasResp) {
          valores[f.courier.id] = f.activa ? String(f.activa.valorPorcentaje) : "";
          modos[f.courier.id] = f.activa ? f.activa.modo : "HEREDA";
        }
        setNuevoValor(valores);
        setNuevoModo(modos);
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

  const guardar = async (fila: Fila) => {
    const courierId = fila.courier.id;
    const modo = nuevoModo[courierId] || "HEREDA";
    const rawValor = nuevoValor[courierId] || "";
    // VALOR RECORDADO: aún en HEREDA persistimos un número (schema NOT NULL).
    // Si el input está vacío en HEREDA, guardamos 0 como placeholder — el
    // motor no lo consume en HEREDA (consulta el global). Si está vacío en
    // PROPIO, bloqueamos (PROPIO exige un número explícito).
    let valor: number;
    if (modo === "PROPIO") {
      valor = parseFloat(rawValor);
      if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
        alert("En modo PROPIO ingresá un porcentaje válido entre 0 y 100 (0 = markup apagado a propósito).");
        return;
      }
    } else {
      // HEREDA: preservar el valor del input si es válido; si vacío, 0.
      const parsed = parseFloat(rawValor);
      valor = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
    }

    const previaStr = fila.activa
      ? `${fila.activa.modo} ${Number(fila.activa.valorPorcentaje).toFixed(4)}%`
      : "sin vigencia activa";
    const globalHint = globalActivo
      ? ` (global vigente: ${Number(globalActivo.valorPorcentaje).toFixed(4)}%)`
      : "";
    const nuevaStr =
      modo === "HEREDA"
        ? `HEREDA${globalHint}`
        : `PROPIO ${valor.toFixed(4)}%${valor === 0 ? " — markup apagado a propósito" : ""}`;
    const ok = confirm(
      `Vas a crear una nueva vigencia de markup Shipro para ${fila.courier.nombre}:\n` +
        `  Anterior: ${previaStr}\n` +
        `  Nueva:    ${nuevaStr}\n\n` +
        `La vigencia actual queda jubilada (activo=false, vigenciaHasta=hoy) — es un asiento inverso, nunca se pisa el valor anterior. ¿Confirmás?`
    );
    if (!ok) return;

    setGuardando((s) => ({ ...s, [courierId]: true }));
    try {
      const res = await fetch("/api/admin/markup-courier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierId, modo, valorPorcentaje: valor }),
      });
      if (res.ok) {
        alert(`Nueva vigencia guardada para ${fila.courier.nombre}.`);
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar");
      }
    } catch (e) {
      alert("Error de conexión");
    } finally {
      setGuardando((s) => ({ ...s, [courierId]: false }));
    }
  };

  const fmtFecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "—";
  const fmtPct = (v: string | number) => `${Number(v).toFixed(4)} %`;

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
          <div className="p-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100">
            <Percent className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">
              Markup Shipro por Courier
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Markup general (%) que Shipro aplica por courier — igual para todos los clientes.
              Modo <strong>HEREDA</strong> sigue el global en vivo; <strong>PROPIO</strong> usa el valor fijo (permite 0 = apagado a propósito).
              Editable con vigencias (asiento inverso). El motor lo lee en Pieza 3.
            </p>
            {globalActivo && (
              <p className="text-xs font-bold text-blue-700 mt-2">
                Global vigente: {fmtPct(globalActivo.valorPorcentaje)}
                <span className="text-blue-500 font-normal"> — es el valor que siguen los couriers en modo HEREDA.</span>
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 max-w-5xl mx-auto w-full space-y-6">
        {cargando ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            No hay couriers activos.
          </div>
        ) : (
          filas.map((f) => {
            const abierto = !!expandido[f.courier.id];
            const enviando = !!guardando[f.courier.id];
            const modoActual = nuevoModo[f.courier.id] || "HEREDA";
            const enHereda = modoActual === "HEREDA";
            const inputDeshabilitado = enHereda;
            const globalStr = globalActivo ? fmtPct(globalActivo.valorPorcentaje) : "—";
            return (
              <div
                key={f.courier.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Courier
                    </p>
                    <h3 className="text-xl font-black text-gray-800">
                      {f.courier.nombre}
                    </h3>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">
                      Vigente
                    </p>
                    {f.activa ? (
                      f.activa.modo === "HEREDA" ? (
                        <>
                          <p className="text-2xl font-black text-blue-900">
                            HEREDA
                          </p>
                          <p className="text-[11px] text-blue-700 mt-1">
                            Aplica el global: <strong>{globalStr}</strong>
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-2xl font-black text-blue-900">
                            {fmtPct(f.activa.valorPorcentaje)}
                          </p>
                          <p className="text-[10px] text-blue-700 mt-1">
                            <strong>PROPIO</strong>
                            {Number(f.activa.valorPorcentaje) === 0 && " — apagado a propósito"}
                          </p>
                        </>
                      )
                    ) : (
                      <p className="text-2xl font-black text-blue-900">sin configurar</p>
                    )}
                    <p className="text-[10px] text-blue-700 mt-1">
                      Vigente desde: {f.activa ? fmtFecha(f.activa.vigenciaDesde) : "—"}
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      guardar(f);
                    }}
                    className="flex flex-col gap-3"
                  >
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                        Modo
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["HEREDA", "PROPIO"] as ModoMarkup[]).map((m) => {
                          const seleccionado = modoActual === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() =>
                                setNuevoModo((s) => ({ ...s, [f.courier.id]: m }))
                              }
                              className={
                                "py-2 rounded-lg text-xs font-bold uppercase border-2 transition-colors " +
                                (seleccionado
                                  ? "bg-[#233b6b] text-white border-[#233b6b]"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-blue-300")
                              }
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                        Valor (%)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="100"
                        required={modoActual === "PROPIO"}
                        disabled={inputDeshabilitado}
                        value={nuevoValor[f.courier.id] ?? ""}
                        onChange={(e) =>
                          setNuevoValor((s) => ({
                            ...s,
                            [f.courier.id]: e.target.value,
                          }))
                        }
                        className={
                          "w-full border-2 rounded-lg p-2.5 text-base font-black outline-none " +
                          (inputDeshabilitado
                            ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                            : "border-gray-200 text-gray-800 focus:border-blue-500")
                        }
                        placeholder={
                          enHereda ? `heredando ${globalStr}` : "Ej: 10 (0 = apagado)"
                        }
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        {enHereda ? (
                          <>
                            Modo HEREDA: sigue el global ({globalStr}) en vivo. El valor
                            guardado se recuerda por si volvés a PROPIO.
                          </>
                        ) : (
                          <>
                            Modo PROPIO: usa este valor fijo. 0% = markup apagado a propósito
                            (distinto de HEREDA).
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={enviando}
                      className="py-2.5 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-blue-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                    >
                      {enviando ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Guardar nueva vigencia
                    </button>
                    <p className="text-[10px] text-gray-500">
                      Cierra la vigencia actual de este courier y crea una nueva. Nunca sobrescribe.
                    </p>
                  </form>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandido((s) => ({ ...s, [f.courier.id]: !abierto }))
                  }
                  className="w-full flex items-center gap-2 px-6 py-3 border-t border-gray-100 text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  {abierto ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <History className="w-4 h-4" />
                  Historial de vigencias ({f.historial.length})
                </button>

                {abierto && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-left whitespace-nowrap">
                      <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                        <tr>
                          <th className="px-6 py-3">Modo</th>
                          <th className="px-6 py-3">Valor (%)</th>
                          <th className="px-6 py-3">Vigencia desde</th>
                          <th className="px-6 py-3">Vigencia hasta</th>
                          <th className="px-6 py-3 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-sm">
                        {f.historial.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-gray-400">
                              Sin vigencias todavía.
                            </td>
                          </tr>
                        ) : (
                          f.historial.map((h) => (
                            <tr key={h.id} className={h.activo ? "bg-emerald-50/40" : ""}>
                              <td className="px-6 py-3 font-bold text-gray-700 text-xs uppercase">
                                {h.modo}
                              </td>
                              <td className="px-6 py-3 font-bold text-gray-800">
                                {h.modo === "HEREDA" ? (
                                  <span className="text-gray-500 font-normal">
                                    (hereda global)
                                  </span>
                                ) : (
                                  fmtPct(h.valorPorcentaje)
                                )}
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
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
