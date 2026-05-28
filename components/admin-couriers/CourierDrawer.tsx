"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";

// =============================================================================
// DEUDA 32+37 (Fase H): Drawer de edicion de un courier (espacio Shipro).
// =============================================================================
// Editor lateral con 4 secciones:
//   1. Info General — contacto + logo
//   2. Consolidador (Fase H.3) — toggle + AutocompleteAddress
//   3. Servicios (Fase H.4) — 8 switches con candado segun capacidad
//   4. Sincronizacion (Fase H.5) — boton + mensaje adaptativo
//
// Patron: padre controla la apertura via prop courier (null = cerrado).
// Cambios LOCALES hasta "Guardar Cambios" (PUT parcial al endpoint admin).
// =============================================================================

export interface ServicioCourier {
  id?: number;
  codigoServicio: string;
  grupo: string;
  ordenVisual: number;
  activo: boolean;
  capacidadTecnicaMapeada: string | null;
}

export interface CourierEditable {
  id: number;
  nombre: string;
  activo: boolean;
  emailSoporte: string | null;
  telefonoSoporte: string | null;
  contactoComercial: string | null;
  logoUrl: string | null;
  puedeConsolidar: boolean;
  cpDepositoConsolidador: string | null;
  cpDepositoConsolidadorCalle: string | null;
  cpDepositoConsolidadorNumero: string | null;
  cpDepositoConsolidadorCp: string | null;
  cpDepositoConsolidadorLocalidad: string | null;
  cpDepositoConsolidadorProvincia: string | null;
  tieneSucursales: boolean;
  servicios: ServicioCourier[];
}

interface Props {
  courier: CourierEditable | null;
  onClose: () => void;
  onSaved: (actualizado: CourierEditable) => void;
}

export default function CourierDrawer({ courier, onClose, onSaved }: Props) {
  // Estado local: el courier en edicion. Se inicializa cuando llega un courier
  // nuevo (cambio de id) y se descarta al cerrar/cancelar.
  const [editado, setEditado] = useState<CourierEditable | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sincronizar el estado local cuando el padre cambia el courier seleccionado.
  useEffect(() => {
    if (courier) {
      setEditado({ ...courier });
      setErrorMsg(null);
    }
  }, [courier?.id]);

  if (!courier || !editado) return null;

  // Setter helper tipado: cambia un campo del editado sin perder los demas.
  function set<K extends keyof CourierEditable>(campo: K, valor: CourierEditable[K]) {
    setEditado((prev) => (prev ? { ...prev, [campo]: valor } : prev));
  }

  async function handleGuardar() {
    if (!editado) return;
    setGuardando(true);
    setErrorMsg(null);
    try {
      // PUT parcial con TODO el editado (el endpoint solo aplica campos presentes,
      // y nuestro form mantiene todos los campos visibles editables).
      const res = await fetch("/api/admin/couriers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editado),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || "Error al guardar");
        return;
      }
      // El endpoint devuelve { courier: actualizado }
      onSaved(data.courier);
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message || "Error de red");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============ HEADER ============ */}
        <div className="bg-[#233b6b] text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">
              Editar courier
            </div>
            <h2 className="text-xl font-bold">{editado.nombre}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ============ BODY (scrollable) ============ */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* ----- Section 1: Info General ----- */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Info general
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">Email de soporte</span>
                <input
                  type="email"
                  value={editado.emailSoporte || ""}
                  onChange={(e) => set("emailSoporte", e.target.value || null)}
                  placeholder="soporte@courier.com"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-700">Telefono de soporte</span>
                <input
                  type="text"
                  value={editado.telefonoSoporte || ""}
                  onChange={(e) => set("telefonoSoporte", e.target.value || null)}
                  placeholder="+54 11 ..."
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-700">Contacto comercial</span>
                <input
                  type="text"
                  value={editado.contactoComercial || ""}
                  onChange={(e) => set("contactoComercial", e.target.value || null)}
                  placeholder="Nombre + email/telefono"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-700">URL del logo</span>
                <input
                  type="url"
                  value={editado.logoUrl || ""}
                  onChange={(e) => set("logoUrl", e.target.value || null)}
                  placeholder="https://..."
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                />
              </label>
            </div>
          </section>

          {/* Las secciones 2, 3 y 4 se agregan en H.3, H.4, H.5. */}
        </div>

        {/* ============ FOOTER (sticky) ============ */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-between flex-shrink-0">
          {errorMsg ? (
            <div className="text-xs text-red-600 flex-1 mr-3">{errorMsg}</div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={guardando}
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardar}
              disabled={guardando}
              className="px-4 py-2 text-sm font-semibold bg-[#233b6b] hover:bg-[#1a2d52] text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
