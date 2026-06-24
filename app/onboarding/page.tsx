// ============================================================================
// /onboarding — Wizard obligatorio cliente (DEUDA 17.E.4, 2026-06-23)
//
// State machine de 4 pasos:
//   1. Cambio password temporal → POST /api/onboarding/cambiar-password
//   2. Confirmar datos empresa → PATCH /api/onboarding/confirmar-datos
//   3. Primer deposito → POST /api/depositos (reuse DepositoForm)
//   4. Primer courier → POST /api/configuracion/couriers (mini-setup)
//
// Al completar paso 4 → POST /api/onboarding/finalizar → useSession().update()
// → router.replace("/") → cliente queda libre del gate.
//
// IMPORTANTE: ruta NO esta dentro de (dashboard) group → no aplica el gate
// del layout (evita loop infinito).
// ============================================================================

"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Lock,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import DepositoForm from "@/components/configuracion/DepositoForm";
import TransportesTab from "@/components/configuracion/TransportesTab";

type PasoWizard = 1 | 2 | 3 | 4;

export default function OnboardingWizard() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  // DEUDA 17.E.4.1b: si el usuario ya cambio su password temporal,
  // arrancar el wizard en paso 2 (datos empresa). Evita pedirle al
  // gerente que cambie password otra vez si re-entra mid-flow.
  const pasoInicial: PasoWizard = session?.user?.passwordTemporal === false ? 2 : 1;
  const [pasoActual, setPasoActual] = useState<PasoWizard>(pasoInicial);

  // --- Paso 1: cambio password ---
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [passwordConfirma, setPasswordConfirma] = useState("");
  const [mostrarActual, setMostrarActual] = useState(false);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [mostrarConfirma, setMostrarConfirma] = useState(false);
  const [paso1Loading, setPaso1Loading] = useState(false);
  const [paso1Error, setPaso1Error] = useState("");

  // --- Paso 4: primer courier + finalizar ---
  const [couriersActivos, setCouriersActivos] = useState(0);
  const [paso4Loading, setPaso4Loading] = useState(false);
  const [paso4Error, setPaso4Error] = useState("");

  // --- Paso 2: confirmar datos ---
  const [datosLoading, setDatosLoading] = useState(true);
  const [paso2Loading, setPaso2Loading] = useState(false);
  const [paso2Error, setPaso2Error] = useState("");
  // Empresa (mostrados al gerente):
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState(""); // read-only
  const [direccionCalle, setDireccionCalle] = useState("");
  const [direccionAltura, setDireccionAltura] = useState("");
  const [direccionCP, setDireccionCP] = useState("");
  const [direccionLocalidad, setDireccionLocalidad] = useState("");
  const [direccionProvincia, setDireccionProvincia] = useState("");
  const [modalidadPago, setModalidadPago] = useState(""); // read-only
  // Usuario:
  const [usuarioNombre, setUsuarioNombre] = useState("");
  const [usuarioEmail, setUsuarioEmail] = useState(""); // read-only
  const [usuarioTelefono, setUsuarioTelefono] = useState("");

  // DEUDA 17.E.4.4 BUGFIX 2 (2026-06-23): useEffect debe estar ANTES del
  // early return "if (status === loading)" para mantener consistente la
  // cantidad de hooks entre renders. React's Rules of Hooks lo requiere.
  useEffect(() => {
    if (pasoActual !== 2) return;
    if (!datosLoading) return; // ya cargado
    (async () => {
      try {
        const res = await fetch("/api/onboarding/datos");
        const data = await res.json();
        if (!res.ok) {
          setPaso2Error(data.error || "No pudimos cargar los datos.");
          setDatosLoading(false);
          return;
        }
        setRazonSocial(data.empresa.nombre || "");
        setCuit(data.empresa.cuit || "");
        setDireccionCalle(data.empresa.direccionFiscalCalle || "");
        setDireccionAltura(data.empresa.direccionFiscalAltura || "");
        setDireccionCP(data.empresa.direccionFiscalCP || "");
        setDireccionLocalidad(data.empresa.direccionFiscalLocalidad || "");
        setDireccionProvincia(data.empresa.direccionFiscalProvincia || "");
        setModalidadPago(data.empresa.modalidadPago || "");
        setUsuarioNombre(data.usuario.nombre || "");
        setUsuarioEmail(data.usuario.email || "");
        setUsuarioTelefono(data.usuario.telefono || "");
        setDatosLoading(false);
      } catch (err) {
        setPaso2Error("Error de red al cargar los datos.");
        setDatosLoading(false);
      }
    })();
  }, [pasoActual, datosLoading]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#233b6b]" />
      </div>
    );
  }

  const userName = session?.user?.name || "Cliente";

  // ============================================================================
  // Handler paso 1 — cambio password
  // ============================================================================
  const handleCambiarPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaso1Error("");

    // Validaciones frontend inline.
    if (!passwordActual || !passwordNueva || !passwordConfirma) {
      setPaso1Error("Completa todos los campos.");
      return;
    }
    if (passwordNueva.length < 8) {
      setPaso1Error("La nueva clave debe tener al menos 8 caracteres.");
      return;
    }
    if (passwordNueva !== passwordConfirma) {
      setPaso1Error("La confirmacion no coincide con la nueva clave.");
      return;
    }
    if (passwordNueva === passwordActual) {
      setPaso1Error("La nueva clave debe ser distinta a la actual.");
      return;
    }

    setPaso1Loading(true);
    try {
      const res = await fetch("/api/onboarding/cambiar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordActual, passwordNueva }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaso1Error(data.error || "No pudimos cambiar la clave. Intenta de nuevo.");
        setPaso1Loading(false);
        return;
      }
      // DEUDA 17.E.4.1c: refrescar JWT para que passwordTemporal=false
      // se refleje en session.user (consistencia post-cambio).
      await update();
      // Exito → avanzar al paso 2.
      setPasoActual(2);
      setPaso1Loading(false);
    } catch (err) {
      setPaso1Error("Error de red. Intenta de nuevo.");
      setPaso1Loading(false);
    }
  };

  // ============================================================================
  // Handler paso 2 — submit confirmar (useEffect moved earlier, before status check)
  // ============================================================================

  const handleConfirmarDatos = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaso2Error("");

    // Validaciones inline.
    if (!razonSocial || !direccionCalle || !direccionAltura || !direccionCP ||
        !direccionLocalidad || !direccionProvincia || !usuarioNombre || !usuarioTelefono) {
      setPaso2Error("Completa todos los campos obligatorios.");
      return;
    }
    if (!/^\+549\d{10}$/.test(usuarioTelefono)) {
      setPaso2Error("Telefono debe ser WhatsApp formato +5491134567890.");
      return;
    }

    setPaso2Loading(true);
    try {
      const res = await fetch("/api/onboarding/confirmar-datos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razonSocial,
          direccionFiscalCalle: direccionCalle,
          direccionFiscalAltura: direccionAltura,
          direccionFiscalCP: direccionCP,
          direccionFiscalLocalidad: direccionLocalidad,
          direccionFiscalProvincia: direccionProvincia,
          usuarioNombre,
          usuarioTelefono,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaso2Error(data.error || "No pudimos guardar los datos.");
        setPaso2Loading(false);
        return;
      }
      // Exito → avanzar al paso 3.
      setPasoActual(3);
      setPaso2Loading(false);
    } catch (err) {
      setPaso2Error("Error de red. Intenta de nuevo.");
      setPaso2Loading(false);
    }
  };

  // ============================================================================
  // Handler paso 4 — finalizar onboarding
  // ============================================================================
  const handleFinalizarWizard = async () => {
    setPaso4Error("");
    if (couriersActivos === 0) {
      setPaso4Error("Activa al menos un courier antes de finalizar.");
      return;
    }
    setPaso4Loading(true);
    try {
      const res = await fetch("/api/onboarding/finalizar", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setPaso4Error(data.error || "No pudimos finalizar el onboarding.");
        setPaso4Loading(false);
        return;
      }
      // Refrescar JWT con onboardingCompletado=true.
      await update();
      // Redirect al dashboard.
      router.replace("/");
    } catch (err) {
      setPaso4Error("Error de red. Intenta de nuevo.");
      setPaso4Loading(false);
    }
  };

  // ============================================================================
  // Render — Progress bar + paso actual
  // ============================================================================
  const PASOS_LABELS = ["Clave nueva", "Datos empresa", "Primer depósito", "Primer courier"];

  // DEUDA 17.E.4.4 BUGFIX (2026-06-23): movimos el render de paso 3
  // (DepositoForm fullscreen) a un conditional dentro del render normal,
  // no un early return. React's "Rules of Hooks" requiere que la cantidad
  // de hooks sea consistente entre renders — el early return rompia esa regla
  // cuando el wizard cambiaba de paso 3 a paso 4.

  return (
    <>
      {pasoActual === 3 && (
        <DepositoForm
          isOpen={true}
          onClose={() => {}}
          onSaved={() => setPasoActual(4)}
          empresaId={session?.user?.empresaId ?? null}
          depositoExistente={null}
          puedeEditarFlags={true}
          totalDepositos={0}
          hideCloseButton={true}
        />
      )}
      {pasoActual !== 3 && (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#233b6b] mb-1">Bienvenido a Shipro, {userName}</h1>
          <p className="text-gray-500 text-sm">Completá los 4 pasos para activar tu cuenta.</p>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between">
            {PASOS_LABELS.map((label, idx) => {
              const numero = idx + 1;
              const completado = numero < pasoActual;
              const activo = numero === pasoActual;
              return (
                <div key={numero} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                      completado ? "bg-green-500 text-white" :
                      activo ? "bg-[#233b6b] text-white" :
                      "bg-gray-200 text-gray-400"
                    }`}>
                      {completado ? <CheckCircle2 className="w-5 h-5" /> : numero}
                    </div>
                    <p className={`text-[10px] font-bold mt-2 text-center ${
                      completado ? "text-green-700" :
                      activo ? "text-[#233b6b]" :
                      "text-gray-400"
                    }`}>{label}</p>
                  </div>
                  {idx < PASOS_LABELS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-2 mb-6 ${
                      completado ? "bg-green-500" : "bg-gray-200"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Paso 1 — Cambio de password */}
        {pasoActual === 1 && (
          <div className="bg-white rounded-2xl shadow-lg p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-[#233b6b]/10 rounded-xl flex items-center justify-center">
                <Lock className="w-6 h-6 text-[#233b6b]" />
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-800">Paso 1: Cambia tu clave temporal</h2>
                <p className="text-sm text-gray-500">La clave que recibiste por mail es temporal. Crea una propia para empezar.</p>
              </div>
            </div>

            <form onSubmit={handleCambiarPassword} className="space-y-4">
              {paso1Error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0" /> {paso1Error}
                </div>
              )}

              {/* Password actual */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Clave actual (la que recibiste por mail)</label>
                <div className="relative">
                  <input
                    type={mostrarActual ? "text" : "password"}
                    value={passwordActual}
                    onChange={(e) => setPasswordActual(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarActual(!mostrarActual)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {mostrarActual ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password nueva */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Nueva clave <span className="text-gray-400 font-normal">(mínimo 8 caracteres)</span></label>
                <div className="relative">
                  <input
                    type={mostrarNueva ? "text" : "password"}
                    value={passwordNueva}
                    onChange={(e) => setPasswordNueva(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarNueva(!mostrarNueva)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {mostrarNueva ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirmar password */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Confirmá la nueva clave</label>
                <div className="relative">
                  <input
                    type={mostrarConfirma ? "text" : "password"}
                    value={passwordConfirma}
                    onChange={(e) => setPasswordConfirma(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarConfirma(!mostrarConfirma)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {mostrarConfirma ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={paso1Loading}
                className="w-full py-3 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {paso1Loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Guardando...
                  </>
                ) : (
                  "Continuar al paso 2"
                )}
              </button>
            </form>
          </div>
        )}

        {/* Pasos 2, 3, 4 — PLACEHOLDERS por ahora, se implementan en 17.E.4.2, .3, .4 */}
        {pasoActual === 2 && (
          <div className="bg-white rounded-2xl shadow-lg p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-[#233b6b]/10 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[#233b6b]" />
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-800">Paso 2: Confirmá tus datos</h2>
                <p className="text-sm text-gray-500">Revisá los datos que cargamos. Si algo no está bien, corregilo acá.</p>
              </div>
            </div>

            {datosLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#233b6b]" />
              </div>
            ) : (
              <form onSubmit={handleConfirmarDatos} className="space-y-5">
                {paso2Error && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" /> {paso2Error}
                  </div>
                )}

                {/* Datos empresa */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Datos de la empresa</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Razón Social *</label>
                    <input type="text" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">CUIT <span className="text-gray-400 font-normal">(no editable)</span></label>
                    <input type="text" value={cuit} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500 font-mono" />
                  </div>
                </div>

                {/* Direccion fiscal */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Dirección fiscal</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-500 mb-1">Calle *</label>
                      <input type="text" value={direccionCalle} onChange={(e) => setDireccionCalle(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Altura *</label>
                      <input type="text" value={direccionAltura} onChange={(e) => setDireccionAltura(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">CP *</label>
                      <input type="text" value={direccionCP} onChange={(e) => setDireccionCP(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Localidad *</label>
                      <input type="text" value={direccionLocalidad} onChange={(e) => setDireccionLocalidad(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Provincia *</label>
                      <input type="text" value={direccionProvincia} onChange={(e) => setDireccionProvincia(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                  </div>
                </div>

                {/* Comercial (read-only) */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Modalidad comercial <span className="text-gray-400 font-normal normal-case">(definida por Shipro, no editable)</span></h3>
                  <input type="text" value={modalidadPago} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500" />
                </div>

                {/* Tus datos */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Tus datos como gerente</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Nombre completo *</label>
                    <input type="text" value={usuarioNombre} onChange={(e) => setUsuarioNombre(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Email <span className="text-gray-400 font-normal">(no editable)</span></label>
                      <input type="email" value={usuarioEmail} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">WhatsApp * <span className="text-gray-400 font-normal">(+5491134567890)</span></label>
                      <input type="text" value={usuarioTelefono} onChange={(e) => setUsuarioTelefono(e.target.value)} placeholder="+5491134567890" required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono" />
                    </div>
                  </div>
                </div>

                <button type="submit" disabled={paso2Loading} className="w-full py-3 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2">
                  {paso2Loading ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Guardando...</>
                  ) : (
                    "Continuar al paso 3"
                  )}
                </button>
              </form>
            )}
          </div>
        )}


        {pasoActual === 4 && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-[#233b6b]/10 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[#233b6b]" />
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-800">Paso 4: Activá tu primer courier</h2>
                <p className="text-sm text-gray-500">Marcá al menos un courier como activo. Las credenciales podés cargarlas ahora o más tarde.</p>
              </div>
            </div>

            <div className="-mx-6">
              <TransportesTab
                empresaActivaId={session?.user?.empresaId ?? null}
                embeddedInWizard={true}
                onCouriersActivosChange={setCouriersActivos}
              />
            </div>

            {paso4Error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2 mt-4 mx-6">
                <AlertCircle className="w-5 h-5 shrink-0" /> {paso4Error}
              </div>
            )}

            <div className="mt-6 mx-6 pt-4 border-t border-gray-100">
              {couriersActivos === 0 && (
                <p className="text-xs text-amber-700 mb-3 text-center">
                  Activá al menos un courier para terminar.
                </p>
              )}
              <button
                onClick={handleFinalizarWizard}
                disabled={paso4Loading || couriersActivos === 0}
                className="w-full py-3 bg-[#233b6b] hover:bg-blue-900 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {paso4Loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Activando tu cuenta...</>
                ) : (
                  "Finalizar onboarding y entrar a Shipro"
                )}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
      )}
    </>
  );
}
