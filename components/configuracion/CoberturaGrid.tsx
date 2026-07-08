"use client";

// =============================================================================
// CoberturaGrid — DEUDA 36.E Phase 4a (2026-07-08)
// =============================================================================
//
// Componente de VISUALIZACIÓN de la cobertura por courier para un depósito.
// Consume /api/depositos/[id]/couriers-elegibles (Phase 1). Renderiza:
//   - Un picker de recolector (dry-run del origen dinámico).
//   - Una fila por courier con estado / color / icono / sub-línea / cpOrigen.
//   - Re-fetch on-change cuando el usuario elige un recolector distinto:
//     el endpoint recalcula el cpOrigenEfectivo por courier y devuelve una
//     nueva grilla — el mismo componente re-renderiza sobre datos frescos.
//
// DISPLAY ONLY: cero writes. El <select> sólo modifica estado local y
// dispara un GET. La persistencia del recolector + la creación de
// DepositoCourierConfig son Phase 4b (no incluidos acá).
//
// Reutilizable: mismo componente para el wizard de onboarding y para el
// modal de edición del depósito (Phase 4c/d).
// =============================================================================

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Package,
  Truck,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ResultadoAutoAsignacion } from "@/lib/sucursales/cercanas";

// -----------------------------------------------------------------------------
// Tipos del response del endpoint. Se replican localmente para no acoplar a la
// forma exacta del handler; el shape es contract-verified.
// -----------------------------------------------------------------------------

interface CourierElegible {
  courierId: number;
  nombre: string;
  activo: boolean;
  puedeConsolidar: boolean;
  cpDepositoConsolidador: string | null;
  tieneCredencial: boolean;
  credencialActiva: boolean;
  tieneConfig: boolean;
  dropOffCliente: boolean;
  recogeViaConsolidador: boolean;
  cpOrigenEfectivo: string;
  cobertura: ResultadoAutoAsignacion;
}

interface CoberturaResponse {
  deposito: {
    id: number;
    nombre: string;
    codigoPostal: string;
    courierRecolectorId: number | null;
  };
  recolectorProyectadoId: number | null;
  couriers: CourierElegible[];
}

interface Props {
  depositoId: number;
  initialRecolectorId?: number | null;
  onRecolectorChange?: (id: number | null) => void;
}

// -----------------------------------------------------------------------------
// Sort helper: recolector primero, luego activable (verde), luego ámbar, luego
// bloqueado (rojo). Dentro de cada grupo, orden estable por nombre.
// -----------------------------------------------------------------------------

function tipoRank(t: ResultadoAutoAsignacion["tipo"]): number {
  switch (t) {
    case "por_cp":
    case "sucursal_unica":
      return 1;
    case "drop_off_cliente":
      return 2;
    case "sin_cobertura":
    case "sin_sucursales":
      return 3;
  }
}

// -----------------------------------------------------------------------------
// Componente principal.
// -----------------------------------------------------------------------------

export default function CoberturaGrid({
  depositoId,
  initialRecolectorId = null,
  onRecolectorChange,
}: Props) {
  const [data, setData] = useState<CoberturaResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [recolectorSeleccionado, setRecolectorSeleccionado] = useState<
    number | null
  >(initialRecolectorId ?? null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      try {
        const query =
          recolectorSeleccionado != null
            ? `?recolectorProyectadoId=${recolectorSeleccionado}`
            : "";
        const res = await fetch(
          `/api/depositos/${depositoId}/couriers-elegibles${query}`
        );
        if (!res.ok) throw new Error("couriers-elegibles no disponible");
        const parsed = (await res.json()) as CoberturaResponse;
        if (!cancelado) {
          setData(parsed);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelado) setError(e?.message || "Error al cargar cobertura");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [depositoId, recolectorSeleccionado]);

  // --- Estados vacíos ---

  // Sin data + cargando: loader centrado en un card mínimo.
  if (!data && loading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </section>
    );
  }

  // Sin data + no cargando (error inicial): banner de error.
  if (!data) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">
          Cobertura por courier
        </h3>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error ?? "No se pudo cargar la cobertura."}
        </div>
      </section>
    );
  }

  // --- Data cargada: render normal (con o sin loading overlay) ---

  const consolidadoresDisponibles = data.couriers.filter(
    (c) => c.puedeConsolidar && c.activo
  );

  const couriersOrdenados = [...data.couriers].sort((a, b) => {
    const aIsRecolector = a.courierId === recolectorSeleccionado ? 0 : 1;
    const bIsRecolector = b.courierId === recolectorSeleccionado ? 0 : 1;
    if (aIsRecolector !== bIsRecolector) return aIsRecolector - bIsRecolector;
    const rankDiff = tipoRank(a.cobertura.tipo) - tipoRank(b.cobertura.tipo);
    if (rankDiff !== 0) return rankDiff;
    return a.nombre.localeCompare(b.nombre);
  });

  return (
    <section
      className={`bg-white border border-gray-200 rounded-xl p-5 space-y-4 ${
        loading ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">
          Cobertura por courier
        </h3>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
      </div>
      <p className="text-[10px] text-gray-500">
        <span className="text-green-700 font-bold">verde</span> = cubre ·{" "}
        <span className="text-red-700 font-bold">rojo</span> = sin cobertura ·{" "}
        <span className="text-amber-700 font-bold">ámbar</span> = revisar
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {/* Picker de recolector — dry-run del origen dinámico. */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2">
        <label className="block text-xs font-bold text-indigo-900">
          Courier recolector (consolidador)
        </label>
        <select
          value={recolectorSeleccionado ?? ""}
          onChange={(e) => {
            const nuevo = e.target.value ? parseInt(e.target.value) : null;
            setRecolectorSeleccionado(nuevo);
            onRecolectorChange?.(nuevo);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">Sin recolector</option>
          {consolidadoresDisponibles.map((c) => (
            <option key={c.courierId} value={c.courierId}>
              {c.nombre}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-indigo-700">
          Al elegir un recolector, cada otro courier se evalúa contra el CP del hub
          del recolector — no contra el CP del depósito.
        </p>
      </div>

      {/* Lista de couriers con su cobertura. */}
      <div className="space-y-2">
        {couriersOrdenados.map((c) => (
          <CoberturaRow
            key={c.courierId}
            courier={c}
            esRecolector={c.courierId === recolectorSeleccionado}
          />
        ))}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Fila de un courier.
// -----------------------------------------------------------------------------

interface RowProps {
  courier: CourierElegible;
  esRecolector: boolean;
}

function CoberturaRow({ courier, esRecolector }: RowProps) {
  const visual = mapearCobertura(courier.cobertura);
  const Icono = visual.Icon;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${visual.tint}`}>
      <Icono className={`w-5 h-5 shrink-0 ${visual.iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold flex items-center gap-2 flex-wrap">
          <span>{courier.nombre}</span>
          {esRecolector && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-100 text-indigo-800 rounded px-2 py-0.5">
              Recolector
            </span>
          )}
          {courier.puedeConsolidar && !esRecolector && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-600 rounded px-2 py-0.5">
              Consolidador
            </span>
          )}
          {!courier.tieneCredencial && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 rounded px-2 py-0.5">
              Sin credencial
            </span>
          )}
        </div>
        <div className={`text-[11px] ${visual.subtone}`}>{visual.subline}</div>
      </div>
      <span className="text-[10px] text-gray-500 ml-auto whitespace-nowrap">
        origen CP {courier.cpOrigenEfectivo}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Mapeo cobertura → tint / icon / subline.
// -----------------------------------------------------------------------------

interface Visual {
  tint: string;
  Icon: LucideIcon;
  iconColor: string;
  subtone: string;
  subline: string;
}

function mapearCobertura(cobertura: ResultadoAutoAsignacion): Visual {
  switch (cobertura.tipo) {
    case "por_cp": {
      const km = cobertura.sucursal.distanciaKm;
      const subline =
        cobertura.sucursal.nombre +
        (km != null ? ` — ${km.toFixed(1)} km` : "");
      return {
        tint: "bg-green-100 border-green-300",
        Icon: CheckCircle2,
        iconColor: "text-green-600",
        subtone: "text-green-900",
        subline,
      };
    }
    case "sucursal_unica":
      return {
        tint: "bg-green-100 border-green-300",
        Icon: Truck,
        iconColor: "text-green-600",
        subtone: "text-green-900",
        subline: `Depósito consolidador (CP ${cobertura.cp})`,
      };
    case "drop_off_cliente":
      return {
        tint: "bg-amber-50 border-amber-200",
        Icon: Package,
        iconColor: "text-amber-600",
        subtone: "text-amber-800",
        subline:
          cobertura.opciones.length > 0
            ? `Cliente elige entre ${cobertura.opciones.length} sucursales cercanas`
            : "Depósito sin geocodificación",
      };
    case "sin_cobertura":
      return {
        tint: "bg-red-50 border-red-200",
        Icon: AlertCircle,
        iconColor: "text-red-600",
        subtone: "text-red-700",
        subline: cobertura.mensaje,
      };
    case "sin_sucursales":
      return {
        tint: "bg-red-50 border-red-200",
        Icon: AlertCircle,
        iconColor: "text-red-600",
        subtone: "text-red-700",
        subline: cobertura.mensaje,
      };
  }
}
