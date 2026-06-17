"use client";

import { useState, useEffect } from "react";
import { ShieldAlert, X, Loader2, AlertTriangle } from "lucide-react";

export interface CambioPreview {
  campo: string;
  de: string | null | undefined;
  a: string | null | undefined;
}

interface ModalMotivoAuditoriaProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
  title: string;
  description: string;
  changesPreview?: CambioPreview[];
  minMotivoLength?: number;
}

/**
 * Modal reusable para confirmar cambios sensibles con motivo obligatorio + doble confirmacion.
 * Usado por flows DEUDA 19:
 *   - TransportesTab (configuracion couriers).
 *   - API Key rotation page.
 *   - Toggle activo de empresas (futuro).
 *
 * Doble confirmacion:
 *   1. Textarea de motivo (min N chars, default 10).
 *   2. Checkbox "Entiendo las implicancias".
 *
 * Boton "Confirmar" solo se habilita si ambos requisitos se cumplen.
 */
export default function ModalMotivoAuditoria({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  changesPreview = [],
  minMotivoLength = 10,
}: ModalMotivoAuditoriaProps) {
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state cuando se abre/cierra.
  useEffect(() => {
    if (isOpen) {
      setMotivo("");
      setConfirmado(false);
      setError(null);
      setProcesando(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const motivoValido = motivo.trim().length >= minMotivoLength;
  const puedeConfirmar = motivoValido && confirmado && !procesando;

  const handleConfirmar = async () => {
    if (!puedeConfirmar) return;
    setProcesando(true);
    setError(null);
    try {
      await onConfirm(motivo.trim());
      // Si onConfirm resuelve OK, el padre debe cerrar el modal.
    } catch (e: any) {
      setError(e?.message || "Error al confirmar el cambio.");
      setProcesando(false);
    }
  };

  const formatValor = (v: string | null | undefined) => {
    if (v === null || v === undefined || v === "") return "—";
    return String(v);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-800 tracking-tight">{title}</h2>
              <p className="text-xs font-medium text-gray-500 mt-1">{description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={procesando}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Cambios preview */}
          {changesPreview.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Cambios sensibles detectados ({changesPreview.length})
                </h3>
              </div>
              <ul className="space-y-2">
                {changesPreview.map((cambio, idx) => (
                  <li key={idx} className="text-xs flex items-start gap-2">
                    <span className="font-bold text-gray-700 min-w-[140px]">{cambio.campo}:</span>
                    <span className="font-mono text-red-600">{formatValor(cambio.de)}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-mono text-green-600">{formatValor(cambio.a)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Textarea motivo */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Motivo del cambio *
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={procesando}
              placeholder={`Explica el motivo (minimo ${minMotivoLength} caracteres)...`}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#233b6b] disabled:bg-gray-100 disabled:cursor-not-allowed resize-none"
            />
            <p className={`text-xs mt-1 ${motivoValido ? "text-green-600" : "text-gray-400"}`}>
              {motivo.trim().length} / {minMotivoLength} caracteres minimos
            </p>
          </div>

          {/* Checkbox confirmacion */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              disabled={procesando}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#233b6b] focus:ring-[#233b6b] disabled:cursor-not-allowed"
            />
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 select-none">
              Entiendo las implicancias de este cambio y autorizo el registro en el audit log.
            </span>
          </label>

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-medium text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={procesando}
            className="px-5 py-2 text-sm font-bold text-gray-700 border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={!puedeConfirmar}
            className="inline-flex items-center gap-2 px-5 py-2 bg-[#233b6b] text-white font-bold text-sm rounded-lg hover:bg-blue-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {procesando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Procesando...
              </>
            ) : (
              <>Confirmar cambio</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
