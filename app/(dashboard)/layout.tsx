"use client";

import { useState } from "react";
import { Sora } from "next/font/google";
import Link from "next/link";
import { Inbox, Tags, Package, LayoutDashboard, Truck, ShieldAlert, Users, CreditCard, ArrowRightLeft, Activity, LogOut, Building2, Calculator, Landmark, Scale, FileSpreadsheet, Settings2 } from 'lucide-react';
import { useSession, signOut, SessionProvider } from "next-auth/react";
import CotizadorModal from '@/components/CotizadorModal';
import "../globals.css";

const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const brandColor = '#233b6b';

  const [isCotizadorOpen, setIsCotizadorOpen] = useState(false);

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center bg-gray-50 font-bold text-[#233b6b] animate-pulse">Abriendo Bóveda de Shipro...</div>;
  }

  const activeRole = session?.user?.rol; 

  if (!activeRole) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-8 text-center font-sans">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Restringido</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          La cuenta de Google que utilizaste no está registrada en el ecosistema de Shipro. Si sos cliente, por favor solicitá tu alta al administrador.
        </p>
        <button 
          onClick={() => signOut({ callbackUrl: '/login' })} 
          className="mt-8 px-8 py-3 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl shadow-md transition-colors text-sm"
        >
          Cerrar Sesión y Volver
        </button>
      </div>
    );
  }

  const userName = session?.user?.name || 'Usuario Desconocido';

  const getRoleName = () => {
    switch(activeRole) {
      case 'operador_cliente': return "Operador (Depósito)";
      case 'gerente_cliente': return "Gerente (Cliente)";
      case 'operador_shipro': return "Soporte N1 (Shipro)";
      case 'admin_shipro': return "Súper Admin (Shipro)";
      default: return "Sin Acceso";
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20">
        <div className="h-16 flex items-center px-6 border-b border-gray-100 shrink-0">
          <Link href="/">
            <h1 className="text-2xl font-extrabold tracking-tight cursor-pointer" style={{ color: brandColor }}>
              SHIPRO<span className="text-blue-600">.</span>
            </h1>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          <p className="px-3 text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Operación Diaria</p>
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
            <Inbox className="w-5 h-5" /><span>Bandeja de Pedidos</span>
          </Link>
          <Link href="/etiquetas" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
            <Tags className="w-5 h-5" /><span>Centro de Etiquetas</span>
          </Link>
          <Link href="/colectas" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
            <Package className="w-5 h-5" /><span>Armado y Colectas</span>
          </Link>

          <button 
            onClick={() => setIsCotizadorOpen(true)}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all text-left"
          >
            <Calculator className="w-5 h-5" /><span>Cotizador Rápido</span>
          </button>
          
          {(activeRole === 'gerente_cliente' || activeRole === 'admin_shipro') && (
            <div className="pt-6 animate-in slide-in-from-left-4 fade-in duration-300">
              <p className="px-3 text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Gestión de Negocio</p>
              <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <LayoutDashboard className="w-5 h-5" /><span>Panel de Control</span>
              </Link>
              <Link href="/directorio" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <Users className="w-5 h-5" /><span>Agenda de Contactos</span>
              </Link>
              <Link href="/facturacion" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <CreditCard className="w-5 h-5" /><span>Facturación y Saldos</span>
              </Link>
              <Link href="/mis-transportes" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <Truck className="w-5 h-5" /><span>Mis Transportes</span>
              </Link>
            </div>
          )}

          {(activeRole === 'admin_shipro' || activeRole === 'operador_shipro') && (
            <div className="pt-6 animate-in slide-in-from-left-4 fade-in duration-300">
              <p className="px-3 text-xs font-bold text-[#233b6b] uppercase tracking-wider mb-3">Herramientas Shipro</p>
              
              <Link href="/clientes" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-blue-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <Building2 className="w-5 h-5 text-indigo-500" /><span>Cuentas E-commerce</span>
              </Link>

              <Link href="/rastreo" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-blue-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <ShieldAlert className="w-5 h-5 text-red-500" /><span>Mesa de Ayuda (Tickets)</span>
              </Link>
              <Link href="/nomenclador" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-blue-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <ArrowRightLeft className="w-5 h-5 text-blue-500" /><span>Nomenclador (TMS)</span>
              </Link>
              <Link href="/couriers" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-blue-50 hover:text-[#233b6b] rounded-lg font-medium text-sm transition-all">
                <Truck className="w-5 h-5 text-purple-500" /><span>Reglas de Ruteo</span>
              </Link>
              
              {/* VISTAS EXCLUSIVAS DEL SUPER ADMIN */}
              {activeRole === 'admin_shipro' && (
                <>
                  {/* NUEVO BOTÓN: ABM COURIERS MAESTRO */}
                  <Link href="/admin-couriers" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-violet-50 hover:text-violet-800 rounded-lg font-medium text-sm transition-all mt-2 bg-violet-50/50 border border-violet-100">
                    <Settings2 className="w-5 h-5 text-violet-600" /><span className="font-bold text-violet-800">Gestión de Couriers</span>
                  </Link>

                  <Link href="/admin-finanzas" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-green-50 hover:text-green-800 rounded-lg font-medium text-sm transition-all mt-2 bg-green-50/50 border border-green-100">
                    <Landmark className="w-5 h-5 text-green-600" /><span className="font-bold text-green-800">Caja General</span>
                  </Link>
                  <Link href="/conciliacion" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-amber-50 hover:text-amber-800 rounded-lg font-medium text-sm transition-all mt-2 bg-amber-50/50 border border-amber-100">
                    <Scale className="w-5 h-5 text-amber-600" /><span className="font-bold text-amber-800">Auditoría de Aforos</span>
                  </Link>
                  <Link href="/liquidaciones" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-cyan-50 hover:text-cyan-800 rounded-lg font-medium text-sm transition-all mt-2 bg-cyan-50/50 border border-cyan-100">
                    <FileSpreadsheet className="w-5 h-5 text-cyan-600" /><span className="font-bold text-cyan-800">Cierre de Mes</span>
                  </Link>
                  <Link href="/torre-de-control" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-slate-200 hover:text-slate-800 rounded-lg font-medium text-sm transition-all mt-2 bg-slate-100 border border-slate-200">
                    <Activity className="w-5 h-5 text-slate-800" /><span className="font-bold text-slate-800">Torre de Control</span>
                  </Link>
                </>
              )}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm
              ${activeRole === 'admin_shipro' ? 'bg-slate-800' : activeRole === 'operador_shipro' ? 'bg-blue-500' : 'bg-[#233b6b]'}`}>
              {activeRole === 'admin_shipro' ? 'A' : activeRole === 'operador_shipro' ? 'S' : 'C'}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800">{userName}</p>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">{getRoleName()}</p>
            </div>
          </div>
          <button 
            onClick={() => signOut({ callbackUrl: '/login' })} 
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" 
            title="Cerrar Sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      <main className={`flex-1 flex flex-col h-screen overflow-hidden relative bg-gray-50 font-sans ${sora.className}`}>
        {children}
      </main>

      {/* RENDERIZADO DEL MODAL */}
      <CotizadorModal 
        isOpen={isCotizadorOpen} 
        onClose={() => setIsCotizadorOpen(false)} 
      />

    </div>
  );
}

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <SessionProvider>
      <DashboardContent>{children}</DashboardContent>
    </SessionProvider>
  );
}