// ============================================================================
// PAGINA — Form publico de encuesta NPS Cliente Empresa
// Metrica 1.3 (DEUDA 39, 2026-06-11).
//
// Flow:
// 1. Usuario recibe email con link /encuesta-nps-empresa?token=XYZ&score=N
// 2. Esta pagina valida el token via GET /api/nps-empresa?token=XYZ
// 3. Muestra form con score pre-seleccionado + 4 preguntas adicionales
// 4. Submit POST /api/nps-empresa con todas las respuestas
// 5. Confirmacion final
//
// Sin auth (token cumple ese rol). Ruta whitelistada en proxy.ts.
// ============================================================================

"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type EstadoForm = "loading" | "error" | "yaVoto" | "form" | "submitting" | "success";

interface ContextoEncuesta {
  empresa: { id: number; nombre: string };
  usuario: { id: number; nombre: string; email: string };
  periodo: string;
  fechaEnvio: string;
}

function FormularioEncuesta() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const scoreInicial = searchParams.get("score");

  const [estado, setEstado] = useState<EstadoForm>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [contexto, setContexto] = useState<ContextoEncuesta | null>(null);

  // Form state
  const [score, setScore] = useState<number | null>(
    scoreInicial !== null && !isNaN(parseInt(scoreInicial))
      ? parseInt(scoreInicial)
      : null
  );
  const [satisfaccionPlataforma, setSatisfaccionPlataforma] = useState<number | null>(null);
  const [calidadSoporte, setCalidadSoporte] = useState<number | null>(null);
  const [sinContactoSoporte, setSinContactoSoporte] = useState(false);
  const [fortaleza, setFortaleza] = useState("");
  const [sugerencia, setSugerencia] = useState("");

  // Validar token al montar.
  useEffect(() => {
    if (!token) {
      setEstado("error");
      setErrorMsg("Falta el token en la URL.");
      return;
    }

    fetch(`/api/nps-empresa?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();

        if (res.status === 409 && data.yaVoto) {
          setEstado("yaVoto");
          return;
        }

        if (!res.ok) {
          setEstado("error");
          setErrorMsg(data.error || "Token invalido");
          return;
        }

        setContexto(data);
        setEstado("form");
      })
      .catch((err) => {
        console.error("[Encuesta NPS Empresa] error validando token:", err);
        setEstado("error");
        setErrorMsg("Error al validar el token. Reintenta mas tarde.");
      });
  }, [token]);

  const handleSubmit = async () => {
    if (score === null) {
      alert("Por favor, seleccionado un puntaje del 0 al 10.");
      return;
    }

    setEstado("submitting");

    try {
      const res = await fetch("/api/nps-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          score,
          satisfaccionPlataforma,
          calidadSoporte: sinContactoSoporte ? null : calidadSoporte,
          fortaleza: fortaleza.trim() || null,
          sugerencia: sugerencia.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setEstado("error");
        setErrorMsg(data.error || "Error al enviar la encuesta");
        return;
      }

      setEstado("success");
    } catch (err) {
      console.error("[Encuesta NPS Empresa] error submit:", err);
      setEstado("error");
      setErrorMsg("Error al enviar. Reintenta.");
    }
  };

  // ===== Render por estado =====

  if (estado === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <p className="text-gray-500">Validando link...</p>
      </div>
    );
  }

  if (estado === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-red-200 rounded-xl p-8 max-w-md text-center">
          <h1 className="text-xl font-black text-red-600 mb-3">Link no valido</h1>
          <p className="text-gray-600">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (estado === "yaVoto") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-blue-200 rounded-xl p-8 max-w-md text-center">
          <h1 className="text-xl font-black text-blue-700 mb-3">Ya respondiste esta encuesta</h1>
          <p className="text-gray-600">Gracias por tu opinion. Tu voto ya fue registrado.</p>
        </div>
      </div>
    );
  }

  if (estado === "success") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-green-200 rounded-xl p-8 max-w-md text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-black text-green-700 mb-3">¡Gracias!</h1>
          <p className="text-gray-600">Tu opinion es muy valiosa para nosotros. La usaremos para mejorar Shipro.</p>
        </div>
      </div>
    );
  }

  // estado === "form" o "submitting"

  const submitting = estado === "submitting";

  const getColorScore = (n: number) => {
    if (n <= 6) return "bg-red-100 text-red-700 border-red-300 hover:bg-red-200";
    if (n <= 8) return "bg-yellow-100 text-yellow-700 border-yellow-300 hover:bg-yellow-200";
    return "bg-green-100 text-green-700 border-green-300 hover:bg-green-200";
  };

  const getColorScoreActivo = (n: number) => {
    if (n <= 6) return "bg-red-600 text-white border-red-700";
    if (n <= 8) return "bg-yellow-500 text-white border-yellow-600";
    return "bg-green-600 text-white border-green-700";
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <div className="mb-6 pb-6 border-b border-gray-100">
          <h1 className="text-2xl font-black text-gray-900 mb-1">Encuesta Shipro</h1>
          <p className="text-sm text-gray-500">
            Hola, <span className="font-bold">{contexto?.usuario.nombre}</span> ({contexto?.empresa.nombre})
          </p>
          <p className="text-xs text-gray-400 mt-1">Periodo {contexto?.periodo}</p>
        </div>

        {/* Q1: NPS 0-10 */}
        <div className="mb-8">
          <h2 className="text-base font-bold text-gray-900 mb-3">
            1. ¿Que tan probable es que recomiendes Shipro a otra empresa?
          </h2>
          <div className="flex flex-wrap gap-2 justify-center">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                disabled={submitting}
                className={`w-12 h-12 rounded-lg border-2 font-bold text-lg transition-colors ${
                  score === n ? getColorScoreActivo(n) : getColorScore(n)
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-3 px-1">
            <span>Nada probable</span>
            <span>Muy probable</span>
          </div>
        </div>

        {/* Q2: Satisfaccion plataforma 1-5 */}
        <div className="mb-8">
          <h2 className="text-base font-bold text-gray-900 mb-3">
            2. ¿Como calificarias tu satisfaccion general con la plataforma?
          </h2>
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSatisfaccionPlataforma(n)}
                disabled={submitting}
                className={`w-12 h-12 rounded-lg border-2 font-bold transition-colors ${
                  satisfaccionPlataforma === n
                    ? "bg-indigo-600 text-white border-indigo-700"
                    : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-indigo-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-3 px-1">
            <span>Muy insatisfecho</span>
            <span>Muy satisfecho</span>
          </div>
        </div>

        {/* Q3: Calidad soporte 1-5 */}
        <div className="mb-8">
          <h2 className="text-base font-bold text-gray-900 mb-3">
            3. ¿Como calificarias la calidad del soporte humano de Shipro?
          </h2>
          <div className="flex gap-2 justify-center mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCalidadSoporte(n);
                  setSinContactoSoporte(false);
                }}
                disabled={submitting || sinContactoSoporte}
                className={`w-12 h-12 rounded-lg border-2 font-bold transition-colors ${
                  calidadSoporte === n && !sinContactoSoporte
                    ? "bg-indigo-600 text-white border-indigo-700"
                    : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={sinContactoSoporte}
              onChange={(e) => {
                setSinContactoSoporte(e.target.checked);
                if (e.target.checked) setCalidadSoporte(null);
              }}
              disabled={submitting}
              className="rounded"
            />
            No tuve contacto con soporte este periodo
          </label>
        </div>

        {/* Q4: Fortaleza */}
        <div className="mb-6">
          <label className="block text-base font-bold text-gray-900 mb-2">
            4. ¿Que es lo que mas te gusta de Shipro? <span className="text-xs font-normal text-gray-400">(opcional)</span>
          </label>
          <textarea
            value={fortaleza}
            onChange={(e) => setFortaleza(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Escribi tu respuesta..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
            maxLength={500}
          />
        </div>

        {/* Q5: Sugerencia */}
        <div className="mb-8">
          <label className="block text-base font-bold text-gray-900 mb-2">
            5. ¿Que mejorarias? <span className="text-xs font-normal text-gray-400">(opcional)</span>
          </label>
          <textarea
            value={sugerencia}
            onChange={(e) => setSugerencia(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Escribi tu respuesta..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
            maxLength={500}
          />
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || score === null}
          className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Enviando..." : "Enviar respuesta"}
        </button>

        <p className="text-xs text-gray-400 text-center mt-4">
          Esta encuesta se envia trimestralmente. Tu privacidad esta protegida.
        </p>
      </div>
    </div>
  );
}

export default function EncuestaNPSEmpresaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Cargando...</p></div>}>
      <FormularioEncuesta />
    </Suspense>
  );
}
