"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  ScrollText,
  ShieldAlert,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";

// Lista canonica de campos auditables (debe coincidir con lib/auditoria-configuracion.ts).
const CAMPOS_DISPLAY: Record<string, string> = {
  credencialesJson: "Credenciales courier",
  tipoCuenta: "Tipo cuenta (per courier)",
  usaCredencialesPropias: "Modelo A/B",
  activo: "Activo",
  modalidadPago: "Modalidad pago",
  limiteDescubierto: "Limite descubierto",
  apiKey: "API Key",
  modeloAHabilitado: "Modelo A habilitado",
  apiKeyActiva: "API Key activa",
  ajusteTarifaPorcentaje: "Markup %",
  markupFijo: "Markup fijo",
  requiereSeguro: "Requiere seguro",
};

interface AuditoriaItem {
  id: number;
  fecha: string;
  usuarioEmail: string | null;
  rolUsuario: string | null;
  ipOrigen: string | null;
  empresaId: number;
  empresa: { id: number; nombre: string } | null;
  courierId: number | null;
  courier: { id: number; nombre: string } | null;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  motivo: string | null;
}

interface ApiResponse {
  items: AuditoriaItem[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
}

export default function AuditoriaConfiguracionPage() {
  const { data: session, status } = useSession();
  const rol = session?.user?.rol;

  // Filtros
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [desde, setDesde] = useState(hace30Dias);
  const [hasta, setHasta] = useState(hoy);
  const [empresaIdFiltro, setEmpresaIdFiltro] = useState("");
  const [campoFiltro, setCampoFiltro] = useState("");

  // Data
  const [items, setItems] = useState<AuditoriaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: number; nombre: string }[]>([]);

  // Cargar lista de empresas para el dropdown.
  useEffect(() => {
    fetch("/api/clientes")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEmpresas(data.map((e: any) => ({ id: e.id, nombre: e.nombre })));
        }
      })
      .catch(console.error);
  }, []);

  const cargarAuditoria = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      params.set("desde", desde);
      params.set("hasta", hasta);
      params.set("page", String(page));
      if (empresaIdFiltro) params.set("empresaId", empresaIdFiltro);
      if (campoFiltro) params.set("campo", campoFiltro);

      const res = await fetch(`/api/admin/auditoria-configuracion?${params}`);
      if (res.ok) {
        const data: ApiResponse = await res.json();
        setItems(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } else {
        // Intentar parsear error JSON, sino fallback a status text.
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          errorMsg = errBody?.error || errorMsg;
        } catch {
          // body vacio o no-JSON.
        }
        console.error("Error cargando auditoria:", errorMsg);
      }
    } catch (err) {
      console.error("Error de red cargando auditoria:", err);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, page, empresaIdFiltro, campoFiltro]);

  useEffect(() => {
    if (rol === "admin_shipro") cargarAuditoria();
  }, [cargarAuditoria, rol]);

  // Reset page cuando cambian filtros.
  useEffect(() => {
    setPage(1);
  }, [desde, hasta, empresaIdFiltro, campoFiltro]);

  const exportarCSV = () => {
    const params = new URLSearchParams();
    params.set("desde", desde);
    params.set("hasta", hasta);
    params.set("formato", "csv");
    if (empresaIdFiltro) params.set("empresaId", empresaIdFiltro);
    if (campoFiltro) params.set("campo", campoFiltro);
    window.location.href = `/api/admin/auditoria-configuracion?${params}`;
  };

  const formatFecha = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  };

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
          Solo los administradores Shipro pueden consultar el audit log de configuracion.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-50 text-[#233b6b] border border-blue-100">
              <ScrollText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Auditoria de Configuracion</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Trazabilidad de cambios sensibles en credenciales y configuracion financiera (DEUDA 19).
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* FILTROS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Filtros</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Empresa</label>
              <select
                value={empresaIdFiltro}
                onChange={(e) => setEmpresaIdFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b] bg-white"
              >
                <option value="">Todas</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Campo</label>
              <select
                value={campoFiltro}
                onChange={(e) => setCampoFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b] bg-white"
              >
                <option value="">Todos</option>
                {Object.entries(CAMPOS_DISPLAY).map(([key, display]) => (
                  <option key={key} value={key}>{display}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={exportarCSV}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#233b6b] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
            </div>
          </div>
        </div>

        {/* TABLA */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800">
              Registros {total > 0 && <span className="text-sm font-medium text-gray-500">({total} total{total === 1 ? "" : "es"})</span>}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                <tr>
                  <th className="px-6 py-4">Fecha</th>
                  <th className="px-6 py-4">Usuario / Rol</th>
                  <th className="px-6 py-4">Empresa / Courier</th>
                  <th className="px-6 py-4">Campo</th>
                  <th className="px-6 py-4">Cambio</th>
                  <th className="px-6 py-4">Motivo</th>
                  <th className="px-6 py-4">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {cargando ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Cargando registros...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-500">
                      No hay registros de auditoria en el rango seleccionado.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-xs text-gray-700">{formatFecha(item.fecha)}</td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-800">{item.usuarioEmail || <span className="italic text-gray-400">(via API)</span>}</p>
                        <p className="text-xs text-gray-500">{item.rolUsuario || "—"}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-800">{item.empresa?.nombre || `Empresa ${item.empresaId}`}</p>
                        {item.courier && <p className="text-xs text-gray-500">{item.courier.nombre}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold px-2 py-1 rounded-md bg-blue-50 text-[#233b6b] border border-blue-100">
                          {CAMPOS_DISPLAY[item.campo] || item.campo}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <span className="text-red-600 font-mono">{item.valorAnterior || "—"}</span>
                        <span className="text-gray-400 mx-2">→</span>
                        <span className="text-green-600 font-mono">{item.valorNuevo || "—"}</span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-600 max-w-xs truncate" title={item.motivo || ""}>
                        {item.motivo || <span className="italic text-gray-400">(sin motivo)</span>}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-500">{item.ipOrigen || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINACION */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Pagina <span className="font-bold">{page}</span> de <span className="font-bold">{totalPages}</span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
