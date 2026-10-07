"use client";

// ============================================================================
// Página /reset-password/[token] — DEUDA 96 Pieza 1 (2026-10-08)
// On mount: GET /api/auth/reset-password?token=X → valida + muestra email
// enmascarado o "link inválido". Form: passwordNueva + confirmación (min 8,
// deben coincidir) → POST /api/auth/reset-password → redirect /login al OK.
// ============================================================================

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

interface Props {
  params: Promise<{ token: string }>;
}

export default function ResetPassword({ params }: Props) {
  const { token } = use(params);
  const brandColor = "#233b6b";
  const router = useRouter();

  const [cargando, setCargando] = useState(true);
  const [tokenValido, setTokenValido] = useState<boolean>(false);
  const [emailMasked, setEmailMasked] = useState<string>("");

  const [pass, setPass] = useState("");
  const [passConfirm, setPassConfirm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          setTokenValido(true);
          setEmailMasked(data?.emailMasked ?? "");
        } else {
          setTokenValido(false);
        }
      } catch {
        setTokenValido(false);
      } finally {
        setCargando(false);
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pass.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pass !== passConfirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setGuardando(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, passwordNueva: pass }),
      });
      if (res.ok) {
        setOk(true);
        setTimeout(() => router.push("/login?reset=1"), 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "No se pudo restablecer. Pedí un link nuevo.");
      }
    } catch {
      setError("Error de red. Reintentá en un minuto.");
    } finally {
      setGuardando(false);
    }
  };

  // ---- Estados de carga / inválido / OK ----

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-10 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500 mx-auto" />
          <p className="text-sm text-gray-600 mt-4">Validando link…</p>
        </div>
      </div>
    );
  }

  if (!tokenValido) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-black mb-2" style={{ color: brandColor }}>
            Link inválido o expirado
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            Este link ya no sirve. Pedí uno nuevo desde la página de login.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: brandColor }}
          >
            Pedir un link nuevo
          </Link>
        </div>
      </div>
    );
  }

  if (ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h1 className="text-xl font-black mb-2" style={{ color: brandColor }}>
            Contraseña actualizada
          </h1>
          <p className="text-sm text-gray-600">Te redirigimos al login…</p>
        </div>
      </div>
    );
  }

  // ---- Form ----

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        <div className="flex items-center justify-center w-14 h-14 rounded-full mx-auto mb-6" style={{ backgroundColor: `${brandColor}10` }}>
          <Lock className="w-7 h-7" style={{ color: brandColor }} />
        </div>

        <h1 className="text-2xl font-black text-center mb-2" style={{ color: brandColor }}>
          Elegí una contraseña nueva
        </h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Vas a restablecer la clave de <span className="font-bold text-gray-900">{emailMasked}</span>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pass" className="block text-xs font-bold text-gray-700 mb-1">
              Contraseña nueva (mínimo 8 caracteres)
            </label>
            <input
              id="pass"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label htmlFor="passConfirm" className="block text-xs font-bold text-gray-700 mb-1">
              Repetí la contraseña
            </label>
            <input
              id="passConfirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passConfirm}
              onChange={(e) => setPassConfirm(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={guardando || !pass || !passConfirm}
            className="w-full py-3 rounded-lg text-sm font-bold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            style={{ backgroundColor: brandColor }}
          >
            {guardando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar contraseña nueva"
            )}
          </button>

          <Link href="/login" className="flex items-center justify-center gap-2 text-xs text-gray-600 hover:text-gray-900 mt-4">
            <ArrowLeft className="w-3 h-3" /> Volver al login
          </Link>
        </form>
      </div>
    </div>
  );
}
