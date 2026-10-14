"use client";

// =============================================================================
// Shopify Fase 1 — Página de éxito post-instalación OAuth.
// =============================================================================
// Public page (top-level app/, sin session, sin sidebar — mismo pattern que
// app/tiendanube/instalado + app/corregir/[tracking]). La ve el merchant apenas
// el callback OAuth termina de vincular la tienda y redirige acá con ?shop=.
// Headless mínima — sin Polaris (Fase 2+ si se decide seguir el design system
// de Shopify embedded; Fase 1 es solo custom app).
//
// Query params:
//   shop → shopDomain (ej. "mi-tienda.myshopify.com"), para confirmar la vinculación.
// =============================================================================

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowRight, ExternalLink } from "lucide-react";

const BRAND = "#233b6b";

function InstaladoContent() {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") ?? "";
  const shopVisible = shop || "tu tienda";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-xl w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-black text-gray-900">¡Listo! Shopify vinculada a Shipro</h1>
        <p className="text-sm text-gray-600">
          <span className="font-semibold break-all">{shopVisible}</span>{" "}
          quedó conectada. Ya podés configurar envíos, cotizar al checkout y emitir etiquetas desde el panel de Shipro.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: BRAND }}
          >
            Ir al panel de Shipro <ArrowRight className="w-4 h-4" />
          </Link>
          {shop && (
            <a
              href={`https://${shop}/admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100"
            >
              Volver a Shopify <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InstaladoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">Cargando…</div>}>
      <InstaladoContent />
    </Suspense>
  );
}
