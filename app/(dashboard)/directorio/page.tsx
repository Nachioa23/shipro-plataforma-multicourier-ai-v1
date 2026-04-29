"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Users, Search, MapPin, Phone, Mail, Edit, Trash2, Filter, Star, X, Download, Loader2, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';

export default function Directorio() {
  const { data: session } = useSession();
  const brandColor = '#233b6b';

  // ================= ESTADOS DE PAGINACIÓN Y DATOS =================
  const [contactos, setContactos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalContactos, setTotalContactos] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // ================= ESTADOS DE FILTROS =================
  const [busqueda, setBusqueda] = useState("");

  const fetchContactos = async () => {
    if (!session?.user?.empresaId) return;
    setCargando(true);
    try {
      const queryParams = new URLSearchParams({
        empresaId: session.user.empresaId.toString(),
        rol: session.user.rol || "",
        page: page.toString(),
        limit: limit.toString(),
        search: busqueda,
      });

      const res = await fetch(`/api/directorio?${queryParams}`);
      const result = await res.json();
      
      setContactos(result.data || []);
      setTotalContactos(result.meta?.total || 0);
      setTotalPages(result.meta?.totalPages || 1);
    } catch (err) {
      console.error("Error al cargar directorio");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchContactos();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [session, page, limit, busqueda]);

  const handleFiltroChange = (setter: any, value: any) => {
    setter(value);
    setPage(1);
  };

  if (session && session.user.empresaId === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
          <Building2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-gray-800 mb-2">Sección para usuarios cliente</h2>
          <p className="text-sm text-gray-600 mb-6">El directorio es la libreta de direcciones de cada empresa. Como usuario Shipro no tenés una empresa propia.</p>
          <Link href="/torre-de-control" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-lg transition-colors">
            Ir a Torre de Control
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto font-sans pb-20">
      
      {/* ================= CABECERA ================= */}
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Agenda de Contactos</h2>
              <p className="text-sm font-medium text-gray-500 mt-1">
                Visualizá y gestioná la base de datos de tus compradores.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-bold rounded-lg transition-colors shadow-sm">
              <Download className="w-4 h-4" /> Exportar Agenda
            </button>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-[90rem] mx-auto w-full space-y-6">
        
        {/* ================= BARRA DE FILTROS ================= */}
        <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 items-center">
          <div className="relative flex-1 w-full">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Buscar por nombre, email o DNI..." 
              value={busqueda}
              onChange={(e) => handleFiltroChange(setBusqueda, e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]" 
            />
          </div>
          {busqueda && (
            <button 
              onClick={() => { setBusqueda(""); setPage(1); }}
              className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Limpiar Búsqueda
            </button>
          )}
        </div>

        {/* ================= TABLA ================= */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          
          <div className="p-4 bg-slate-50 border-b border-gray-200 flex justify-between items-center">
            <span className="text-sm font-bold text-gray-600">
              Mostrando <span className="text-[#233b6b]">{contactos.length}</span> de <span className="text-[#233b6b]">{totalContactos}</span> contactos.
            </span>
          </div>

          <div className="overflow-x-auto min-h-[400px]">
            {cargando ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p className="font-bold text-sm">Sincronizando Agenda...</p>
              </div>
            ) : contactos.length === 0 ? (
              <div className="text-center py-20">
                <Users className="w-12 h-12 text-gray-300 mb-4 mx-auto" />
                <h3 className="text-lg font-bold text-gray-800">No hay contactos</h3>
                <p className="text-sm text-gray-500 mt-1">Los contactos se crean automáticamente con tus envíos.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-white border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                    <th className="px-6 py-4">Nombre / Empresa</th>
                    <th className="px-6 py-4">DNI / CUIT</th>
                    <th className="px-6 py-4">Email Principal</th>
                    <th className="px-6 py-4">Teléfono</th>
                    <th className="px-6 py-4">Última Dirección Detectada</th>
                    <th className="px-6 py-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100">
                  {contactos.map((contacto: any) => (
                    <tr key={contacto.id} className="transition-colors hover:bg-gray-50 group">
                      <td className="px-6 py-4 font-bold text-gray-800 text-xs">
                        {contacto.nombre || 'Sin nombre'}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-xs">{contacto.documento || '-'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-blue-500" />
                          <span className="font-medium text-gray-700">{contacto.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-gray-600">{contacto.telefono || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-700">{contacto.calle} {contacto.altura}</span>
                            <span className="text-[10px] text-gray-500">{contacto.localidad} (CP {contacto.cp})</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-gray-400 hover:text-[#233b6b] p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><Edit className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ================= PAGINACIÓN ================= */}
          <div className="p-4 bg-white border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-500">Mostrar:</span>
              <select 
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm font-bold text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-500">
                Página <strong className="text-gray-800">{page}</strong> de <strong className="text-gray-800">{totalPages || 1}</strong>
              </span>
              <div className="flex gap-2">
                <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || cargando}
                  className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || totalPages === 0 || cargando}
                  className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}