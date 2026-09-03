"use client";

import { use, useEffect, useState } from "react";
import { Key, Copy, CheckCircle2, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";

// DEUDA 150 Pieza 2 — Página pública de setup de API Key.
// El cliente llega vía link tokenizado en el mail (`/setup-api-key/<token>`).
// Autenticación = el propio token (single-use, con expiración). Sin sesión.
//
// Flujo:
// 1. Mount → GET /api/empresa/api-key/via-token?token=… valida el token +
//    devuelve empresaNombre + si ya hay key. Si el token es inválido/expirado/
//    consumido → 404 con mensaje "link inválido o expirado".
// 2. Cliente ve la empresa, el warning de show-once, opcionalmente un warning
//    extra si ya existía una key (rotarla la invalida), y confirma con un botón.
// 3. Click → POST /api/empresa/api-key/via-token con el token → devuelve la
//    API Key PLAINTEXT una única vez + marca el token como consumido.
// 4. La UI muestra la key con copy-to-clipboard, un warning explícito de que no
//    se vuelve a mostrar, y las instrucciones de dónde pegarla.

interface Metadata {
  empresaNombre: string;
  keyYaExiste: boolean;
  keyUltimos4: string | null;
  keyActiva: boolean;
}

export default function SetupApiKeyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [cargando, setCargando] = useState(true);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  const [generando, setGenerando] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [errorGeneracion, setErrorGeneracion] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/empresa/api-key/via-token?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          setErrorValidacion("Link inválido o expirado. Pedile a Shipro un nuevo link.");
          return;
        }
        const data = await res.json();
        setMetadata({
          empresaNombre: data.empresaNombre,
          keyYaExiste: !!data.keyYaExiste,
          keyUltimos4: data.keyUltimos4 ?? null,
          keyActiva: !!data.keyActiva,
        });
      } catch {
        setErrorValidacion("No pudimos validar el link. Reintentá en un rato o pedile uno nuevo a Shipro.");
      } finally {
        setCargando(false);
      }
    })();
  }, [token]);

  const generar = async () => {
    if (generando) return;
    setGenerando(true);
    setErrorGeneracion(null);
    try {
      const res = await fetch(`/api/empresa/api-key/via-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          setErrorGeneracion("El link ya no es válido. Puede haber expirado o haberse usado antes.");
        } else {
          setErrorGeneracion("No pudimos generar la key. Reintentá en un rato.");
        }
        return;
      }
      const data = await res.json();
      if (!data?.apiKey) {
        setErrorGeneracion("Respuesta inesperada del servidor.");
        return;
      }
      setApiKey(data.apiKey);
    } catch {
      setErrorGeneracion("Error de red. Reintentá.");
    } finally {
      setGenerando(false);
    }
  };

  const copiar = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Fallback: seleccionar el texto — rare browser sin permisos de clipboard.
    }
  };

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 font-sans">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Validando link…</span>
        </div>
      </div>
    );
  }

  if (errorValidacion || !metadata) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 font-sans">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-red-50 rounded-full flex items-center justify-center mb-4 border border-red-100">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-black text-gray-800 mb-2">Link no válido</h1>
          <p className="text-sm text-gray-500 leading-relaxed">{errorValidacion || "Link inválido o expirado."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg w-full p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-800 tracking-tight">Generar API Key</h1>
            <p className="text-sm text-gray-500">{metadata.empresaNombre}</p>
          </div>
        </div>

        {!apiKey && (
          <>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              Esta es la llave única de tu empresa para conectar Shipro con las plataformas de e-commerce que uses (WooCommerce, entre otras).
            </p>

            {metadata.keyYaExiste && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[13px] text-amber-800 leading-relaxed">
                  <strong>Ya tenés una API Key activa</strong>
                  {metadata.keyUltimos4 ? ` (termina en ${metadata.keyUltimos4})` : ""}. Si generás una nueva, la anterior <strong>deja de funcionar</strong> y todas las integraciones que la usen se rompen hasta que peguen la nueva.
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-[13px] text-blue-800 leading-relaxed">
                La key se va a mostrar en pantalla <strong>una sola vez</strong>. Copiala apenas aparezca y guardala en un lugar seguro. Si la perdés, tendrás que pedir un nuevo link para emitir otra.
              </div>
            </div>

            {errorGeneracion && (
              <p className="text-sm font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
                {errorGeneracion}
              </p>
            )}

            <button
              onClick={generar}
              disabled={generando}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              {generando ? "Generando…" : metadata.keyYaExiste ? "Generar nueva key (invalida la actual)" : "Generar mi API Key"}
            </button>
          </>
        )}

        {apiKey && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-[13px] text-emerald-800 leading-relaxed">
                <strong>Listo.</strong> Copiá esto ahora — no vamos a volver a mostrarla.
              </div>
            </div>

            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Tu API Key</label>
            <div className="flex items-stretch gap-2 mb-4">
              <code className="flex-1 px-3 py-3 text-[13px] font-mono text-gray-800 bg-gray-50 border border-gray-200 rounded-lg break-all select-all">
                {apiKey}
              </code>
              <button
                onClick={copiar}
                className="px-4 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-2"
                title="Copiar al portapapeles"
              >
                {copiado ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-[13px] text-amber-800 leading-relaxed mb-2 font-bold">Guardala ahora.</p>
              <p className="text-[13px] text-amber-800 leading-relaxed">
                Esta pantalla no la vuelve a mostrar. Si la perdés, tenés que pedirle a Shipro un nuevo link (el actual ya fue consumido) para emitir una nueva key.
              </p>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">¿Dónde la pego?</p>
              <ul className="text-[13px] text-gray-700 leading-relaxed list-disc pl-5 space-y-1">
                <li><strong>WooCommerce</strong>: en el admin de tu tienda → <em>WooCommerce → Ajustes → Shipro → API Key</em>.</li>
                <li>Cualquier otro plugin/API Shipro consume esta misma key (una sola por empresa).</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
