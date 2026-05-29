"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import AutocompleteAddress, { type AddressData } from "@/components/forms/AutocompleteAddress";

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
      // El endpoint devuelve { courier: actualizado }.
      // Cerrar PRIMERO, notificar despues: garantiza que el toast del padre
      // quede visible sin la animacion de cierre del drawer robando atencion.
      onClose();
      onSaved(data.courier);
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

          {/* ----- Section 2: Consolidador ----- */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Consolidador
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editado.puedeConsolidar}
                  onChange={(e) => set("puedeConsolidar", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>

            {editado.puedeConsolidar ? (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-gray-600">
                  Direccion del deposito consolidador. Los couriers de ultima
                  milla cotizan desde este punto cuando este courier es el
                  recolector.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Buscar direccion
                  </label>
                  <AutocompleteAddress
                    placeholder="Ej: Av. Cabildo 1234, CABA"
                    onPlaceChanged={(data: AddressData) => {
                      // Llenado parcial: solo seteamos los campos que vinieron.
                      // El CP se normaliza a 4 digitos (convencion canonica).
                      if (data.calle) set("cpDepositoConsolidadorCalle", data.calle);
                      if (data.altura) set("cpDepositoConsolidadorNumero", data.altura);
                      if (data.cp) {
                        const cpLimpio = data.cp.replace(/\D/g, "").slice(0, 4);
                        if (cpLimpio) set("cpDepositoConsolidadorCp", cpLimpio);
                      }
                      if (data.localidad) set("cpDepositoConsolidadorLocalidad", data.localidad);
                      if (data.provincia) set("cpDepositoConsolidadorProvincia", data.provincia);
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block col-span-2 md:col-span-1">
                    <span className="text-xs font-semibold text-gray-700">Calle</span>
                    <input
                      type="text"
                      value={editado.cpDepositoConsolidadorCalle || ""}
                      onChange={(e) => set("cpDepositoConsolidadorCalle", e.target.value || null)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                    />
                  </label>
                  <label className="block col-span-2 md:col-span-1">
                    <span className="text-xs font-semibold text-gray-700">Numero</span>
                    <input
                      type="text"
                      value={editado.cpDepositoConsolidadorNumero || ""}
                      onChange={(e) => set("cpDepositoConsolidadorNumero", e.target.value || null)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-700">Codigo Postal</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editado.cpDepositoConsolidadorCp || ""}
                      onChange={(e) => {
                        const limpio = e.target.value.replace(/\D/g, "").slice(0, 4);
                        set("cpDepositoConsolidadorCp", limpio || null);
                      }}
                      placeholder="Ej: 1614"
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-700">Localidad</span>
                    <input
                      type="text"
                      value={editado.cpDepositoConsolidadorLocalidad || ""}
                      onChange={(e) => set("cpDepositoConsolidadorLocalidad", e.target.value || null)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                    />
                  </label>
                  <label className="block col-span-2">
                    <span className="text-xs font-semibold text-gray-700">Provincia</span>
                    <input
                      type="text"
                      value={editado.cpDepositoConsolidadorProvincia || ""}
                      onChange={(e) => set("cpDepositoConsolidadorProvincia", e.target.value || null)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                Este courier no opera como consolidador. Para activarlo, prende
                el switch — vas a poder cargar la direccion del deposito.
              </p>
            )}
          </section>

          {/* Las secciones 3 y 4 se agregan en H.4, H.5. */}
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
