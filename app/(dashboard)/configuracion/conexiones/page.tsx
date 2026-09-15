"use client";

// ============================================================================
// MEF Fase 1 — Panel client-side de conexiones a plataformas.
//
// Primera pieza self-service del hub de conexiones: el cliente logeado
// (gerente_cliente / operador_cliente) conecta SU PROPIA cuenta de Mercado
// Libre desde acá. El botón "Conectar Mercado Libre" dispara el flow OAuth
// con `empresaId` derivado del JWT de sesión (el endpoint
// /api/empresa/mercadolibre/connect NUNCA lee empresaId del body).
//
// Estado read via GET /api/empresa/mercadolibre/conexion → si conectada,
// muestra card con el nickname del seller ML; si no, muestra el botón.
//
// Piezas futuras: connect de otras plataformas (Tiendanube self-service,
// WooCommerce, etc). Hoy solo ML.
// ============================================================================

import { useEffect, useState } from "react";
import {
  Plug,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShoppingBag,
} from "lucide-react";

const BRAND = "#233b6b";

type ConexionMlState =
  | { conectada: true; mlUserId: number; nickname: string | null; estado: string; tokenExpiraEn: string; vinculadaEn: string }
  | { conectada: false; estado?: string };

export default function ConfiguracionConexionesPage() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conexion, setConexion] = useState<ConexionMlState | null>(null);
  const [conectando, setConectando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: "ok" | "error" } | null>(null);

  const cargarConexion = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/empresa/mercadolibre/conexion");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Error HTTP ${res.status}`);
        setCargando(false);
        return;
      }
      const data: ConexionMlState = await res.json();
      setConexion(data);
    } catch {
      setError("Error de conexión");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarConexion();
  }, []);

  const conectarML = async () => {
    if (conectando) return;
    setConectando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/empresa/mercadolibre/connect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({ texto: data?.error || `Error HTTP ${res.status}`, tipo: "error" });
        setConectando(false);
        return;
      }
      if (typeof data?.url !== "string") {
        setMensaje({ texto: "Respuesta inválida del servidor (falta la URL de autorización).", tipo: "error" });
        setConectando(false);
        return;
      }
      // Redirigir el browser al authorize de ML.
      window.location.href = data.url;
    } catch {
      setMensaje({ texto: "Error de red al iniciar la conexión.", tipo: "error" });
      setConectando(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h3 className="text-lg font-black text-gray-800 tracking-tight flex items-center gap-2">
          <Plug className="w-5 h-5 text-indigo-500" /> Conexiones a plataformas
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Conectá tu cuenta de Mercado Libre para que Shipro pueda cotizar y despachar tus ventas por Mercado Envíos Flex.
        </p>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-white rounded-lg border border-gray-200 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando estado de la conexión...
        </div>
      )}

      {error && !cargando && (
        <div className="flex items-start gap-2 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">No se pudo cargar el estado.</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {!cargando && !error && conexion && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-yellow-50 border border-yellow-100 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-6 h-6 text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-base font-black text-gray-800">Mercado Libre</h4>
                {conexion.conectada ? (
                  <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Conectada
                  </span>
                ) : conexion.estado ? (
                  <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                    {conexion.estado}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-200">
                    No conectada
                  </span>
                )}
              </div>

              {conexion.conectada ? (
                <>
                  <p className="text-sm text-gray-700 mb-3">
                    <span className="font-bold">Seller:</span> {conexion.nickname ? `@${conexion.nickname}` : `#${conexion.mlUserId}`}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50/50 rounded px-2 py-1.5 border border-emerald-100">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Tu cuenta ML está vinculada. Shipro puede cotizar y despachar tus ventas.
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Al conectar, vas a autorizar a Shipro para leer tus envíos y crear etiquetas en tu cuenta de Mercado Libre.
                    Podés desconectar en cualquier momento desde tu panel de aplicaciones de ML.
                  </p>
                  <button
                    type="button"
                    onClick={conectarML}
                    disabled={conectando}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                    style={{ backgroundColor: BRAND }}
                  >
                    {conectando ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4" />
                    )}
                    {conectando ? "Preparando..." : "Conectar Mercado Libre"}
                  </button>
                </>
              )}

              {mensaje && (
                <p
                  className={`mt-3 text-xs font-medium px-3 py-2 rounded-lg ${
                    mensaje.tipo === "ok"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : "bg-rose-50 text-rose-700 border border-rose-200"
                  }`}
                >
                  {mensaje.texto}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
