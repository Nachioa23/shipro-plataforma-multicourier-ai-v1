"use client";

// =============================================================================
// DEUDA 180 (MEF Fase 1 step 3) — Página de éxito de la instalación OAuth de
// Mercado Libre. Mirror simplificado del twin Tiendanube
// (app/tiendanube/instalado/page.tsx).
// =============================================================================
// Public page (top-level app/, sin session, sin sidebar — mismo pattern que
// el twin Tiendanube y que app/corregir/[tracking]). La ve el seller apenas el
// callback OAuth termina de vincular la cuenta ML y redirige acá con query
// params.
//
// Query params (todos opcionales; vienen del callback
// app/api/mercadolibre/oauth/callback/route.ts):
//   mlUserId → seller_id de ML (fallback del título si no vino nickname)
//   nickname → nickname del seller (GET /users/me, best-effort)
//
// Fase 1 SIMPLIFICADA vs Tiendanube: no hay carrier ni config pending (esos
// son Fase 3+). Un solo estado "conectada" — la cuenta ML quedó vinculada,
// pero cotización + etiquetas + webhooks vienen después. El copy lo refleja
// honestamente para no prometer más de lo que MEF Fase 1 entrega.
// =============================================================================

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Store, ArrowRight } from "lucide-react";

const BRAND = "#233b6b";

function InstaladoContent() {
  const searchParams = useSearchParams();

  const mlUserId = searchParams?.get("mlUserId") ?? "";
  const nickname = searchParams?.get("nickname") ?? "";

  const nombreSeller = nickname || "Tu cuenta de Mercado Libre";

  const btnPrimario =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition-all hover:opacity-90";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        {/* Wordmark Shipro */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: BRAND }}
          >
            <Store className="w-4 h-4 text-white" />
          </div>
          <span className="font-black tracking-tight text-lg" style={{ color: BRAND }}>
            Shipro
          </span>
        </div>

        {/* Icono de estado — Fase 1: siempre "conectada" (verde). */}
        <div className="w-14 h-14 rounded-full flex items-center justify-center bg-emerald-50 mb-5">
          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
        </div>

        {/* Título + mensaje */}
        <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-3">
          ¡Cuenta de Mercado Libre conectada!
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-5">
          {nombreSeller} quedó vinculada a Shipro. Vamos a avisarte apenas terminemos
          de activar la cotización + etiquetas para Mercado Envíos Flex.
        </p>

        {/* Referencia sutil al mlUserId cuando no hay nickname (identidad del seller) */}
        {!nickname && mlUserId && (
          <p className="text-[11px] font-medium text-gray-400 mb-5">
            Seller #{mlUserId}
          </p>
        )}

        {/* Botón: volver a Shipro (Fase 1 no tiene un admin ML equivalente al
            "Volver a Tiendanube" del twin — el seller ya está autenticado en
            ML por el flow OAuth, pero no tenemos un dominio ML propio del
            seller para linkear como hacemos con el subdominio Tiendanube). */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/" className={btnPrimario} style={{ backgroundColor: BRAND }}>
            Ir a Shipro
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function InstaladoPage() {
  // useSearchParams requiere Suspense en app/ router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <InstaladoContent />
    </Suspense>
  );
}
