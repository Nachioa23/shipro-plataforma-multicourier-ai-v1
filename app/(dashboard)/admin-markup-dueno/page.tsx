"use client";

// DEUDA 170 Pieza 2 (2026-09-08): pantalla admin del markup del INTERMEDIARIO/
// dueño de credenciales, POR COURIER que despacha. Reescrito para apuntar al
// modelo NUEVO MarkupIntermediarioCourier (Pieza 1) — hermano de MarkupCourier,
// per-courier + vigencias, sin toggle HEREDA/PROPIO (el intermediario no tiene
// un valor global del cual heredar — cada courier tiene su propio %, o 0 si
// sus creds son de Shipro).
//
// SEMÁNTICA — QUÉ ES ESTA PANTALLA (modelo Nacho per-courier):
// - Cada fila = "cuando se despacha con ESTE courier, cuánto cobra el dueño
//   de sus credenciales". Ej. fila "Andreani" = 10% si sus creds son de Mocis;
//   fila "Andreani" = 0 si sus creds son de Shipro.
// - Valor 0 = las credenciales de este courier son de Shipro (sin intermediario).
// - Distinto del markup de SHIPRO que va en /admin-markup-courier (esa pantalla
//   es otro pricing dimension — el margen Shipro sobre el neto).
//
// CONFIG↔ENGINE: la UI escribe `MarkupIntermediarioCourier.valorPorcentaje`
// keyed por `courierId` (el courier que despacha). El engine leerá EXACTAMENTE
// ese field/key en Pieza 4 (rewire del resolver: `findFirst({ courierId })`).
// Mientras tanto (Pieza 2 → Pieza 4), el motor SIGUE leyendo el modelo viejo
// CourierIntermediario → editar acá NO cambia precios hasta el rewire. Esto
// permite a Nacho POBLAR la fuente de verdad futura antes del swap del motor.
// Consistent con el playbook DEUDA 157 / SmoCourier (modelo aislado antes del wire).

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Handshake,
  Loader2,
  CheckCircle2,
  History,
  Save,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type Vigencia = {
  id: number;
  courierId: number;
  valorPorcentaje: string; // Decimal serialized as string via JSON
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

export default function AdminMarkupDueno() {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === "admin_shipro";

  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [nuevoValor, setNuevoValor] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [expandido, setExpandido] = useState<Record<number, boolean>>({});

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/markup-dueno");
      if (res.ok) {
        const data = await res.json();
        const filasResp: Fila[] = data.filas || [];
        setFilas(filasResp);
        // Prefill con el valor de la vigencia activa (o "" si no hay).
        const valores: Record<number, string> = {};
        for (const f of filasResp) {
          valores[f.courier.id] = f.activa ? String(f.activa.valorPorcentaje) : "";
        }
        setNuevoValor(valores);
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
    const rawValor = nuevoValor[courierId] || "";
    const valor = parseFloat(rawValor);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      alert(
        "Ingresá un porcentaje válido entre 0 y 100 (0 = las credenciales de este courier son de Shipro; sin intermediario)."
      );
      return;
    }

    const previaStr = fila.activa
      ? `${fmtPct(fila.activa.valorPorcentaje)}`
      : "sin vigencia activa";
    const nuevaStr =
      valor === 0
        ? "0% — sin intermediario (creds Shipro)"
        : `${fmtPct(valor)} — el dueño de las creds cobra este %`;
    const ok = confirm(
      `Vas a crear una nueva vigencia del markup del INTERMEDIARIO para ${fila.courier.nombre}:\n` +
        `  Anterior: ${previaStr}\n` +
        `  Nueva:    ${nuevaStr}\n\n` +
        `Este valor se cobrará cuando se despache con ${fila.courier.nombre} (una vez que Pieza 4 conecte el motor a la nueva tabla). ` +
        `La vigencia actual queda jubilada (activo=false, vigenciaHasta=hoy) — es un asiento inverso, nunca se pisa el valor anterior. ¿Confirmás?`
    );
    if (!ok) return;

    setGuardando((s) => ({ ...s, [courierId]: true }));
    try {
      const res = await fetch("/api/admin/markup-dueno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierId, valorPorcentaje: valor }),
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
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700 border border-purple-100">
            <Handshake className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">
              Markup del Intermediario por Courier
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              % que el <strong>dueño de las credenciales</strong> de este courier cobra sobre la tarifa,
              cuando se despacha con él (ej. Andreani cuyas creds presta Mocis → fila Andreani = 10%).
              Valor <strong>0</strong> = las credenciales son de Shipro (sin intermediario).
              Editable con vigencias (asiento inverso).
            </p>
            <p className="text-xs font-bold text-purple-700 mt-2">
              Distinto del <a href="/admin-markup-courier" className="underline hover:text-purple-900">markup Shipro por courier</a>: este es el % del DUEÑO de las creds, aquél es el margen que agrega Shipro.
            </p>
            <p className="text-[11px] font-medium text-amber-700 mt-1">
              ⚠ Tabla nueva (DEUDA 170 Pieza 1). El motor la lee recién en Pieza 4 — hasta entonces, editar acá NO cambia precios en vivo (populación previa al rewire).
            </p>
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
            return (
              <div
                key={f.courier.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Courier (que despacha)
                    </p>
                    <h3 className="text-xl font-black text-gray-800">
                      {f.courier.nombre}
                    </h3>
                  </div>
                  <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">
                      Vigente
                    </p>
                    {f.activa ? (
                      <>
                        <p className="text-2xl font-black text-purple-900">
                          {fmtPct(f.activa.valorPorcentaje)}
                        </p>
                        <p className="text-[10px] text-purple-700 mt-1">
                          {Number(f.activa.valorPorcentaje) === 0
                            ? "Sin intermediario (creds Shipro)"
                            : "El dueño de las creds cobra este %"}
                        </p>
                      </>
                    ) : (
                      <p className="text-2xl font-black text-purple-900">sin configurar</p>
                    )}
                    <p className="text-[10px] text-purple-700 mt-1">
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
                        Valor (%)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="100"
                        required
                        value={nuevoValor[f.courier.id] ?? ""}
                        onChange={(e) =>
                          setNuevoValor((s) => ({
                            ...s,
                            [f.courier.id]: e.target.value,
                          }))
                        }
                        className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-base font-black text-gray-800 outline-none focus:border-purple-500"
                        placeholder="Ej: 10 (0 = creds Shipro, sin intermediario)"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        0% = las credenciales de este courier son de Shipro (no hay intermediario cobrando).
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
                      Cierra la vigencia actual y crea una nueva. Nunca sobrescribe.
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
                          <th className="px-6 py-3">Valor (%)</th>
                          <th className="px-6 py-3">Vigencia desde</th>
                          <th className="px-6 py-3">Vigencia hasta</th>
                          <th className="px-6 py-3 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-sm">
                        {f.historial.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-gray-400">
                              Sin vigencias todavía.
                            </td>
                          </tr>
                        ) : (
                          f.historial.map((h) => (
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
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
