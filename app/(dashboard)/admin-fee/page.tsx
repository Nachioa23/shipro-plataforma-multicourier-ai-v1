"use client";

// FASE 2 sub 4 parte A (2026-08-01): pantalla admin del Fee por empresa
// (OperacionFee) con vigencias. Mirror de las pantallas del markup Shipro
// (admin-parametros-tarifa, sub 2a) y SMO por courier (admin-smo, sub 3),
// con TRES diferencias:
//   (i)  Editar mueve plata en VIVO (Fee ya lo lee el motor en FASE 1) — la
//        UI muestra un banner de advertencia y un confirm explícito antes de
//        guardar.
//   (ii) Motivo OBLIGATORIO por empresa — bloqueado el submit si está vacío.
//  (iii) OperacionFee usa la ortografía `vigente*` (DEUDA 114 aparte).

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Receipt,
  Loader2,
  CheckCircle2,
  History,
  Save,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Eye,
} from "lucide-react";

type Vigencia = {
  id: number;
  empresaId: number;
  tipo: "FIJO" | "PORCENTAJE" | string;
  valor: string;
  activo: boolean;
  vigenteDesde: string;
  vigenteHasta: string | null;
  createdAt: string;
};

type Fila = {
  empresa: { id: number; nombre: string; cuit: string };
  activa: Vigencia | null;
  historial: Vigencia[];
};

export default function AdminFeePorEmpresa() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [expandido, setExpandido] = useState<Record<number, boolean>>({});
  const [nuevoTipo, setNuevoTipo] = useState<Record<number, "FIJO" | "PORCENTAJE">>({});
  const [nuevoValor, setNuevoValor] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});

  // FASE 2 sub 4 parte B PASO 1: vista previa del ajuste masivo (SIMULACIÓN).
  // Ninguna acción de esta sección escribe a la BD — sólo compute.
  const [porcMasivo, setPorcMasivo] = useState("");
  const [previewCargando, setPreviewCargando] = useState(false);
  const [preview, setPreview] = useState<null | {
    porcentaje: number;
    factor: string;
    afectadas: Array<{
      empresaId: number;
      nombre: string;
      cuit: string;
      tipo: string;
      valorActual: string;
      valorNuevo: string;
      delta: string;
    }>;
    cantidadAfectadas: number;
    salteadas: Array<{ empresaId: number; nombre: string }>;
    cantidadSalteadas: number;
  }>(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/operacion-fee");
      if (res.ok) {
        const data = await res.json();
        setFilas(data.filas || []);
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
    const empresaId = fila.empresa.id;
    const tipo =
      nuevoTipo[empresaId] || (fila.activa?.tipo as "FIJO" | "PORCENTAJE") || "FIJO";
    const raw = nuevoValor[empresaId] || "";
    const valor = parseFloat(raw);
    const motivoTxt = (motivo[empresaId] || "").trim();

    if (!motivoTxt) {
      alert("El motivo es obligatorio — mueve plata en vivo.");
      return;
    }
    const maxValor = tipo === "PORCENTAJE" ? 100 : 1_000_000;
    if (!Number.isFinite(valor) || valor <= 0 || valor > maxValor) {
      alert(
        `Valor inválido para tipo ${tipo}. Debe ser un número > 0 y ≤ ${maxValor}.`
      );
      return;
    }

    const actualStr = fila.activa
      ? `${fila.activa.tipo === "PORCENTAJE" ? `${Number(fila.activa.valor)}%` : `$${Number(fila.activa.valor).toFixed(2)}`} (${fila.activa.tipo})`
      : "SIN FEE ($0)";
    const nuevoStr =
      tipo === "PORCENTAJE" ? `${valor}% (PORCENTAJE)` : `$${valor.toFixed(2)} (FIJO)`;

    const ok = confirm(
      `⚠️ Esto cambia el precio del próximo envío de esta empresa, EN VIVO.\n\n` +
        `Empresa: ${fila.empresa.nombre} (CUIT ${fila.empresa.cuit})\n` +
        `Fee actual: ${actualStr}\n` +
        `Fee nuevo:  ${nuevoStr}\n` +
        `Motivo:     ${motivoTxt}\n\n` +
        `La vigencia actual queda jubilada (activo=false, vigenteHasta=hoy). Es un ` +
        `asiento inverso — nunca se pisa el valor anterior. ¿Confirmás?`
    );
    if (!ok) return;

    setGuardando((s) => ({ ...s, [empresaId]: true }));
    try {
      const res = await fetch("/api/admin/operacion-fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId, tipo, valor, motivo: motivoTxt }),
      });
      if (res.ok) {
        alert(`Nueva vigencia guardada para ${fila.empresa.nombre}.`);
        setNuevoValor((s) => ({ ...s, [empresaId]: "" }));
        setMotivo((s) => ({ ...s, [empresaId]: "" }));
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar");
      }
    } catch (e) {
      alert("Error de conexión");
    } finally {
      setGuardando((s) => ({ ...s, [empresaId]: false }));
    }
  };

  const verPreview = async () => {
    const p = parseFloat(porcMasivo);
    if (!Number.isFinite(p) || p <= -100 || p > 1000) {
      alert(
        "Ingresá un porcentaje válido: estrictamente mayor a -100 y menor o igual a 1000."
      );
      return;
    }
    setPreviewCargando(true);
    try {
      const res = await fetch("/api/admin/operacion-fee/preview-masivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ porcentaje: p }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      } else {
        const data = await res.json();
        alert(data.error || "Error calculando vista previa");
      }
    } catch (e) {
      alert("Error de conexión");
    } finally {
      setPreviewCargando(false);
    }
  };

  const fmtFecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "—";
  const fmtValor = (v: Vigencia) =>
    v.tipo === "PORCENTAJE"
      ? `${Number(v.valor)}%`
      : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
          Number(v.valor)
        );

  const filasFiltradas = filas.filter(
    (f) =>
      f.empresa.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      f.empresa.cuit.includes(busqueda)
  );

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
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">
              Fee por Empresa
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              Fee de operación por empresa — editable con vigencias (asiento inverso).
            </p>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-5xl mx-auto w-full space-y-4">
        {/* Banner de advertencia global */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-bold">Plata en vivo</p>
            <p className="text-xs mt-1">
              El Fee ya lo lee el motor de plata (FASE 1). Cambiar el valor de una
              empresa afecta el precio del <strong>próximo envío</strong> en el momento
              en que se guarda la vigencia. El motivo es <strong>obligatorio</strong> y
              queda registrado en la auditoría.
            </p>
          </div>
        </div>

        {/* FASE 2 sub 4 parte B PASO 1: vista previa del ajuste masivo — SIMULACIÓN. */}
        <div className="bg-white rounded-2xl shadow-sm border border-violet-200 overflow-hidden">
          <div className="p-5 bg-violet-50 border-b border-violet-100 flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-violet-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-violet-900 text-sm">
                Ajuste masivo — vista previa (simulación)
              </p>
              <p className="text-xs text-violet-800 mt-1">
                Calcula, para todas las empresas con Fee activo, cuánto quedaría cada uno
                si aplicaras el porcentaje ingresado. <strong>NO escribe nada</strong> a
                la base — es sólo compute. El botón "Aplicar" (siguiente paso) queda
                deshabilitado hasta que esté implementado.
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded bg-violet-200 text-violet-900 uppercase whitespace-nowrap">
              Simulación
            </span>
          </div>
          <div className="p-5 flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                Porcentaje (positivo = subir, negativo = bajar)
              </label>
              <input
                type="number"
                step="0.01"
                value={porcMasivo}
                onChange={(e) => setPorcMasivo(e.target.value)}
                placeholder="Ej: 10 (sube 10%), -5 (baja 5%)"
                className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-base font-black text-gray-800 focus:border-violet-500 outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Rango permitido: estrictamente &gt; -100 (nunca a $0/negativo) y ≤ 1000.
              </p>
            </div>
            <button
              type="button"
              onClick={verPreview}
              disabled={previewCargando}
              className="py-2.5 px-4 bg-violet-700 text-white font-bold rounded-xl hover:bg-violet-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              {previewCargando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              Ver vista previa
            </button>
            <button
              type="button"
              disabled
              title="El apply real se implementa en el siguiente paso."
              className="py-2.5 px-4 bg-gray-200 text-gray-500 font-bold rounded-xl text-sm cursor-not-allowed"
            >
              Aplicar — próximo paso
            </button>
          </div>

          {preview && (
            <div className="border-t border-gray-100">
              <div className="p-4 bg-slate-50 border-b border-gray-100 text-sm text-gray-700">
                <strong>{preview.cantidadAfectadas}</strong> empresas afectadas ·{" "}
                <strong>{preview.cantidadSalteadas}</strong> sin Fee salteadas (factor{" "}
                {preview.factor}). <span className="text-violet-700 font-bold">Simulación — no se escribió nada.</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                    <tr>
                      <th className="px-6 py-3">Empresa</th>
                      <th className="px-6 py-3">Tipo</th>
                      <th className="px-6 py-3 text-right">Fee actual</th>
                      <th className="px-6 py-3 text-right">Fee nuevo</th>
                      <th className="px-6 py-3 text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {preview.afectadas.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-400">
                          No hay empresas con Fee activo — nada que ajustar.
                        </td>
                      </tr>
                    ) : (
                      preview.afectadas.map((a) => {
                        const delta = Number(a.delta);
                        const suffix = a.tipo === "PORCENTAJE" ? "%" : "";
                        return (
                          <tr key={a.empresaId} className="hover:bg-gray-50">
                            <td className="px-6 py-2">
                              <p className="font-bold text-gray-800">{a.nombre}</p>
                              <p className="text-xs text-gray-500">CUIT: {a.cuit}</p>
                            </td>
                            <td className="px-6 py-2 text-gray-700">{a.tipo}</td>
                            <td className="px-6 py-2 text-right text-gray-700 font-mono">
                              {a.valorActual}
                              {suffix}
                            </td>
                            <td className="px-6 py-2 text-right text-gray-900 font-black font-mono">
                              {a.valorNuevo}
                              {suffix}
                            </td>
                            <td
                              className={`px-6 py-2 text-right font-bold font-mono ${
                                delta > 0
                                  ? "text-emerald-700"
                                  : delta < 0
                                    ? "text-rose-700"
                                    : "text-gray-500"
                              }`}
                            >
                              {delta > 0 ? "+" : ""}
                              {a.delta}
                              {suffix}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {preview.salteadas.length > 0 && (
                <div className="p-4 border-t border-gray-100 bg-gray-50">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">
                    Empresas salteadas (sin Fee activo — $0)
                  </p>
                  <p className="text-xs text-gray-600">
                    {preview.salteadas.map((s) => s.nombre).join(", ")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buscador */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar empresa por nombre o CUIT…"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b]"
          />
        </div>

        {cargando ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando…
          </div>
        ) : filasFiltradas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            {filas.length === 0 ? "No hay empresas activas." : "Sin resultados."}
          </div>
        ) : (
          filasFiltradas.map((f) => {
            const abierto = !!expandido[f.empresa.id];
            const enviando = !!guardando[f.empresa.id];
            const activa = f.activa;
            const tipoUI = nuevoTipo[f.empresa.id] || (activa?.tipo as "FIJO" | "PORCENTAJE") || "FIJO";
            const motivoTxt = motivo[f.empresa.id] || "";
            const motivoValido = motivoTxt.trim().length > 0;
            return (
              <div
                key={f.empresa.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Empresa
                    </p>
                    <h3 className="text-lg font-black text-gray-800">
                      {f.empresa.nombre}
                    </h3>
                    <p className="text-xs text-gray-500">CUIT: {f.empresa.cuit}</p>
                  </div>
                  <div
                    className={`rounded-xl p-4 border ${
                      activa
                        ? "bg-emerald-50 border-emerald-100"
                        : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <p
                      className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
                        activa ? "text-emerald-700" : "text-gray-500"
                      }`}
                    >
                      Fee vigente (neto)
                    </p>
                    <p
                      className={`text-2xl font-black ${
                        activa ? "text-emerald-900" : "text-gray-400"
                      }`}
                    >
                      {activa ? fmtValor(activa) : "SIN FEE ($0)"}
                    </p>
                    <p
                      className={`text-[10px] mt-1 ${
                        activa ? "text-emerald-700" : "text-gray-500"
                      }`}
                    >
                      {activa
                        ? `Tipo: ${activa.tipo} · Vigente desde: ${fmtFecha(activa.vigenteDesde)}`
                        : "Sin OperacionFee activa — cotización usa $0"}
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      guardar(f);
                    }}
                    className="flex flex-col gap-2"
                  >
                    <label className="text-[10px] font-bold text-gray-500 uppercase">
                      Nuevo Fee
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={tipoUI}
                        onChange={(e) =>
                          setNuevoTipo((s) => ({
                            ...s,
                            [f.empresa.id]: e.target.value as "FIJO" | "PORCENTAJE",
                          }))
                        }
                        className="px-2 py-2 border-2 border-gray-200 rounded-lg text-sm font-bold text-gray-800 focus:border-emerald-500 outline-none bg-white"
                      >
                        <option value="FIJO">FIJO</option>
                        <option value="PORCENTAJE">%</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={tipoUI === "PORCENTAJE" ? 100 : 1000000}
                        required
                        value={nuevoValor[f.empresa.id] || ""}
                        onChange={(e) =>
                          setNuevoValor((s) => ({
                            ...s,
                            [f.empresa.id]: e.target.value,
                          }))
                        }
                        className="flex-1 border-2 border-gray-200 rounded-lg p-2 text-base font-black text-gray-800 focus:border-emerald-500 outline-none"
                        placeholder={tipoUI === "PORCENTAJE" ? "Ej: 5" : "Ej: 1600"}
                      />
                    </div>
                    <textarea
                      required
                      value={motivoTxt}
                      onChange={(e) =>
                        setMotivo((s) => ({
                          ...s,
                          [f.empresa.id]: e.target.value,
                        }))
                      }
                      placeholder="Motivo (obligatorio) — ej: 'convenio de descuento 20% Junio 2026'"
                      className="w-full border-2 border-gray-200 rounded-lg p-2 text-xs text-gray-800 focus:border-emerald-500 outline-none min-h-[60px]"
                    />
                    <button
                      type="submit"
                      disabled={enviando || !motivoValido}
                      className="py-2.5 bg-[#233b6b] text-white font-bold rounded-xl hover:bg-blue-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {enviando ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Guardar nueva vigencia
                    </button>
                    {!motivoValido && (
                      <p className="text-[10px] text-rose-600 font-bold">
                        El motivo es obligatorio.
                      </p>
                    )}
                    <p className="text-[10px] text-gray-500">
                      Cierra la vigencia actual de esta empresa y crea una nueva. Nunca sobrescribe.
                    </p>
                  </form>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandido((s) => ({ ...s, [f.empresa.id]: !abierto }))
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
                          <th className="px-6 py-3">Tipo</th>
                          <th className="px-6 py-3">Valor</th>
                          <th className="px-6 py-3">Vigente desde</th>
                          <th className="px-6 py-3">Vigente hasta</th>
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
                              <td className="px-6 py-3 text-gray-800">{h.tipo}</td>
                              <td className="px-6 py-3 font-bold text-gray-800">
                                {fmtValor(h)}
                              </td>
                              <td className="px-6 py-3 text-gray-600">
                                {fmtFecha(h.vigenteDesde)}
                              </td>
                              <td className="px-6 py-3 text-gray-600">
                                {fmtFecha(h.vigenteHasta)}
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
