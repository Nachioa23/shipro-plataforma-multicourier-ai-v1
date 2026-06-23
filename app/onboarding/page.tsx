// ============================================================================
// /onboarding — placeholder pre-wizard (DEUDA 17.D.4, 2026-06-22)
//
// Ruta destino del gate de layout.tsx cuando onboardingCompletado=false.
// Por ahora es un placeholder; el wizard real (4 pasos) se construye en
// sub-pasos 17.E (UI) + 17.F (endpoints API).
//
// IMPORTANTE: esta ruta NO esta dentro de (dashboard) group → no aplica
// el gate del layout (evita loop infinito).
// ============================================================================

"use client";

import { useSession, signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function OnboardingPlaceholder() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#233b6b]" />
      </div>
    );
  }

  const userName = session?.user?.name || "Cliente";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
        <div className="w-16 h-16 bg-[#233b6b]/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">🚀</span>
        </div>

        <h1 className="text-2xl font-black text-[#233b6b] mb-2">Bienvenido a Shipro, {userName}</h1>
        <p className="text-gray-500 text-sm mb-6">
          Tu cuenta está activa pero el onboarding todavía no se completó.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">En construcción</p>
          <p className="text-sm text-amber-800">
            El wizard de onboarding (cambio de clave, datos administrativos, primer depósito, courier) se completa en los próximos pasos del desarrollo (DEUDA 17.E + 17.F).
          </p>
          <p className="text-xs text-amber-700 mt-3">
            Por ahora, este placeholder confirma que el gate del layout funciona correctamente.
          </p>
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
