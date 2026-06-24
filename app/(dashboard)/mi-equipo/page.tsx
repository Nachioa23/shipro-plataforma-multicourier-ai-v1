// ============================================================================
// /mi-equipo — Gestion del equipo del gerente_cliente
//
// DEUDA 17.F.3 (2026-06-24): permite al gerente:
//   - Ver lista de sus operadores (activos + desactivados).
//   - Crear nuevos operadores (modal con password random + mensaje WhatsApp).
//   - Activar/desactivar operadores (soft-delete via Usuario.activo).
//
// Auth: solo gerente_cliente accede (gate client-side + backend valida tambien).
// ============================================================================

"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Users,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageCircle,
  X as XIcon,
  Copy as CopyIcon,
} from "lucide-react";

type Operador = {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
  activo: boolean;
  passwordTemporal?: boolean;
};

export default function MiEquipoPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal alta operador.
  const [showModal, setShowModal] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  // Modal post-creacion con mensaje WhatsApp.
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [mensajeWhatsApp, setMensajeWhatsApp] = useState("");

  // Gate client-side: solo gerente_cliente.
  useEffect(() => {
    if (status === "loading") return;
    if (session?.user?.rol !== "gerente_cliente") {
      router.replace("/");
    }
  }, [status, session, router]);

  // Cargar operadores.
  const cargarOperadores = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mi-equipo");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No pudimos cargar tu equipo.");
        setLoading(false);
        return;
      }
      setOperadores(data.operadores);
      setLoading(false);
    } catch (err) {
      setError("Error de red al cargar el equipo.");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated" && session?.user?.rol === "gerente_cliente") {
      cargarOperadores();
    }
  }, [status, session]);

  // Crear operador.
  const handleCrearOperador = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");

    if (!nuevoNombre || !nuevoEmail || !nuevoTelefono) {
      setModalError("Completa todos los campos.");
      return;
    }
    if (!/^\+549\d{10}$/.test(nuevoTelefono)) {
      setModalError("Telefono debe ser WhatsApp formato +5491134567890.");
      return;
    }

    setModalLoading(true);
    try {
      const res = await fetch("/api/mi-equipo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoNombre,
          email: nuevoEmail,
          telefono: nuevoTelefono,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "No pudimos crear el operador.");
        setModalLoading(false);
        return;
      }

      // Construir mensaje WhatsApp.
      const mensaje = `¡Hola ${data.operador.nombre}! 👋

Te di de alta como operador en Shipro para que puedas gestionar los envíos de la empresa.

🔐 Datos de acceso:
URL: ${window.location.origin}/login
Email: ${data.operador.email}
Clave temporal: ${data.passwordTemporal}

En tu primer ingreso vas a tener que cambiar la clave.

¡Bienvenido al equipo! 💪`;

      setMensajeWhatsApp(mensaje);
      setShowModal(false);
      setShowWhatsAppModal(true);
      setNuevoNombre("");
      setNuevoEmail("");
      setNuevoTelefono("");
      setModalLoading(false);

      // Refrescar lista.
      cargarOperadores();
    } catch (err) {
      setModalError("Error de red. Intenta de nuevo.");
      setModalLoading(false);
    }
  };

  // Toggle activar/desactivar.
  const handleToggleActivo = async (operador: Operador) => {
    const nuevoEstado = !operador.activo;
    const accion = nuevoEstado ? "activar" : "desactivar";
    if (!confirm(`¿Confirmás que querés ${accion} a ${operador.nombre}?`)) return;

    try {
      const res = await fetch(`/api/mi-equipo/${operador.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: nuevoEstado }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No pudimos actualizar al operador.");
        return;
      }
      cargarOperadores();
    } catch (err) {
      alert("Error de red. Intenta de nuevo.");
    }
  };

  const copiarMensaje = () => {
    navigator.clipboard.writeText(mensajeWhatsApp);
    alert("Mensaje copiado al portapapeles.");
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#233b6b]" />
      </div>
    );
  }

  if (session?.user?.rol !== "gerente_cliente") {
    return null; // Gate ya redirige; placeholder mientras tanto.
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-[#233b6b] flex items-center gap-2">
            <Users className="w-7 h-7" /> Mi equipo
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestioná los operadores de tu empresa. Podés agregarlos, desactivarlos o reactivarlos cuando quieras.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Agregar operador
        </button>
      </div>

      {/* Error global */}
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {/* Tabla operadores */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#233b6b]" />
          </div>
        ) : operadores.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-bold">Todavía no tenés operadores.</p>
            <p className="text-xs text-gray-400 mt-1">Tocá "Agregar operador" para empezar.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-black text-gray-600 uppercase tracking-wider">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-black text-gray-600 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-black text-gray-600 uppercase tracking-wider">WhatsApp</th>
                <th className="px-4 py-3 text-left text-xs font-black text-gray-600 uppercase tracking-wider">Estado</th>
                <th className="px-4 py-3 text-right text-xs font-black text-gray-600 uppercase tracking-wider">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {operadores.map((op) => {
                const telefonoSinPlus = op.telefono?.replace("+", "") || "";
                return (
                  <tr key={op.id} className={op.activo ? "" : "bg-gray-50 text-gray-400"}>
                    <td className="px-4 py-3 text-sm font-bold">{op.nombre}</td>
                    <td className="px-4 py-3 text-sm">{op.email}</td>
                    <td className="px-4 py-3 text-sm">
                      {op.telefono ? (
                        <a
                          href={`https://wa.me/${telefonoSinPlus}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 hover:text-green-700 font-medium inline-flex items-center gap-1"
                        >
                          <MessageCircle className="w-4 h-4" /> {op.telefono}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {op.activo ? (
                        <span className="inline-flex items-center gap-1 text-green-700 font-bold text-xs">
                          <CheckCircle2 className="w-4 h-4" /> Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-500 font-bold text-xs">
                          <XCircle className="w-4 h-4" /> Desactivado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <button
                        onClick={() => handleToggleActivo(op)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                          op.activo
                            ? "bg-red-50 text-red-600 hover:bg-red-100"
                            : "bg-green-50 text-green-600 hover:bg-green-100"
                        }`}
                      >
                        {op.activo ? "Desactivar" : "Reactivar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal alta operador */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-[#233b6b] p-5 flex justify-between items-center text-white rounded-t-2xl">
              <h2 className="text-lg font-black">Agregar operador</h2>
              <button onClick={() => { setShowModal(false); setModalError(""); }} className="p-1 hover:bg-blue-800 rounded">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCrearOperador} className="p-6 space-y-4">
              {modalError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0" /> {modalError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Nombre completo *</label>
                <input
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Email *</label>
                <input
                  type="email"
                  value={nuevoEmail}
                  onChange={(e) => setNuevoEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">WhatsApp * <span className="text-gray-400 font-normal">(+5491134567890)</span></label>
                <input
                  type="text"
                  value={nuevoTelefono}
                  onChange={(e) => setNuevoTelefono(e.target.value)}
                  placeholder="+5491134567890"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={modalLoading}
                className="w-full py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {modalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</> : "Crear operador"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal post-creacion con mensaje WhatsApp */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="bg-green-600 p-5 flex justify-between items-center text-white rounded-t-2xl">
              <h2 className="text-lg font-black flex items-center gap-2">
                <MessageCircle className="w-5 h-5" /> Operador creado
              </h2>
              <button onClick={() => setShowWhatsAppModal(false)} className="p-1 hover:bg-green-700 rounded">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Mensaje listo para que se lo envíes a tu operador. Copialo y pegalo en WhatsApp:
              </p>
              <textarea
                value={mensajeWhatsApp}
                readOnly
                rows={12}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-xs font-mono bg-gray-50"
              />
              <button
                onClick={copiarMensaje}
                className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <CopyIcon className="w-4 h-4" /> Copiar mensaje
              </button>
              <button
                onClick={() => setShowWhatsAppModal(false)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
