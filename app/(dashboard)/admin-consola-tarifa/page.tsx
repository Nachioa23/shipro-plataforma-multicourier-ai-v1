"use client";

// DEUDA 170 Parte 2 Pieza 1 (2026-09-08): Consola de Tarifa — tabla por
// courier con las 3 variables per-courier de la cascada de precio en una
// sola vista:
//   - Markup del DUEÑO (MarkupIntermediarioCourier)
//   - Markup de SHIPRO (MarkupCourier, con toggle HEREDA/PROPIO)
//   - SMO (SmoCourier, monto $ neto)
// Fórmula completa (para referencia — Parte 2 piezas siguientes agregan
// markup global + Fee per-empresa + IVA + preview live):
//   tarifa API → +Dueño → +Shipro → +SMO → +Fee → ×IVA = tarifa publicada
//
// ARQUITECTURA: GET consolidado en /api/admin/consola-tarifa (una request,
// N rows con las 3 vigencias vigentes por courier + el global vigente).
// SAVES via los 3 endpoints existentes (/api/admin/markup-dueno,
// /admin/markup-courier, /admin/smo-courier), cada uno con su cerrar+crear
// vigencia transaction. Cero duplicación de lógica; cero cambio de engine.
//
// AISLAMIENTO: motor de precios (cotizador.ts / aplicarMarkup) INTACTO.
// Editar valores acá cambia precios en la próxima cotización — mismo efecto
// que editar desde las pantallas individuales, que siguen operativas.
//
// GATE: admin_shipro.

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Percent, Handshake, Shield, Loader2, ShieldAlert, Save, Sliders } from "lucide-react";

type ModoMarkupShipro = "HEREDA" | "PROPIO";

type VigenciaMarkupDueno = {
  id: number;
  courierId: number;
  valorPorcentaje: string; // Decimal serialized as string
  vigenciaDesde: string;
} | null;

type VigenciaMarkupShipro = {
  id: number;
  courierId: number;
  valorPorcentaje: string;
  modo: ModoMarkupShipro;
  vigenciaDesde: string;
} | null;

type VigenciaSmo = {
  id: number;
  courierId: number;
  valorNeto: string;
  vigenciaDesde: string;
} | null;

type Fila = {
  courier: { id: number; nombre: string };
  markupDueno: VigenciaMarkupDueno;
  markupShipro: VigenciaMarkupShipro;
  smo: VigenciaSmo;
};

type GlobalActivo = {
  id: number;
  valorPorcentaje: string;
  vigenciaDesde: string;
} | null;

const fmtPct = (v: string | number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(4)} %`;
const fmtMoney = (v: string | number | null | undefined) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ConsolaTarifaPage() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [globalActivo, setGlobalActivo] = useState<GlobalActivo>(null);

  // Editing state por cell — separado por variable, indexado por courierId.
  const [nuevoDueno, setNuevoDueno] = useState<Record<number, string>>({});
  const [nuevoShiproModo, setNuevoShiproModo] = useState<Record<number, ModoMarkupShipro>>({});
  const [nuevoShiproValor, setNuevoShiproValor] = useState<Record<number, string>>({});
  const [nuevoSmo, setNuevoSmo] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState<Record<string, boolean>>({}); // key = `${cellType}-${courierId}`

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/consola-tarifa");
      if (res.ok) {
        const data = await res.json();
        const rows: Fila[] = data.filas || [];
        setFilas(rows);
        setGlobalActivo(data.globalActivo ?? null);
        // Prefill inputs with current active values.
        const dn: Record<number, string> = {};
        const spModo: Record<number, ModoMarkupShipro> = {};
        const spVal: Record<number, string> = {};
        const smo: Record<number, string> = {};
        for (const f of rows) {
          dn[f.courier.id] = f.markupDueno ? String(f.markupDueno.valorPorcentaje) : "";
          spModo[f.courier.id] = f.markupShipro?.modo ?? "HEREDA";
          spVal[f.courier.id] = f.markupShipro ? String(f.markupShipro.valorPorcentaje) : "";
          smo[f.courier.id] = f.smo ? String(f.smo.valorNeto) : "";
        }
        setNuevoDueno(dn);
        setNuevoShiproModo(spModo);
        setNuevoShiproValor(spVal);
        setNuevoSmo(smo);
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

  const marcarGuardando = (key: string, v: boolean) =>
    setGuardando((s) => ({ ...s, [key]: v }));

  // -----------------------------------------------------------------------
  // Save handlers — cada uno POSTea al endpoint atómico correspondiente.
  // Reusan la lógica de "cerrar+crear vigencia" existente. Cero duplicación.
  // -----------------------------------------------------------------------

  const guardarDueno = async (fila: Fila) => {
    const courierId = fila.courier.id;
    const raw = nuevoDueno[courierId] ?? "";
    const valor = parseFloat(raw);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      alert("Markup del dueño: ingresá un porcentaje entre 0 y 100 (0 = las creds son de Shipro).");
      return;
    }
    const key = `dueno-${courierId}`;
    marcarGuardando(key, true);
    try {
      const res = await fetch("/api/admin/markup-dueno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierId, valorPorcentaje: valor }),
      });
      if (res.ok) {
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar markup del dueño");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      marcarGuardando(key, false);
    }
  };

  const guardarShipro = async (fila: Fila) => {
    const courierId = fila.courier.id;
    const modo = nuevoShiproModo[courierId] ?? "HEREDA";
    const raw = nuevoShiproValor[courierId] ?? "";
    let valor: number;
    if (modo === "PROPIO") {
      valor = parseFloat(raw);
      if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
        alert("Markup de Shipro (modo PROPIO): ingresá un porcentaje entre 0 y 100.");
        return;
      }
    } else {
      // HEREDA: se preserva el valor tipeado si es válido; si no, 0.
      const parsed = parseFloat(raw);
      valor = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
    }
    const key = `shipro-${courierId}`;
    marcarGuardando(key, true);
    try {
      const res = await fetch("/api/admin/markup-courier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierId, modo, valorPorcentaje: valor }),
      });
      if (res.ok) {
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar markup de Shipro");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      marcarGuardando(key, false);
    }
  };

  const guardarSmo = async (fila: Fila) => {
    const courierId = fila.courier.id;
    const raw = nuevoSmo[courierId] ?? "";
    const valor = parseFloat(raw);
    if (!Number.isFinite(valor) || valor < 0) {
      alert("SMO: ingresá un monto neto (sin IVA) mayor o igual a 0.");
      return;
    }
    const key = `smo-${courierId}`;
    marcarGuardando(key, true);
    try {
      const res = await fetch("/api/admin/smo-courier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierId, valorNeto: valor }),
      });
      if (res.ok) {
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar SMO");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      marcarGuardando(key, false);
    }
  };

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
          <div className="p-2.5 rounded-xl bg-slate-50 text-slate-700 border border-slate-200">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">
              Consola de tarifa — variables por courier
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Vista unificada de las 3 variables per-courier de la cascada de tarifa:
              markup del dueño, markup de Shipro (con toggle HEREDA/PROPIO) y SMO.
              El markup global de Shipro, el Fee por empresa y el IVA vienen en piezas siguientes.
            </p>
            <p className="text-[11px] font-medium text-slate-600 mt-2">
              Fórmula completa: <code className="text-slate-700">tarifa API → +markup dueño → +markup Shipro → +SMO → +Fee → ×IVA</code>
            </p>
            {globalActivo && (
              <p className="text-xs font-bold text-blue-700 mt-2">
                Markup Shipro global vigente: {fmtPct(globalActivo.valorPorcentaje)}
                <span className="text-blue-500 font-normal"> — es el valor que siguen los couriers en modo HEREDA.</span>
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {cargando ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            No hay couriers activos.
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-600 font-bold">
                  <tr>
                    <th className="px-6 py-3 min-w-[160px]">Courier</th>
                    <th className="px-6 py-3 min-w-[220px]">
                      <span className="inline-flex items-center gap-1.5">
                        <Handshake className="w-3.5 h-3.5 text-purple-600" />
                        Markup del dueño (%)
                      </span>
                    </th>
                    <th className="px-6 py-3 min-w-[280px]">
                      <span className="inline-flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5 text-blue-600" />
                        Markup de Shipro (%)
                      </span>
                    </th>
                    <th className="px-6 py-3 min-w-[220px]">
                      <span className="inline-flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-amber-600" />
                        SMO ($ neto)
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {filas.map((f) => {
                    const courierId = f.courier.id;
                    const modoActual = nuevoShiproModo[courierId] ?? "HEREDA";
                    const shiproInputDisabled = modoActual === "HEREDA";
                    const globalStr = globalActivo ? fmtPct(globalActivo.valorPorcentaje) : "—";
                    return (
                      <tr key={courierId} className="hover:bg-slate-50/40">
                        {/* Courier name */}
                        <td className="px-6 py-4 align-top">
                          <p className="text-base font-black text-gray-800">{f.courier.nombre}</p>
                        </td>

                        {/* Markup del dueño */}
                        <td className="px-6 py-4 align-top">
                          <p className="text-xs text-purple-700 font-bold mb-1">
                            Vigente: {fmtPct(f.markupDueno?.valorPorcentaje)}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              max="100"
                              value={nuevoDueno[courierId] ?? ""}
                              onChange={(e) =>
                                setNuevoDueno((s) => ({ ...s, [courierId]: e.target.value }))
                              }
                              className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-800 outline-none focus:border-purple-500"
                              placeholder="0"
                            />
                            <button
                              type="button"
                              onClick={() => guardarDueno(f)}
                              disabled={!!guardando[`dueno-${courierId}`]}
                              className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                              title="Guardar nueva vigencia del markup del dueño"
                            >
                              {guardando[`dueno-${courierId}`] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-1">
                            0% = creds Shipro (sin intermediario)
                          </p>
                        </td>

                        {/* Markup de Shipro (modo + %) */}
                        <td className="px-6 py-4 align-top">
                          <p className="text-xs text-blue-700 font-bold mb-1">
                            Vigente:{" "}
                            {f.markupShipro
                              ? f.markupShipro.modo === "HEREDA"
                                ? `HEREDA (${globalStr})`
                                : `PROPIO ${fmtPct(f.markupShipro.valorPorcentaje)}`
                              : "sin configurar"}
                          </p>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            {(["HEREDA", "PROPIO"] as ModoMarkupShipro[]).map((m) => {
                              const sel = modoActual === m;
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() =>
                                    setNuevoShiproModo((s) => ({ ...s, [courierId]: m }))
                                  }
                                  className={
                                    "px-2 py-1 rounded text-[10px] font-bold uppercase border transition-colors " +
                                    (sel
                                      ? "bg-[#233b6b] text-white border-[#233b6b]"
                                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-300")
                                  }
                                >
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              max="100"
                              disabled={shiproInputDisabled}
                              value={nuevoShiproValor[courierId] ?? ""}
                              onChange={(e) =>
                                setNuevoShiproValor((s) => ({
                                  ...s,
                                  [courierId]: e.target.value,
                                }))
                              }
                              className={
                                "w-24 border-2 rounded-lg px-2 py-1.5 text-sm font-bold outline-none " +
                                (shiproInputDisabled
                                  ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                                  : "border-gray-200 text-gray-800 focus:border-blue-500")
                              }
                              placeholder={shiproInputDisabled ? "hereda" : "0"}
                            />
                            <button
                              type="button"
                              onClick={() => guardarShipro(f)}
                              disabled={!!guardando[`shipro-${courierId}`]}
                              className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                              title="Guardar nueva vigencia del markup de Shipro"
                            >
                              {guardando[`shipro-${courierId}`] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-1">
                            HEREDA sigue el global; PROPIO usa el valor fijo (permite 0)
                          </p>
                        </td>

                        {/* SMO */}
                        <td className="px-6 py-4 align-top">
                          <p className="text-xs text-amber-700 font-bold mb-1">
                            Vigente: {fmtMoney(f.smo?.valorNeto)}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={nuevoSmo[courierId] ?? ""}
                              onChange={(e) =>
                                setNuevoSmo((s) => ({ ...s, [courierId]: e.target.value }))
                              }
                              className="w-28 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-800 outline-none focus:border-amber-500"
                              placeholder="0.00"
                            />
                            <button
                              type="button"
                              onClick={() => guardarSmo(f)}
                              disabled={!!guardando[`smo-${courierId}`]}
                              className="p-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                              title="Guardar nueva vigencia del SMO"
                            >
                              {guardando[`smo-${courierId}`] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-1">
                            Monto $ neto (sin IVA)
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-slate-50/50 text-[11px] text-gray-500">
              Cada guardado cierra la vigencia actual del courier y crea una nueva (asiento inverso). Nunca se pisa el valor anterior. Las pantallas individuales (Markup del Dueño, Markup por Courier, SMO por Courier) siguen operativas.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
