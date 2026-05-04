"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Truck, Warehouse, Network, Eye } from "lucide-react";
import { ConfiguracionProvider, useConfiguracion } from "./ConfiguracionContext";

interface TabDef {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

function ConfiguracionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { empresaActivaId, setEmpresaActivaId, empresasLista, esEquipoShipro, esOperadorCliente } = useConfiguracion();

  const tabs: TabDef[] = [
    { id: 'transportes', label: 'Transportes', href: '/configuracion/transportes', icon: Truck, visible: !esOperadorCliente },
    { id: 'depositos', label: 'Depósitos', href: '/configuracion/depositos', icon: Warehouse, visible: true },
    { id: 'ruteo', label: 'Ruteo', href: '/configuracion/ruteo', icon: Network, visible: !esOperadorCliente },
  ].filter(t => t.visible);

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto relative">

      {/* BARRA MODO DIOS */}
      {esEquipoShipro && (
        <div className="bg-red-600 text-white px-8 py-2 flex items-center justify-between text-sm shadow-inner z-30">
          <div className="flex items-center gap-2 font-black tracking-wider uppercase">
            <Eye className="w-4 h-4" /> MODO AUDITORÍA (SÚPER ADMIN)
          </div>
          <div className="flex items-center gap-3">
            <span className="font-medium">Viendo cuenta de:</span>
            <select
              value={empresaActivaId ?? ""}
              onChange={e => setEmpresaActivaId(Number(e.target.value))}
              className="bg-red-900 border-none text-white text-sm font-bold rounded-lg px-3 py-1 outline-none"
            >
              {empresaActivaId === null && <option value="" disabled>Seleccioná una empresa...</option>}
              {empresasLista.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* CABECERA */}
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Configuración</h2>
            <p className="text-sm font-medium text-gray-500 mt-1">Transportes, depósitos y reglas de ruteo de tu cuenta.</p>
          </div>
        </div>
      </header>

      {/* TABS */}
      <div className="flex border-b border-gray-200 bg-white px-8 sticky top-[100px] z-10">
        {tabs.map(tab => {
          const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`py-4 px-6 text-sm font-black uppercase tracking-wider flex items-center gap-2 transition-colors border-b-2 ${
                isActive
                  ? 'border-[#233b6b] text-[#233b6b]'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

export default function ConfiguracionLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfiguracionProvider>
      <ConfiguracionShell>{children}</ConfiguracionShell>
    </ConfiguracionProvider>
  );
}
