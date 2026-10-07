"use client";

// ============================================================================
// Página /forgot-password — DEUDA 96 Pieza 1 (2026-10-08)
// Formulario email → POST /api/auth/forgot-password → mensaje genérico siempre
// (anti-enumeration: nunca revela si el email existe en Shipro).
// ============================================================================

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const brandColor = "#233b6b";

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignoramos errores de red — igual mostramos mensaje genérico para no
      // dar pista sobre el estado del backend.
    }

    setLoading(false);
    setEnviado(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        <div className="flex items-center justify-center w-14 h-14 rounded-full mx-auto mb-6" style={{ backgroundColor: `${brandColor}10` }}>
          <Mail className="w-7 h-7" style={{ color: brandColor }} />
        </div>

        <h1 className="text-2xl font-black text-center mb-2" style={{ color: brandColor }}>
          Recuperar contraseña
        </h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Ingresá tu email y te enviamos un link para elegir una contraseña nueva.
        </p>

        {enviado ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
            <p className="text-sm text-emerald-900 font-medium">
              Si el email está registrado, te enviamos un link para restablecer tu contraseña.
            </p>
            <p className="text-xs text-emerald-800 mt-2">
              Revisá tu bandeja de entrada (y la carpeta de spam). El link vence en 2 horas.
            </p>
            <Link href="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-bold" style={{ color: brandColor }}>
              <ArrowLeft className="w-4 h-4" /> Volver al login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-bold text-gray-700 mb-1">
                Email de tu cuenta
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 rounded-lg text-sm font-bold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: brandColor }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                "Enviar link de recuperación"
              )}
            </button>

            <Link href="/login" className="flex items-center justify-center gap-2 text-xs text-gray-600 hover:text-gray-900 mt-4">
              <ArrowLeft className="w-3 h-3" /> Volver al login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
