"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Plug, Store, ShieldAlert, Loader2, Building2, Clock } from "lucide-react";

// DEUDA 144 — pantalla Integraciones (contenedora de plataformas e-commerce). Hoy:
// sección Tiendanube con las tiendas vinculadas (solo lectura; la reasignación se
// agrega en la pieza 3b). admin_shipro. La estructura de sección permite sumar
// plataformas sin tocar el menú.

interface TiendaVinculada {
  id: number;
  storeId: number;
  empresaId: number;
  estado: string;
  shippingCarrierId: string | null;
  instaladaEn: string;
  desinstaladaEn: string | null;
  updatedAt: string;
  empresa: { id: number; nombre: string; cuit: string; activo: boolean } | null;
}

export default function IntegracionesPage() {
  const { data: session, status } = useSession();
  const rol = session?.user?.rol;

  const [tiendas, setTiendas] = useState<TiendaVinculada[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (rol !== "admin_shipro") return;
    let abortado = false;
    (async () => {
      setCargando(true);
      try {
        const res = await fetch("/api/admin/tiendas-tiendanube");
        if (res.ok) {
          const data: TiendaVinculada[] = await res.json();
          if (!abortado) setTiendas(Array.isArray(data) ? data : []);
        } else {
          let errorMsg = `HTTP ${res.status}`;
          try {
            const errBody = await res.json();
            errorMsg = errBody?.error || errorMsg;
          } catch {
            // body vacio o no-JSON.
          }
          console.error("Error cargando tiendas Tiendanube:", errorMsg);
        }
      } catch (err) {
        console.error("Error de red cargando tiendas Tiendanube:", err);
      } finally {
        if (!abortado) setCargando(false);
      }
    })();
    return () => {
      abortado = true;
    };
  }, [rol]);

  // Loading session
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 font-bold text-[#233b6b] animate-pulse">
        Cargando...
      </div>
    );
  }

  // Defense-in-depth UI: solo admin_shipro.
  if (rol !== "admin_shipro") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-8 text-center font-sans">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Restringido</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          Solo los administradores Shipro pueden gestionar las integraciones de plataformas e-commerce.
        </p>
      </div>
    );
  }

  const chipClasses = (estado: string) => {
    if (estado === "instalada") return "bg-emerald-50 text-emerald-700 border-emerald-100";
    if (estado === "suspendida") return "bg-amber-50 text-amber-700 border-amber-100";
    return "bg-gray-100 text-gray-600 border-gray-200"; // desinstalada u otro
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-100">
              <Plug className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Integraciones</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Tiendas conectadas por plataforma.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <section>
          <div className="flex items-center gap-3 mb-4">
            <Store className="w-5 h-5 text-sky-600" />
            <h3 className="text-lg font-black text-gray-800 tracking-tight">Tiendanube</h3>
            <span className="text-xs font-bold text-sky-800 bg-sky-50 border border-sky-100 rounded-full px-2.5 py-0.5">
              {tiendas.length} {tiendas.length === 1 ? "tienda" : "tiendas"}
            </span>
          </div>

          {cargando ? (
            <div className="flex justify-center py-16 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : tiendas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 border border-gray-200">
                <Store className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-500">No hay tiendas vinculadas todavía.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tiendas.map((t) => (
                <div key={t.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-base font-black text-gray-800 tracking-tight">Store #{t.storeId}</h4>
                    <span className={`text-[10px] font-black uppercase tracking-wider rounded-full px-2 py-1 border ${chipClasses(t.estado)}`}>
                      {t.estado}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Building2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    {t.empresa ? (
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{t.empresa.nombre}</p>
                        <p className="text-[11px] font-medium text-gray-500">CUIT: {t.empresa.cuit}</p>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-gray-500 italic">Empresa desconocida</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-gray-500 border-t border-gray-100 pt-3">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <span>Vinculada: {new Date(t.instaladaEn).toLocaleDateString("es-AR")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
