"use client";

// =============================================================================
// DEUDA 144 — Página de éxito de la instalación de Shipro en Tiendanube.
// =============================================================================
// Public page (top-level app/, sin session, sin sidebar — mismo pattern que
// app/corregir/[tracking]). La ve el comprador/merchant apenas el callback OAuth
// termina de vincular la tienda y redirige acá con query params. Los 3 estados
// (listo / config / casi) se derivan de esos params, así que se puede testear
// abriendo la URL a mano sin ejercitar el OAuth entero.
//
// Query params (todos opcionales; todos vienen del callback):
//   store    → storeId (fallback del título si no vino nombre)
//   nombre   → nombre real de la tienda (GET /store, ver 6dc0a36)
//   dominio  → original_domain (para el botón "Volver a Tiendanube")
//   carrier  → "ok" | "fail" (default "ok"). "fail" = carrier register fallo.
//   config   → "ok" | "pending" (default "ok"). "pending" = empresa sin
//              onboarding completado, no puede operar todavía.
// =============================================================================

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Settings,
  Clock,
  Store,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

const BRAND = "#233b6b";

type Estado = "listo" | "config" | "casi";

function InstaladoContent() {
  const searchParams = useSearchParams();

  const store = searchParams?.get("store") ?? "";
  const nombre = searchParams?.get("nombre") ?? "";
  const dominio = searchParams?.get("dominio") ?? "";
  const carrier = searchParams?.get("carrier") ?? "ok";
  const config = searchParams?.get("config") ?? "ok";

  const estado: Estado =
    carrier === "fail" ? "casi" : config === "pending" ? "config" : "listo";

  const nombreTienda = nombre || "Tu tienda";

  const iconoConfig = {
    listo: { Icon: CheckCircle2, bg: "bg-emerald-50", fg: "text-emerald-600" },
    config: { Icon: Settings, bg: "bg-amber-50", fg: "text-amber-600" },
    casi: { Icon: Clock, bg: "bg-sky-50", fg: "text-sky-600" },
  }[estado];
  const { Icon: EstadoIcon, bg: iconBg, fg: iconFg } = iconoConfig;

  const titulo =
    estado === "listo"
      ? "¡Listo! Shipro ya está en tu tienda"
      : estado === "config"
      ? "Tu tienda quedó conectada"
      : "Casi listo";

  const mensaje =
    estado === "listo"
      ? `${nombreTienda} quedó conectada y Shipro ya puede cotizar tus envíos en el checkout.`
      : estado === "config"
      ? `${nombreTienda} ya está vinculada a Shipro. Para que empiece a cotizar envíos, emitir etiquetas y actualizar estados, todavía tenés que completar tu configuración en Shipro.`
      : `${nombreTienda} quedó conectada. Estamos terminando de activar Shipro en tu checkout — te avisamos apenas esté todo listo.`;

  // TODO(DEUDA 144): confirmar URL exacta del admin de Tiendanube en la instalación real
  // (dominio = original_domain, ej. "mitienda.mitiendanube.com" → "/admin" debería llevar
  // al panel del merchant si tiene sesión activa allá).
  const hrefTiendanube = dominio ? `https://${dominio}/admin` : null;

  const shiproPrimario = estado === "config";
  const labelShipro =
    estado === "config" ? "Completar configuración en Shipro" : "Ir a Shipro";

  const btnPrimario =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition-all hover:opacity-90";
  const btnSecundario =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all";

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

        {/* Icono de estado */}
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${iconBg} mb-5`}>
          <EstadoIcon className={`w-7 h-7 ${iconFg}`} />
        </div>

        {/* Título + mensaje */}
        <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-3">{titulo}</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-5">{mensaje}</p>

        {/* Nota extra para el estado "config" */}
        {estado === "config" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs font-medium leading-relaxed mb-6">
            Hasta que completes la configuración, no van a aparecer opciones de envío de
            Shipro en tu checkout.
          </div>
        )}

        {/* Referencia sutil al storeId cuando no hay nombre (identidad de la tienda) */}
        {!nombre && store && (
          <p className="text-[11px] font-medium text-gray-400 mb-5">Store #{store}</p>
        )}

        {/* Botones */}
        <div className="flex flex-col sm:flex-row gap-3">
          {hrefTiendanube && (
            <a
              href={hrefTiendanube}
              target="_blank"
              rel="noopener noreferrer"
              className={shiproPrimario ? btnSecundario : btnPrimario}
              style={shiproPrimario ? undefined : { backgroundColor: BRAND }}
            >
              <ExternalLink className="w-4 h-4" />
              Volver a Tiendanube
            </a>
          )}
          <Link
            href="/"
            className={shiproPrimario ? btnPrimario : btnSecundario}
            style={shiproPrimario ? { backgroundColor: BRAND } : undefined}
          >
            {labelShipro}
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
