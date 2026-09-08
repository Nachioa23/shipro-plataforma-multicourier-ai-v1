"use client";

// DEUDA 170 Parte 2 Pieza 1 (2026-09-08, elevada 2026-09-08): Consola de Tarifa —
// tabla por courier con las 3 variables per-courier de la cascada de precio en
// una sola vista + historial expandible per row (accordion inline).
//
// Variables:
//   - Markup del DUEÑO (MarkupIntermediarioCourier — purple)
//   - Markup de SHIPRO (MarkupCourier, HEREDA/PROPIO — blue)
//   - SMO (SmoCourier, monto $ neto — amber)
//
// Fórmula completa (para referencia — piezas siguientes agregan markup global +
// Fee per-empresa + IVA + preview live):
//   tarifa API → +Dueño → +Shipro → +SMO → +Fee → ×IVA = tarifa publicada
//
// UX ELEVATION (2026-09-08):
//   - Display calmo: los valores vigentes se muestran como texto formateado
//     (no un mar de inputs abiertos). Nacho edita pocas veces — priorizamos
//     "clarity-at-a-glance" antes que "always-editable".
//   - Edit on demand: pencil icon per cell → abre input en la misma celda con
//     save + cancel. Enter guarda; Esc cancela. Sale del modo edit al terminar.
//   - Historial accordion inline (por courier): chevron en la col del courier
//     revela sub-fila con las últimas 5 vigencias de las 3 variables (top-5 desde
//     el GET consolidado).
//   - Sistema de diseño existente (Sora + #233b6b + color-coded por dominio:
//     purple=dueño, blue=Shipro, amber=SMO). Mirror de /admin-markup-courier.
//   - Accesibilidad: <label sr-only> per input, aria-label en icon buttons,
//     focus-visible rings sobre botones + inputs, text-gray-600 para labels
//     críticos, motion-safe: prefix en animaciones (respeta reduced-motion).
//
// ARQUITECTURA: GET consolidado en /api/admin/consola-tarifa (una request,
// N rows con las 3 vigencias vigentes + historial top-5 por variable +
// global vigente). SAVES via los 3 endpoints existentes (/api/admin/markup-
// dueno, /admin/markup-courier, /admin/smo-courier), cada uno con su cerrar+
// crear vigencia transaction. Cero duplicación de lógica; cero cambio de
// engine.
//
// AISLAMIENTO: motor de precios (cotizador.ts / aplicarMarkup) INTACTO.
// Editar valores acá cambia precios en la próxima cotización — mismo efecto
// que editar desde las pantallas individuales, que siguen operativas
// (single source of truth confirmado: los 3 modelos son la fuente única que
// motor + consola + pantallas atómicas leen y escriben).
//
// GATE: admin_shipro.

import { useState, useEffect, useCallback, Fragment } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Percent,
  Handshake,
  Shield,
  Loader2,
  ShieldAlert,
  Save,
  X,
  Pencil,
  ChevronDown,
  ChevronRight,
  Sliders,
  History,
  CheckCircle2,
  Receipt,
  Building2,
  Landmark,
  ExternalLink,
} from "lucide-react";

type ModoMarkupShipro = "HEREDA" | "PROPIO";

type VigenciaMarkupDueno = {
  id: number;
  courierId: number;
  valorPorcentaje: string;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
};

type VigenciaMarkupShipro = {
  id: number;
  courierId: number;
  valorPorcentaje: string;
  modo: ModoMarkupShipro;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
};

type VigenciaSmo = {
  id: number;
  courierId: number;
  valorNeto: string;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
};

type Fila = {
  courier: { id: number; nombre: string };
  markupDueno: VigenciaMarkupDueno | null;
  markupShipro: VigenciaMarkupShipro | null;
  smo: VigenciaSmo | null;
  historial: {
    dueno: VigenciaMarkupDueno[];
    shipro: VigenciaMarkupShipro[];
    smo: VigenciaSmo[];
  };
};

type GlobalActivo = {
  id: number;
  valorPorcentaje: string;
  vigenciaDesde: string;
} | null;

type VigenciaGlobal = {
  id: number;
  valorPorcentaje: string;
  activo: boolean;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
};

type FeeTipo = "FIJO" | "PORCENTAJE";

type VigenciaFee = {
  id: number;
  empresaId: number;
  tipo: FeeTipo;
  valor: string;
  activo: boolean;
  vigenteDesde: string;
  vigenteHasta: string | null;
} | null;

type FilaFee = {
  empresa: { id: number; nombre: string; cuit: string | null };
  fee: VigenciaFee;
};

type IvaInfo = {
  multiplier: number;
  porcentaje: number;
};

const fmtPct = (v: string | number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(4)} %`;
const fmtMoney = (v: string | number | null | undefined) =>
  v == null
    ? "—"
    : `$ ${Number(v).toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
const fmtFecha = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#233b6b]";

// -----------------------------------------------------------------------------
// Sub-components (kept in-file for locality — the console is a single screen).
// -----------------------------------------------------------------------------

function CellDueno({
  fila,
  editando,
  onEditToggle,
  onGuardar,
  guardando,
}: {
  fila: Fila;
  editando: boolean;
  onEditToggle: (v: boolean) => void;
  onGuardar: (valor: number) => void;
  guardando: boolean;
}) {
  const vigente = fila.markupDueno;
  const [valor, setValor] = useState<string>(
    vigente ? String(vigente.valorPorcentaje) : ""
  );

  useEffect(() => {
    if (editando) {
      setValor(vigente ? String(vigente.valorPorcentaje) : "");
    }
  }, [editando, vigente]);

  const commit = () => {
    const n = parseFloat(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      alert(
        "Markup del dueño: ingresá un porcentaje entre 0 y 100 (0 = creds Shipro)."
      );
      return;
    }
    onGuardar(n);
  };

  if (!editando) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div>
          <span
            className={
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-black " +
              (vigente && Number(vigente.valorPorcentaje) > 0
                ? "bg-purple-100 text-purple-900"
                : "text-gray-500")
            }
          >
            {vigente ? fmtPct(vigente.valorPorcentaje) : "sin configurar"}
          </span>
          <p className="text-[11px] text-gray-600 mt-1">
            0% = creds Shipro (sin intermediario)
          </p>
        </div>
        <button
          type="button"
          onClick={() => onEditToggle(true)}
          aria-label={`Editar markup del dueño de ${fila.courier.nombre}`}
          className={
            "p-1.5 rounded-lg text-purple-700 hover:bg-purple-50 border border-transparent hover:border-purple-200 transition-colors " +
            focusRing
          }
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const labelId = `dueno-input-${fila.courier.id}`;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={labelId} className="sr-only">
        Nuevo markup del dueño para {fila.courier.nombre}, en porcentaje
      </label>
      <input
        id={labelId}
        type="number"
        step="0.0001"
        min="0"
        max="100"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onEditToggle(false);
        }}
        autoFocus
        className={
          "w-24 border-2 border-purple-300 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-800 outline-none focus:border-purple-500 " +
          focusRing
        }
        placeholder="0"
      />
      <button
        type="button"
        onClick={commit}
        disabled={guardando}
        aria-label="Guardar nueva vigencia del markup del dueño"
        className={
          "p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 " +
          focusRing
        }
      >
        {guardando ? (
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Save className="w-4 h-4" />
        )}
      </button>
      <button
        type="button"
        onClick={() => onEditToggle(false)}
        aria-label="Cancelar edición"
        className={
          "p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg " + focusRing
        }
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function CellShipro({
  fila,
  editando,
  onEditToggle,
  onGuardar,
  guardando,
  globalActivo,
}: {
  fila: Fila;
  editando: boolean;
  onEditToggle: (v: boolean) => void;
  onGuardar: (modo: ModoMarkupShipro, valor: number) => void;
  guardando: boolean;
  globalActivo: GlobalActivo;
}) {
  const vigente = fila.markupShipro;
  const globalStr = globalActivo ? fmtPct(globalActivo.valorPorcentaje) : "—";

  const [modo, setModo] = useState<ModoMarkupShipro>(vigente?.modo ?? "HEREDA");
  const [valor, setValor] = useState<string>(
    vigente ? String(vigente.valorPorcentaje) : ""
  );

  useEffect(() => {
    if (editando) {
      setModo(vigente?.modo ?? "HEREDA");
      setValor(vigente ? String(vigente.valorPorcentaje) : "");
    }
  }, [editando, vigente]);

  const commit = () => {
    let n: number;
    if (modo === "PROPIO") {
      n = parseFloat(valor);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        alert(
          "Markup de Shipro (modo PROPIO): ingresá un porcentaje entre 0 y 100."
        );
        return;
      }
    } else {
      const parsed = parseFloat(valor);
      n = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
    }
    onGuardar(modo, n);
  };

  if (!editando) {
    const esHereda = vigente?.modo === "HEREDA";
    return (
      <div className="flex items-center justify-between gap-2">
        <div>
          {vigente ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider " +
                  (esHereda
                    ? "bg-slate-100 text-slate-700"
                    : "bg-blue-100 text-blue-900")
                }
              >
                {vigente.modo}
              </span>
              <span className="text-sm font-black text-gray-800">
                {esHereda ? globalStr : fmtPct(vigente.valorPorcentaje)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">sin configurar</span>
          )}
          <p className="text-[11px] text-gray-600 mt-1">
            {esHereda
              ? `Hereda del global (${globalStr})`
              : "Valor propio (permite 0 = apagado)"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onEditToggle(true)}
          aria-label={`Editar markup de Shipro de ${fila.courier.nombre}`}
          className={
            "p-1.5 rounded-lg text-blue-700 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors " +
            focusRing
          }
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const enHereda = modo === "HEREDA";
  const labelId = `shipro-input-${fila.courier.id}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label={`Modo del markup de Shipro para ${fila.courier.nombre}`}
        className="inline-flex items-center gap-1"
      >
        {(["HEREDA", "PROPIO"] as ModoMarkupShipro[]).map((m) => {
          const sel = modo === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => setModo(m)}
              className={
                "px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider border transition-colors " +
                focusRing +
                " " +
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
        <label htmlFor={labelId} className="sr-only">
          Nuevo valor del markup de Shipro para {fila.courier.nombre}, en porcentaje
          {enHereda ? " (opcional en modo hereda — se guarda como referencia)" : ""}
        </label>
        <input
          id={labelId}
          type="number"
          step="0.0001"
          min="0"
          max="100"
          disabled={enHereda}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onEditToggle(false);
          }}
          autoFocus={!enHereda}
          className={
            "w-24 border-2 rounded-lg px-2 py-1.5 text-sm font-bold outline-none " +
            focusRing +
            " " +
            (enHereda
              ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
              : "border-blue-300 text-gray-800 focus:border-blue-500")
          }
          placeholder={enHereda ? "hereda" : "0"}
        />
        <button
          type="button"
          onClick={commit}
          disabled={guardando}
          aria-label="Guardar nueva vigencia del markup de Shipro"
          className={
            "p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 " +
            focusRing
          }
        >
          {guardando ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Save className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onEditToggle(false)}
          aria-label="Cancelar edición"
          className={
            "p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg " + focusRing
          }
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function CellSmo({
  fila,
  editando,
  onEditToggle,
  onGuardar,
  guardando,
}: {
  fila: Fila;
  editando: boolean;
  onEditToggle: (v: boolean) => void;
  onGuardar: (valor: number) => void;
  guardando: boolean;
}) {
  const vigente = fila.smo;
  const [valor, setValor] = useState<string>(
    vigente ? String(vigente.valorNeto) : ""
  );

  useEffect(() => {
    if (editando) {
      setValor(vigente ? String(vigente.valorNeto) : "");
    }
  }, [editando, vigente]);

  const commit = () => {
    const n = parseFloat(valor);
    if (!Number.isFinite(n) || n < 0) {
      alert("SMO: ingresá un monto neto (sin IVA) mayor o igual a 0.");
      return;
    }
    onGuardar(n);
  };

  if (!editando) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div>
          <span
            className={
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-black " +
              (vigente
                ? "bg-amber-100 text-amber-900"
                : "text-gray-500")
            }
          >
            {vigente ? fmtMoney(vigente.valorNeto) : "sin configurar"}
          </span>
          <p className="text-[11px] text-gray-600 mt-1">Monto $ neto (sin IVA)</p>
        </div>
        <button
          type="button"
          onClick={() => onEditToggle(true)}
          aria-label={`Editar SMO de ${fila.courier.nombre}`}
          className={
            "p-1.5 rounded-lg text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-colors " +
            focusRing
          }
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const labelId = `smo-input-${fila.courier.id}`;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={labelId} className="sr-only">
        Nuevo SMO para {fila.courier.nombre}, en pesos netos
      </label>
      <input
        id={labelId}
        type="number"
        step="0.01"
        min="0"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onEditToggle(false);
        }}
        autoFocus
        className={
          "w-28 border-2 border-amber-300 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-800 outline-none focus:border-amber-500 " +
          focusRing
        }
        placeholder="0.00"
      />
      <button
        type="button"
        onClick={commit}
        disabled={guardando}
        aria-label="Guardar nueva vigencia del SMO"
        className={
          "p-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 " +
          focusRing
        }
      >
        {guardando ? (
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Save className="w-4 h-4" />
        )}
      </button>
      <button
        type="button"
        onClick={() => onEditToggle(false)}
        aria-label="Cancelar edición"
        className={
          "p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg " + focusRing
        }
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function HistorialAccordion({ fila }: { fila: Fila }) {
  const cols = [
    {
      key: "dueno",
      title: "Markup del dueño",
      icon: <Handshake className="w-3.5 h-3.5" />,
      accent: "purple",
      rows: fila.historial.dueno.map((r) => ({
        id: r.id,
        activo: r.activo,
        vigenciaDesde: r.vigenciaDesde,
        vigenciaHasta: r.vigenciaHasta,
        valor: fmtPct(r.valorPorcentaje),
      })),
    },
    {
      key: "shipro",
      title: "Markup de Shipro",
      icon: <Percent className="w-3.5 h-3.5" />,
      accent: "blue",
      rows: fila.historial.shipro.map((r) => ({
        id: r.id,
        activo: r.activo,
        vigenciaDesde: r.vigenciaDesde,
        vigenciaHasta: r.vigenciaHasta,
        valor: `${r.modo} · ${fmtPct(r.valorPorcentaje)}`,
      })),
    },
    {
      key: "smo",
      title: "SMO",
      icon: <Shield className="w-3.5 h-3.5" />,
      accent: "amber",
      rows: fila.historial.smo.map((r) => ({
        id: r.id,
        activo: r.activo,
        vigenciaDesde: r.vigenciaDesde,
        vigenciaHasta: r.vigenciaHasta,
        valor: fmtMoney(r.valorNeto),
      })),
    },
  ];

  return (
    <div className="bg-slate-50/60 border-t border-slate-200">
      <div className="px-6 py-4">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> Últimas vigencias de {fila.courier.nombre}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cols.map((col) => (
            <div
              key={col.key}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden"
            >
              <div
                className={
                  "px-3 py-2 border-b border-gray-100 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 " +
                  (col.accent === "purple"
                    ? "text-purple-700 bg-purple-50/40"
                    : col.accent === "blue"
                      ? "text-blue-700 bg-blue-50/40"
                      : "text-amber-700 bg-amber-50/40")
                }
              >
                {col.icon} {col.title}
              </div>
              {col.rows.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">
                  Sin vigencias todavía.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-gray-500 font-bold">
                    <tr>
                      <th className="text-left px-3 py-1.5">Valor</th>
                      <th className="text-left px-3 py-1.5">Desde</th>
                      <th className="text-left px-3 py-1.5">Hasta</th>
                      <th className="text-center px-3 py-1.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {col.rows.map((r) => (
                      <tr key={r.id} className={r.activo ? "bg-emerald-50/40" : ""}>
                        <td className="px-3 py-1.5 font-bold text-gray-800">
                          {r.valor}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">
                          {fmtFecha(r.vigenciaDesde)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">
                          {fmtFecha(r.vigenciaHasta)}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {r.activo ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">
                              <CheckCircle2 className="w-3 h-3" /> vigente
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-bold uppercase">
                              jubilada
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SECTION: GLOBAL — Markup Shipro global (blue accent).
//   Hero display + inline edit (cerrar+crear vigencia, mirror
//   /admin-parametros-tarifa). Collapsible history (top-10 vigencias). Note:
//   los couriers en modo HEREDA de la tabla superior usan este valor.
// -----------------------------------------------------------------------------

function SectionGlobal({
  activo,
  historial,
  expandido,
  setExpandido,
  editando,
  onEditToggle,
  onGuardar,
  guardando,
}: {
  activo: GlobalActivo;
  historial: VigenciaGlobal[];
  expandido: boolean;
  setExpandido: (v: boolean) => void;
  editando: boolean;
  onEditToggle: (v: boolean) => void;
  onGuardar: (valor: number) => void;
  guardando: boolean;
}) {
  const [valor, setValor] = useState<string>(
    activo ? String(activo.valorPorcentaje) : ""
  );
  useEffect(() => {
    if (editando) setValor(activo ? String(activo.valorPorcentaje) : "");
  }, [editando, activo]);

  const commit = () => {
    const n = parseFloat(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      alert("Markup Shipro global: ingresá un porcentaje entre 0 y 100.");
      return;
    }
    onGuardar(n);
  };

  const labelId = "global-markup-input";

  return (
    <section
      aria-labelledby="section-global-title"
      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
    >
      <header className="px-6 py-4 border-b border-gray-100 bg-blue-50/40 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-100 text-blue-700 border border-blue-200">
          <Percent className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2
            id="section-global-title"
            className="text-lg font-black text-gray-900 tracking-tight"
          >
            Markup Shipro global
          </h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Los couriers en modo <strong>HEREDA</strong> de la tabla superior aplican este valor en vivo. Editable por vigencias (asiento inverso).
          </p>
        </div>
      </header>

      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        <div className="md:col-span-1">
          <p className="text-[11px] font-black text-blue-700 uppercase tracking-wider mb-1">
            Vigente
          </p>
          <p className="text-4xl font-black text-[#233b6b] tracking-tight">
            {activo ? `${Number(activo.valorPorcentaje).toFixed(4)} %` : "sin configurar"}
          </p>
          {activo && (
            <p className="text-[11px] text-gray-600 mt-1">
              Vigente desde: {fmtFecha(activo.vigenciaDesde)}
            </p>
          )}
        </div>

        <div className="md:col-span-2 flex md:justify-end">
          {editando ? (
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor={labelId} className="sr-only">
                Nuevo markup Shipro global, en porcentaje
              </label>
              <input
                id={labelId}
                type="number"
                step="0.0001"
                min="0"
                max="100"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") onEditToggle(false);
                }}
                autoFocus
                className={
                  "w-32 border-2 border-blue-300 rounded-lg px-3 py-2 text-lg font-black text-gray-800 outline-none focus:border-blue-500 " +
                  focusRing
                }
                placeholder="0"
              />
              <button
                type="button"
                onClick={commit}
                disabled={guardando}
                aria-label="Guardar nueva vigencia del markup Shipro global"
                className={
                  "px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 text-sm font-bold " +
                  focusRing
                }
              >
                {guardando ? (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Save className="w-4 h-4" />
                )}{" "}
                Guardar
              </button>
              <button
                type="button"
                onClick={() => onEditToggle(false)}
                aria-label="Cancelar edición del markup Shipro global"
                className={
                  "px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg inline-flex items-center gap-1.5 text-sm font-bold " +
                  focusRing
                }
              >
                <X className="w-4 h-4" /> Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onEditToggle(true)}
              aria-label="Editar markup Shipro global"
              className={
                "px-3 py-2 bg-white border-2 border-blue-200 text-blue-700 rounded-lg hover:border-blue-400 hover:bg-blue-50 inline-flex items-center gap-1.5 text-sm font-bold transition-colors " +
                focusRing
              }
            >
              <Pencil className="w-4 h-4" /> Editar
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpandido(!expandido)}
        aria-expanded={expandido}
        aria-controls="global-historial"
        className={
          "w-full flex items-center gap-2 px-6 py-3 border-t border-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-50 " +
          focusRing
        }
      >
        {expandido ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <History className="w-4 h-4" />
        Historial de vigencias ({historial.length})
      </button>

      {expandido && (
        <div
          id="global-historial"
          className="border-t border-gray-100 overflow-x-auto motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-gray-600 text-xs uppercase tracking-wider font-black">
              <tr>
                <th className="text-left px-6 py-2">Valor</th>
                <th className="text-left px-6 py-2">Desde</th>
                <th className="text-left px-6 py-2">Hasta</th>
                <th className="text-center px-6 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {historial.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center text-gray-500 text-xs">
                    Sin vigencias todavía.
                  </td>
                </tr>
              ) : (
                historial.map((h) => (
                  <tr
                    key={h.id}
                    className={h.activo ? "bg-emerald-50/40" : ""}
                  >
                    <td className="px-6 py-2 font-bold text-gray-800">
                      {fmtPct(h.valorPorcentaje)}
                    </td>
                    <td className="px-6 py-2 text-gray-700">
                      {fmtFecha(h.vigenciaDesde)}
                    </td>
                    <td className="px-6 py-2 text-gray-700">
                      {fmtFecha(h.vigenciaHasta)}
                    </td>
                    <td className="px-6 py-2 text-center">
                      {h.activo ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">
                          <CheckCircle2 className="w-3 h-3" /> vigente
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-bold uppercase">
                          jubilada
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
    </section>
  );
}

// -----------------------------------------------------------------------------
// SECTION: FEE — por empresa (emerald accent).
//   Vista compacta per-empresa con edición inline (motivo REQUERIDO, cambia
//   plata en vivo). Search filter por nombre/CUIT. Link a /admin-fee para el
//   flow avanzado (mass-adjust + promos + historial completo).
//   Mirror del POST de /api/admin/operacion-fee.
// -----------------------------------------------------------------------------

function SectionFees({
  fees,
  search,
  setSearch,
  editando,
  guardando,
  setEditKey,
  onGuardar,
}: {
  fees: FilaFee[];
  search: string;
  setSearch: (v: string) => void;
  editando: Record<string, boolean>;
  guardando: Record<string, boolean>;
  setEditKey: (key: string, v: boolean) => void;
  onGuardar: (empresaId: number, tipo: FeeTipo, valor: number, motivo: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtradas = q
    ? fees.filter(
        (f) =>
          f.empresa.nombre.toLowerCase().includes(q) ||
          (f.empresa.cuit ?? "").toLowerCase().includes(q)
      )
    : fees;

  return (
    <section
      aria-labelledby="section-fee-title"
      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
    >
      <header className="px-6 py-4 border-b border-gray-100 bg-emerald-50/40 flex items-center gap-3 flex-wrap">
        <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200">
          <Receipt className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2
            id="section-fee-title"
            className="text-lg font-black text-gray-900 tracking-tight"
          >
            Fee por empresa
          </h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Fee de operación (per empresa) — <strong>mueve plata en vivo</strong>. Motivo obligatorio. Para ajustes masivos, promos con vencimiento e historial completo, usá{" "}
            <Link
              href="/admin-fee"
              className={"underline text-emerald-800 hover:text-emerald-900 " + focusRing}
            >
              /admin-fee
            </Link>
            .
          </p>
        </div>
        <Link
          href="/admin-fee"
          className={
            "px-3 py-1.5 bg-white border-2 border-emerald-200 text-emerald-800 rounded-lg hover:border-emerald-400 hover:bg-emerald-50 inline-flex items-center gap-1.5 text-xs font-bold transition-colors " +
            focusRing
          }
        >
          Flujo completo <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </header>

      <div className="px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-2">
        <label htmlFor="fee-search" className="sr-only">
          Buscar empresa por nombre o CUIT
        </label>
        <input
          id="fee-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar empresa por nombre o CUIT…"
          className={
            "flex-1 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-emerald-500 " +
            focusRing
          }
        />
        <span className="text-xs text-gray-600">
          {filtradas.length} de {fees.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-gray-700 text-xs uppercase tracking-wider font-black">
            <tr>
              <th className="px-6 py-2">Empresa</th>
              <th className="px-6 py-2">CUIT</th>
              <th className="px-6 py-2 min-w-[280px]">Fee vigente</th>
              <th className="px-6 py-2 text-right min-w-[100px]">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-6 py-4 text-center text-gray-500 text-xs"
                >
                  {q
                    ? `Sin empresas que coincidan con "${search}".`
                    : "No hay empresas activas."}
                </td>
              </tr>
            ) : (
              filtradas.map((f) => (
                <RowFee
                  key={f.empresa.id}
                  fila={f}
                  editando={!!editando[`fee-${f.empresa.id}`]}
                  onEditToggle={(v) => setEditKey(`fee-${f.empresa.id}`, v)}
                  guardando={!!guardando[`fee-${f.empresa.id}`]}
                  onGuardar={onGuardar}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowFee({
  fila,
  editando,
  onEditToggle,
  guardando,
  onGuardar,
}: {
  fila: FilaFee;
  editando: boolean;
  onEditToggle: (v: boolean) => void;
  guardando: boolean;
  onGuardar: (empresaId: number, tipo: FeeTipo, valor: number, motivo: string) => void;
}) {
  const vigente = fila.fee;
  const [tipo, setTipo] = useState<FeeTipo>(vigente?.tipo ?? "FIJO");
  const [valor, setValor] = useState<string>(vigente ? String(vigente.valor) : "");
  const [motivo, setMotivo] = useState<string>("");

  useEffect(() => {
    if (editando) {
      setTipo(vigente?.tipo ?? "FIJO");
      setValor(vigente ? String(vigente.valor) : "");
      setMotivo("");
    }
  }, [editando, vigente]);

  const commit = () => {
    const n = parseFloat(valor);
    const min = 0.01;
    const max = tipo === "PORCENTAJE" ? 100 : 1_000_000;
    if (!Number.isFinite(n) || n < min || n > max) {
      alert(
        `Fee (${tipo}): ingresá un valor entre ${min} y ${max} ${
          tipo === "PORCENTAJE" ? "%" : "ARS"
        }.`
      );
      return;
    }
    if (motivo.trim().length === 0) {
      alert("El motivo es obligatorio (el Fee mueve plata en vivo).");
      return;
    }
    onGuardar(fila.empresa.id, tipo, n, motivo.trim());
  };

  return (
    <tr className="hover:bg-slate-50/40 align-top">
      <td className="px-6 py-3 font-black text-gray-900">{fila.empresa.nombre}</td>
      <td className="px-6 py-3 text-gray-700 text-xs font-mono">
        {fila.empresa.cuit ?? "—"}
      </td>
      <td className="px-6 py-3">
        {!editando ? (
          <div>
            {vigente ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900">
                  {vigente.tipo}
                </span>
                <span className="text-base font-black text-gray-900">
                  {vigente.tipo === "PORCENTAJE"
                    ? `${Number(vigente.valor).toFixed(2)} %`
                    : fmtMoney(vigente.valor)}
                </span>
              </div>
            ) : (
              <span className="text-sm text-gray-500">sin configurar</span>
            )}
            {vigente && (
              <p className="text-[11px] text-gray-600 mt-0.5">
                Vigente desde: {fmtFecha(vigente.vigenteDesde)}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              role="radiogroup"
              aria-label={`Tipo de Fee para ${fila.empresa.nombre}`}
              className="inline-flex items-center gap-1"
            >
              {(["FIJO", "PORCENTAJE"] as FeeTipo[]).map((t) => {
                const sel = tipo === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setTipo(t)}
                    className={
                      "px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider border transition-colors " +
                      focusRing +
                      " " +
                      (sel
                        ? "bg-[#233b6b] text-white border-[#233b6b]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300")
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor={`fee-valor-${fila.empresa.id}`} className="sr-only">
                Valor del Fee para {fila.empresa.nombre},{" "}
                {tipo === "PORCENTAJE" ? "en porcentaje" : "en pesos"}
              </label>
              <input
                id={`fee-valor-${fila.empresa.id}`}
                type="number"
                step={tipo === "PORCENTAJE" ? "0.01" : "0.01"}
                min="0.01"
                max={tipo === "PORCENTAJE" ? "100" : "1000000"}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                autoFocus
                className={
                  "w-32 border-2 border-emerald-300 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-800 outline-none focus:border-emerald-500 " +
                  focusRing
                }
                placeholder={tipo === "PORCENTAJE" ? "0.00 %" : "0.00 ARS"}
              />
            </div>
            <label htmlFor={`fee-motivo-${fila.empresa.id}`} className="sr-only">
              Motivo del cambio del Fee (obligatorio)
            </label>
            <input
              id={`fee-motivo-${fila.empresa.id}`}
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (obligatorio — se persiste en el audit)"
              className={
                "border-2 border-emerald-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-500 " +
                focusRing
              }
            />
            <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              ⚠ Cambia plata en vivo en el próximo envío de esta empresa.
            </p>
          </div>
        )}
      </td>
      <td className="px-6 py-3 text-right">
        {!editando ? (
          <button
            type="button"
            onClick={() => onEditToggle(true)}
            aria-label={`Editar Fee de ${fila.empresa.nombre}`}
            className={
              "px-2.5 py-1.5 bg-white border-2 border-emerald-200 text-emerald-800 rounded-lg hover:border-emerald-400 hover:bg-emerald-50 inline-flex items-center gap-1 text-xs font-bold transition-colors " +
              focusRing
            }
          >
            <Pencil className="w-3.5 h-3.5" /> Editar
          </button>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={commit}
              disabled={guardando}
              aria-label="Guardar nueva vigencia del Fee"
              className={
                "p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 " +
                focusRing
              }
            >
              {guardando ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onEditToggle(false)}
              aria-label="Cancelar edición del Fee"
              className={"p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg " + focusRing}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------------
// SECTION: IVA — constante (slate accent). Display-only.
//   Hoy la tasa AR está en lib/constants/iva.ts (fuente única). La promoción
//   a modelo editable (IvaVigencia) es sub-pieza futura, fuera del scope de
//   la consola de Pieza 2.
// -----------------------------------------------------------------------------

function SectionIva({ iva }: { iva: IvaInfo | null }) {
  if (!iva) return null;
  return (
    <section
      aria-labelledby="section-iva-title"
      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
    >
      <header className="px-6 py-4 border-b border-gray-100 bg-slate-50/50 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h2
            id="section-iva-title"
            className="text-lg font-black text-gray-900 tracking-tight"
          >
            IVA
          </h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Se aplica una sola vez al final de la cascada. Constante en código hoy.
          </p>
        </div>
      </header>

      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        <div className="md:col-span-1">
          <p className="text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1">
            Multiplicador
          </p>
          <p className="text-4xl font-black text-[#233b6b] tracking-tight">
            × {iva.multiplier.toFixed(2)}
          </p>
          <p className="text-[11px] text-gray-600 mt-1">
            Equivalente a {iva.porcentaje.toFixed(0)} % de IVA (tasa AR vigente).
          </p>
        </div>
        <div className="md:col-span-2 text-xs text-gray-700 space-y-1">
          <p>
            <strong>Fuente única:</strong>{" "}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">
              lib/constants/iva.ts
            </code>
            . Editable solo con code push.
          </p>
          <p className="text-gray-600">
            Una futura sub-pieza puede promoverlo a un modelo editable (IvaVigencia con vigencias, mirror de MarkupShiproVigencia). Hoy display-only.
          </p>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Page.
// -----------------------------------------------------------------------------

export default function ConsolaTarifaPage() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [globalActivo, setGlobalActivo] = useState<GlobalActivo>(null);
  const [globalHistorial, setGlobalHistorial] = useState<VigenciaGlobal[]>([]);
  const [fees, setFees] = useState<FilaFee[]>([]);
  const [iva, setIva] = useState<IvaInfo | null>(null);

  // Edit state keyed by `${type}-${courierId}` — solo una celda editable por
  // vez por row (UX: focused edit, no confusión).
  const [editando, setEditando] = useState<Record<string, boolean>>({});
  const [guardando, setGuardando] = useState<Record<string, boolean>>({});

  // Accordion state keyed by courierId.
  const [expandido, setExpandido] = useState<Record<number, boolean>>({});
  // Accordion state global markup + Fee search filter.
  const [globalHistExpandido, setGlobalHistExpandido] = useState(false);
  const [feeSearch, setFeeSearch] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/consola-tarifa");
      if (res.ok) {
        const data = await res.json();
        setFilas(data.filas || []);
        setGlobalActivo(data.globalActivo ?? null);
        setGlobalHistorial(data.globalHistorial || []);
        setFees(data.fees || []);
        setIva(data.iva ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (esAdminShipro) cargar();
    else setCargando(false);
  }, [esAdminShipro, cargar]);

  const setEditKey = (key: string, v: boolean) =>
    setEditando((s) => ({ ...s, [key]: v }));
  const setSaveKey = (key: string, v: boolean) =>
    setGuardando((s) => ({ ...s, [key]: v }));

  // Save handlers — cada uno POSTea al endpoint atómico. Reusan cerrar+crear
  // vigencia existente. Cero duplicación.
  const doPost = async (
    url: string,
    body: Record<string, unknown>,
    saveKey: string,
    editKey: string
  ) => {
    setSaveKey(saveKey, true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditKey(editKey, false);
        cargar();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      setSaveKey(saveKey, false);
    }
  };

  if (!esAdminShipro) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 p-8">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-100 max-w-md text-center">
          <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800 mb-1">
            Acceso restringido
          </h3>
          <p className="text-sm text-gray-600">
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
            <h1 className="text-2xl font-black text-gray-800 tracking-tight">
              Consola de tarifa — variables por courier
            </h1>
            <p className="text-sm font-medium text-gray-600 mt-1">
              Vista unificada de las 3 variables per-courier de la cascada de tarifa: markup del dueño, markup de Shipro (con toggle HEREDA/PROPIO) y SMO. Markup global de Shipro, Fee por empresa e IVA en piezas siguientes.
            </p>
            <p className="text-[11px] font-medium text-slate-700 mt-2">
              Fórmula completa:{" "}
              <code className="text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                tarifa API → +markup dueño → +markup Shipro → +SMO → +Fee → ×IVA
              </code>
            </p>
            {globalActivo && (
              <p className="text-xs font-bold text-blue-700 mt-2">
                Markup Shipro global vigente:{" "}
                <span className="bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                  {fmtPct(globalActivo.valorPorcentaje)}
                </span>
                <span className="text-blue-600 font-normal ml-1">
                  — es el valor que siguen los couriers en modo HEREDA.
                </span>
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {cargando ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none mx-auto mb-2" />{" "}
            Cargando…
          </div>
        ) : (
          <>
          {filas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-600">
            No hay couriers activos.
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-700 font-black">
                  <tr>
                    <th scope="col" className="px-6 py-3 min-w-[220px]">
                      Courier
                    </th>
                    <th scope="col" className="px-6 py-3 min-w-[220px]">
                      <span className="inline-flex items-center gap-1.5 text-purple-700">
                        <Handshake className="w-3.5 h-3.5" />
                        Markup del dueño
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 min-w-[280px]">
                      <span className="inline-flex items-center gap-1.5 text-blue-700">
                        <Percent className="w-3.5 h-3.5" />
                        Markup de Shipro
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 min-w-[220px]">
                      <span className="inline-flex items-center gap-1.5 text-amber-700">
                        <Shield className="w-3.5 h-3.5" />
                        SMO
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {filas.map((f) => {
                    const abierto = !!expandido[f.courier.id];
                    return (
                      <Fragment key={f.courier.id}>
                        <tr className="hover:bg-slate-50/40">
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandido((s) => ({
                                    ...s,
                                    [f.courier.id]: !abierto,
                                  }))
                                }
                                aria-expanded={abierto}
                                aria-controls={`historial-${f.courier.id}`}
                                aria-label={
                                  abierto
                                    ? `Cerrar historial de ${f.courier.nombre}`
                                    : `Ver historial de ${f.courier.nombre}`
                                }
                                className={
                                  "mt-0.5 p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors " +
                                  focusRing
                                }
                              >
                                {abierto ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                              <div>
                                <p className="text-base font-black text-gray-900">
                                  {f.courier.nombre}
                                </p>
                                <p className="text-[11px] text-gray-600 mt-0.5">
                                  Ver historial de vigencias
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <CellDueno
                              fila={f}
                              editando={!!editando[`dueno-${f.courier.id}`]}
                              onEditToggle={(v) =>
                                setEditKey(`dueno-${f.courier.id}`, v)
                              }
                              onGuardar={(valor) =>
                                doPost(
                                  "/api/admin/markup-dueno",
                                  { courierId: f.courier.id, valorPorcentaje: valor },
                                  `dueno-${f.courier.id}`,
                                  `dueno-${f.courier.id}`
                                )
                              }
                              guardando={!!guardando[`dueno-${f.courier.id}`]}
                            />
                          </td>
                          <td className="px-6 py-4 align-top">
                            <CellShipro
                              fila={f}
                              editando={!!editando[`shipro-${f.courier.id}`]}
                              onEditToggle={(v) =>
                                setEditKey(`shipro-${f.courier.id}`, v)
                              }
                              onGuardar={(modo, valor) =>
                                doPost(
                                  "/api/admin/markup-courier",
                                  {
                                    courierId: f.courier.id,
                                    modo,
                                    valorPorcentaje: valor,
                                  },
                                  `shipro-${f.courier.id}`,
                                  `shipro-${f.courier.id}`
                                )
                              }
                              guardando={!!guardando[`shipro-${f.courier.id}`]}
                              globalActivo={globalActivo}
                            />
                          </td>
                          <td className="px-6 py-4 align-top">
                            <CellSmo
                              fila={f}
                              editando={!!editando[`smo-${f.courier.id}`]}
                              onEditToggle={(v) =>
                                setEditKey(`smo-${f.courier.id}`, v)
                              }
                              onGuardar={(valor) =>
                                doPost(
                                  "/api/admin/smo-courier",
                                  { courierId: f.courier.id, valorNeto: valor },
                                  `smo-${f.courier.id}`,
                                  `smo-${f.courier.id}`
                                )
                              }
                              guardando={!!guardando[`smo-${f.courier.id}`]}
                            />
                          </td>
                        </tr>
                        {abierto && (
                          <tr
                            id={`historial-${f.courier.id}`}
                            className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
                          >
                            <td colSpan={4} className="p-0">
                              <HistorialAccordion fila={f} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-slate-50/50 text-[11px] text-gray-600">
              Cada guardado cierra la vigencia actual del courier y crea una nueva (asiento inverso). Nunca se pisa el valor anterior. Las pantallas individuales (Markup del Dueño, Markup por Courier, SMO por Courier) siguen operativas — la consola escribe a los mismos modelos (fuente única).
            </div>
          </div>
        )}

        {/* SECCIÓN GLOBAL — Markup Shipro global */}
        <SectionGlobal
          activo={globalActivo}
          historial={globalHistorial}
          expandido={globalHistExpandido}
          setExpandido={setGlobalHistExpandido}
          onGuardar={(valor) =>
            doPost(
              "/api/admin/markup-shipro",
              { valorPorcentaje: valor },
              "global",
              "global"
            )
          }
          editando={!!editando["global"]}
          onEditToggle={(v) => setEditKey("global", v)}
          guardando={!!guardando["global"]}
        />

        {/* SECCIÓN FEE — por empresa */}
        <SectionFees
          fees={fees}
          search={feeSearch}
          setSearch={setFeeSearch}
          editando={editando}
          guardando={guardando}
          setEditKey={setEditKey}
          onGuardar={(empresaId, tipo, valor, motivo) =>
            doPost(
              "/api/admin/operacion-fee",
              { empresaId, tipo, valor, motivo },
              `fee-${empresaId}`,
              `fee-${empresaId}`
            )
          }
        />

        {/* SECCIÓN IVA — constante en código */}
        <SectionIva iva={iva} />
          </>
        )}
      </div>
    </div>
  );
}
