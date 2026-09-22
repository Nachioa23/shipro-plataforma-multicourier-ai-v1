"use client";

// ============================================================================
// MEF Fase 2.2 — Panel client-side de asignación courier↔zona Flex. [[DEUDA 180]]
//
// El cliente asigna 1 courier de su cartera (CredencialCourier activo) por cada
// zona Flex vigente que ML declara para su cuenta. Exclusiva: 1 zona = 1
// courier; reasignar reemplaza.
//
// Colores por estado:
//   - zona enabled + con courier      → verde
//   - zona enabled + SIN courier      → rojo "Acción requerida"
//   - zona enabled=false              → gris (dropdown deshabilitado)
//
// Data:
//   GET  /api/empresa/mercadolibre/couriers-flex → zonas + asignaciones + couriers
//   PUT  /api/empresa/mercadolibre/couriers-flex → { zoneIdMl, courierId }
// empresaId sale del JWT en ambos verbos; el UI no manda ni empresaId ni token.
// ============================================================================

import { useEffect, useState } from "react";
import {
  Truck,
  Loader2,
  AlertCircle,
  MapPin,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";

type Zona = {
  id: number;
  zoneIdMl: string;
  nombre: string;
  enabled: boolean;
  asignacion: { courierId: number; courierNombre: string } | null;
};

type Courier = { id: number; nombre: string };

type Payload = {
  cuentaConectada: boolean;
  flexConfigurado?: boolean;
  zonas: Zona[];
  couriersDisponibles: Courier[];
};

const BRAND = "#233b6b";

export default function ConfiguracionCouriersFlexPage() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null); // zoneIdMl en curso
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: "ok" | "error" } | null>(null);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/empresa/mercadolibre/couriers-flex");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error HTTP ${res.status}`);
        setCargando(false);
        return;
      }
      setData(body as Payload);
    } catch {
      setError("Error de red");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const asignar = async (zoneIdMl: string, courierId: number) => {
    setGuardando(zoneIdMl);
    setMensaje(null);
    try {
      const res = await fetch("/api/empresa/mercadolibre/couriers-flex", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneIdMl, courierId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({ texto: body?.error || `Error HTTP ${res.status}`, tipo: "error" });
        setGuardando(null);
        return;
      }
      // Refresh local para reflejar la asignación.
      await cargar();
      setMensaje({ texto: "Asignación guardada.", tipo: "ok" });
    } catch {
      setMensaje({ texto: "Error de red al guardar.", tipo: "error" });
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h3 className="text-lg font-black text-gray-800 tracking-tight flex items-center gap-2">
          <Truck className="w-5 h-5 text-indigo-500" /> Couriers para Mercado Envíos Flex
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Asigná un courier de tu cartera a cada zona Flex de tu cuenta de Mercado Libre. Las zonas y sus códigos postales los define ML; vos elegís quién despacha cada zona.
        </p>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-white rounded-lg border border-gray-200 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando zonas...
        </div>
      )}

      {error && !cargando && (
        <div className="flex items-start gap-2 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">No se pudo cargar la configuración.</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {!cargando && !error && data && (
        <>
          {!data.cuentaConectada && (
            <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Tu cuenta de Mercado Libre no está conectada.</p>
                <p className="text-xs mt-1">
                  Conectala primero en <span className="font-mono">Conexiones</span> para que Shipro pueda leer tus zonas Flex.
                </p>
              </div>
            </div>
          )}

          {data.cuentaConectada && data.zonas.length === 0 && (
            <div className="flex items-start gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
              <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
              <div>
                <p className="font-bold">Todavía no hay zonas Flex sincronizadas.</p>
                <p className="text-xs mt-1">
                  Si ya configuraste Flex en Mercado Libre, la próxima sincronización va a traerlas. Si aún no configuraste Flex allá, hacelo primero en tu panel de ML.
                </p>
              </div>
            </div>
          )}

          {data.cuentaConectada && data.zonas.length > 0 && data.couriersDisponibles.length === 0 && (
            <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">No tenés couriers activos.</p>
                <p className="text-xs mt-1">
                  Activá primero al menos un courier en <span className="font-mono">Transportes</span> — solo se pueden asignar couriers que estén operativos en tu cuenta.
                </p>
              </div>
            </div>
          )}

          {data.cuentaConectada && data.zonas.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-100">
                {data.zonas.map((z) => {
                  const asignado = z.enabled && z.asignacion !== null;
                  const requiereAccion = z.enabled && z.asignacion === null;
                  const deshabilitada = !z.enabled;

                  return (
                    <div
                      key={z.zoneIdMl}
                      className={`flex items-start justify-between gap-4 px-5 py-4 ${
                        deshabilitada ? "bg-gray-50" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p
                            className={`font-black text-sm truncate ${
                              deshabilitada ? "text-gray-400" : "text-gray-800"
                            }`}
                          >
                            {z.nombre || `Zona ${z.zoneIdMl}`}
                          </p>
                          {asignado && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Asignada
                            </span>
                          )}
                          {requiereAccion && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                              <CircleAlert className="w-3 h-3" /> Acción requerida
                            </span>
                          )}
                          {deshabilitada && (
                            <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-gray-100 text-gray-500 border-gray-200">
                              Inactiva en ML
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">zone_id ML: {z.zoneIdMl}</p>
                      </div>

                      <div className="shrink-0">
                        <select
                          value={z.asignacion?.courierId ?? ""}
                          disabled={deshabilitada || guardando === z.zoneIdMl}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isInteger(v) && v > 0) asignar(z.zoneIdMl, v);
                          }}
                          className={`text-sm rounded-lg border px-3 py-1.5 outline-none min-w-[180px] ${
                            deshabilitada
                              ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                              : requiereAccion
                                ? "bg-rose-50 border-rose-200 text-rose-800"
                                : "bg-white border-gray-300 text-gray-800"
                          }`}
                          style={{ borderColor: asignado ? undefined : undefined }}
                        >
                          <option value="" disabled>
                            {deshabilitada ? "—" : "Elegí un courier"}
                          </option>
                          {data.couriersDisponibles.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {mensaje && (
            <p
              className={`text-xs font-medium px-3 py-2 rounded-lg ${
                mensaje.tipo === "ok"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}
            >
              {mensaje.texto}
            </p>
          )}
        </>
      )}
    </div>
  );
}
