"use client";

import { useState } from "react";
import { X, Loader2, Truck, CheckCircle2, AlertCircle } from "lucide-react";

// =============================================================================
// DEUDA 32+37 (Fase I): Asistente de alta de courier (espacio Shipro).
// =============================================================================
// Drawer lateral que ofrece la lista de "integrables" (couriers con adapter
// listo pero sin fila en BD). El admin elige uno, opcionalmente carga contactos,
// y al confirmar el POST crea la fila + seedea los 8 ServicioCourier en off.
//
// El courier creado aparece en la lista del page padre via onSaved → cargarTodo.
// Despues el admin puede editarlo en CourierDrawer para activar servicios y/o
// configurar el consolidador.
// =============================================================================

export interface Integrable {
  canonico: string;
  display: string;
}

export interface CourierCreado {
  id: number;
  nombre: string;
  // El POST devuelve el courier completo con servicios; aca solo declaramos lo
  // que la pagina necesita para actualizar la lista. El padre hace cargarTodo()
  // que refetchea todo igualmente, asi que estos datos son indicativos.
}

interface Props {
  isOpen: boolean;
  integrables: Integrable[];
  onClose: () => void;
  onSaved: (creado: CourierCreado) => void;
}

export default function IntegrarCourierDrawer({
  isOpen,
  integrables,
  onClose,
  onSaved,
}: Props) {
  const [seleccionado, setSeleccionado] = useState<Integrable | null>(null);
  const [emailSoporte, setEmailSoporte] = useState("");
  const [telefonoSoporte, setTelefonoSoporte] = useState("");
  const [contactoComercial, setContactoComercial] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Reset al cerrar: limpiamos seleccion + form para la proxima apertura.
  const handleClose = () => {
    setSeleccionado(null);
    setEmailSoporte("");
    setTelefonoSoporte("");
    setContactoComercial("");
    setErrorMsg(null);
    onClose();
  };

  const handleIntegrar = async () => {
    if (!seleccionado) return;
    setEnviando(true);
    setErrorMsg(null);
    try {
      const body: Record<string, string> = {
        nombre: seleccionado.canonico,
      };
      if (emailSoporte.trim()) body.emailSoporte = emailSoporte.trim();
      if (telefonoSoporte.trim()) body.telefonoSoporte = telefonoSoporte.trim();
      if (contactoComercial.trim()) body.contactoComercial = contactoComercial.trim();

      const res = await fetch("/api/admin/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || "Error al integrar el courier");
        return;
      }
      // Cerrar primero, despues notificar — mismo patron que CourierDrawer.
      handleClose();
      onSaved(data.courier);
    } catch (e: any) {
      setErrorMsg(e?.message || "Error de red");
    } finally {
      setEnviando(false);
    }
  };

  const sinIntegrables = integrables.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="bg-[#233b6b] text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">
              Asistente
            </div>
            <h2 className="text-xl font-bold">Integrar nuevo courier</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {sinIntegrables ? (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 space-y-2">
                <p className="font-semibold">No hay couriers para integrar</p>
                <p className="text-xs">
                  Todos los couriers con adapter ya estan integrados en la
                  plataforma. Para agregar uno nuevo (ej: OCA, Andesmar),
                  primero hay que desarrollar su adapter y registrarlo en
                  CourierFactory y en serviciosSoportados.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Selector de courier */}
              <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Courier a integrar
                </div>
                <p className="text-xs text-gray-600">
                  Eligi un courier de la lista. Al confirmar, se crea su
                  registro en la plataforma con todos los servicios apagados.
                  Despues lo configuras en su drawer.
                </p>
                <div className="space-y-2 pt-1">
                  {integrables.map((it) => (
                    <label
                      key={it.canonico}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        seleccionado?.canonico === it.canonico
                          ? "border-[#233b6b] bg-[#233b6b]/5"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="integrable"
                        checked={seleccionado?.canonico === it.canonico}
                        onChange={() => setSeleccionado(it)}
                        className="w-4 h-4 accent-[#233b6b]"
                      />
                      <Truck className="w-4 h-4 text-gray-500" />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-800">
                          {it.display}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          Adapter listo · canonico: {it.canonico}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              {/* Contactos opcionales */}
              {seleccionado && (
                <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Contactos (opcional)
                  </div>
                  <p className="text-xs text-gray-600">
                    Podes completarlos ahora o despues desde el drawer.
                  </p>
                  <div className="space-y-3 pt-1">
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">
                        Email de soporte
                      </span>
                      <input
                        type="email"
                        value={emailSoporte}
                        onChange={(e) => setEmailSoporte(e.target.value)}
                        placeholder="soporte@courier.com"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">
                        Telefono de soporte
                      </span>
                      <input
                        type="text"
                        value={telefonoSoporte}
                        onChange={(e) => setTelefonoSoporte(e.target.value)}
                        placeholder="+54 11 ..."
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">
                        Contacto comercial
                      </span>
                      <input
                        type="text"
                        value={contactoComercial}
                        onChange={(e) => setContactoComercial(e.target.value)}
                        placeholder="Nombre + email/telefono"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#233b6b]/30"
                      />
                    </label>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-between flex-shrink-0">
          {errorMsg ? (
            <div className="text-xs text-red-600 flex-1 mr-3">{errorMsg}</div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              disabled={enviando}
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleIntegrar}
              disabled={enviando || !seleccionado || sinIntegrables}
              className="px-4 py-2 text-sm font-semibold bg-[#233b6b] hover:bg-[#1a2d52] text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
              <CheckCircle2 className="w-4 h-4" />
              Integrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
