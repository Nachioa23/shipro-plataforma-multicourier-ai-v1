"use client";

import { useState, useEffect } from "react";
import { Building2, Plus, Search, Mail, CheckCircle2, Send, Loader2, AlertCircle, Settings, Users, Percent, Save, X, Copy, Trash2, ShieldAlert } from 'lucide-react';
import { useSession } from "next-auth/react";
import {
  validarCUIT,
  validarWhatsApp,
} from "@/lib/utils/validaciones-onboarding";

export default function GestionClientes() {
  const { data: session } = useSession();
  
  const [modalAltaAbierto, setModalAltaAbierto] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<any>(null); 
  
  const [clientes, setClientes] = useState<any[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  
  // DEUDA 17.C: form expandido Fase A — todos los datos del cliente nuevo.
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState("");
  // Direccion fiscal
  const [direccionCalle, setDireccionCalle] = useState("");
  const [direccionAltura, setDireccionAltura] = useState("");
  const [direccionCP, setDireccionCP] = useState("");
  const [direccionLocalidad, setDireccionLocalidad] = useState("");
  const [direccionProvincia, setDireccionProvincia] = useState("");
  // Configuracion comercial
  const [modalidadPago, setModalidadPago] = useState<"PREPAGO" | "POSTPAGO">("PREPAGO");
  const [limiteDescubierto, setLimiteDescubierto] = useState("");
  const [modeloAHabilitado, setModeloAHabilitado] = useState(false);
  // Datos gerente
  const [gerenteNombre, setGerenteNombre] = useState("");
  const [gerenteEmail, setGerenteEmail] = useState("");
  const [gerenteTelefono, setGerenteTelefono] = useState("");
  // Notas internas Shipro
  const [notasInternas, setNotasInternas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [linkMagico, setLinkMagico] = useState<any>(null); 

  const [creandoUsuario, setCreandoUsuario] = useState(false);
  const [nuevoUser, setNuevoUser] = useState({ nombre: "", email: "", rol: "operador_cliente" });
  const [linkMagicoUsuario, setLinkMagicoUsuario] = useState<any>(null);

  const esEquipoShipro = session?.user?.rol === 'admin_shipro' || session?.user?.rol === 'operador_shipro';

  const fetchClientes = async () => {
    try {
      const res = await fetch("/api/clientes");
      const data = await res.json();
      setClientes(data);
    } catch (err) {
      console.error("Error al cargar", err);
    } finally {
      setCargandoLista(false);
    }
  };

  useEffect(() => {
    if (esEquipoShipro) fetchClientes();
  }, [esEquipoShipro]);

  const handleCrearCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setLinkMagico(null);

    try {
      // DEUDA 17.C: validaciones inline (defense-in-depth, backend valida igual).
      const cuitLimpio = validarCUIT(cuit);
      if (!cuitLimpio) {
        setError("CUIT invalido. Debe tener 11 digitos.");
        setGuardando(false);
        return;
      }
      if (!validarWhatsApp(gerenteTelefono)) {
        setError("Telefono del gerente debe ser WhatsApp formato +5491134567890 (sin espacios ni guiones).");
        setGuardando(false);
        return;
      }
      if (modalidadPago === "POSTPAGO" && (parseFloat(limiteDescubierto) || 0) <= 0) {
        setError("POSTPAGO requiere un limite descubierto mayor a 0.");
        setGuardando(false);
        return;
      }

      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razonSocial,
          cuit: cuitLimpio,
          direccionFiscalCalle: direccionCalle,
          direccionFiscalAltura: direccionAltura,
          direccionFiscalCP: direccionCP,
          direccionFiscalLocalidad: direccionLocalidad,
          direccionFiscalProvincia: direccionProvincia,
          modalidadPago,
          limiteDescubierto: modalidadPago === "POSTPAGO" ? parseFloat(limiteDescubierto) : 0,
          modeloAHabilitado,
          gerente: {
            nombre: gerenteNombre,
            email: gerenteEmail,
            telefono: gerenteTelefono,
          },
          notasInternas: notasInternas.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Ocurrió un error al guardar.");
      } else {
        const urlLogin = `${window.location.origin}/login`;
        setLinkMagico({
          mensajeWpp: `¡Hola ${gerenteNombre}! Tu cuenta corporativa en Shipro ya está activa 🚀\n\nIngresá a: ${urlLogin}\nUsuario: ${gerenteEmail}\nClave Temporal: ${data.passwordTemporal}\n\nAl ingresar, te vamos a guiar paso a paso para:\n1. Cambiar tu clave\n2. Confirmar datos de tu empresa\n3. Cargar tu primer depósito\n4. Conectar con un courier\n\nListo. Empezamos.`
        });
        setRazonSocial("");
        setCuit("");
        setDireccionCalle("");
        setDireccionAltura("");
        setDireccionCP("");
        setDireccionLocalidad("");
        setDireccionProvincia("");
        setModalidadPago("PREPAGO");
        setLimiteDescubierto("");
        setModeloAHabilitado(false);
        setGerenteNombre("");
        setGerenteEmail("");
        setGerenteTelefono("");
        setNotasInternas("");
        fetchClientes(); 
      }
    } catch (err) {
      setError("Error de conexión. Intentá nuevamente.");
    } finally {
      setGuardando(false);
    }
  };

  const handleCrearUsuarioAdicional = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoUser.nombre || !nuevoUser.email) return;
    
    setGuardando(true);
    setLinkMagicoUsuario(null);
    try {
      const res = await fetch("/api/clientes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          accion: 'crear_usuario',
          empresaId: clienteSeleccionado.id, 
          nombre: nuevoUser.nombre, 
          email: nuevoUser.email, 
          rol: nuevoUser.rol 
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setClienteSeleccionado({
          ...clienteSeleccionado,
          usuarios: [...clienteSeleccionado.usuarios, data]
        });
        
        const urlLogin = `${window.location.origin}/login`;
        setLinkMagicoUsuario({
          mensajeWpp: `¡Hola ${data.nombre}! Te crearon un usuario en Shipro 🚀\n\nIngresá a: ${urlLogin}\nUsuario: ${data.email}\nClave Temporal: ${data.passwordTemporal}`
        });

        setNuevoUser({ nombre: "", email: "", rol: "operador_cliente" });
        setCreandoUsuario(false);
        fetchClientes(); 
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Error al crear usuario");
      }
    } catch (error) {
      alert("Error de conexión");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarUsuario = async (usuarioId: number) => {
    if (!confirm("¿Estás seguro de eliminar a este usuario de forma permanente?")) return;
    
    try {
      const res = await fetch(`/api/clientes?id=${usuarioId}`, { method: "DELETE" });
      if (res.ok) {
        setClienteSeleccionado({
          ...clienteSeleccionado,
          usuarios: clienteSeleccionado.usuarios.filter((u: any) => u.id !== usuarioId)
        });
        fetchClientes();
      } else {
        alert("Error al eliminar el usuario");
      }
    } catch (error) {
      alert("Error de conexión");
    }
  };

  if (!esEquipoShipro) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-black text-gray-800">Acceso Denegado</h2>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-hidden font-sans">
      
      {/* MODAL ALTA CLIENTE */}
      {modalAltaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="bg-[#233b6b] p-6 text-center relative">
               <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                 {linkMagico ? <CheckCircle2 className="w-6 h-6 text-green-400" /> : <Send className="w-6 h-6 text-white" />}
               </div>
               <h2 className="text-xl font-black text-white">{linkMagico ? "¡Cuenta Creada!" : "Onboarding de Cliente"}</h2>
            </div>

            {!linkMagico ? (
              <form onSubmit={handleCrearCliente} className="flex flex-col flex-1 p-6 space-y-5 overflow-y-auto">
                {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2"><AlertCircle className="w-5 h-5 shrink-0" /> {error}</div>}

                {/* SECCION 1 — Datos de empresa */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Datos de la empresa</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Razón Social *</label>
                    <input type="text" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">CUIT * <span className="text-gray-400 font-normal">(11 dígitos, con o sin guiones)</span></label>
                    <input type="text" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="20-12345678-9" required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                  </div>
                </div>

                {/* SECCION 2 — Direccion fiscal */}
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

                {/* SECCION 3 — Configuracion comercial */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Configuración comercial</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Modalidad de pago *</label>
                    <select value={modalidadPago} onChange={(e) => setModalidadPago(e.target.value as "PREPAGO" | "POSTPAGO")} className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none bg-white">
                      <option value="PREPAGO">PREPAGO (billetera prepaga, default)</option>
                      <option value="POSTPAGO">POSTPAGO (cuenta corriente)</option>
                    </select>
                  </div>
                  {modalidadPago === "POSTPAGO" && (
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Límite descubierto autorizado * <span className="text-gray-400 font-normal">(en pesos)</span></label>
                      <input type="number" value={limiteDescubierto} onChange={(e) => setLimiteDescubierto(e.target.value)} placeholder="100000" required min="1" className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                  )}
                  <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={modeloAHabilitado} onChange={(e) => setModeloAHabilitado(e.target.checked)} className="w-4 h-4 rounded text-[#233b6b] focus:ring-[#233b6b]" />
                    <div>
                      <p className="text-sm font-bold text-gray-700">Permitir Modelo A (cuentas Shipro)</p>
                      <p className="text-[10px] text-gray-500">El cliente puede usar credenciales de Shipro en sus envíos. Default: false (cliente trae sus propias credenciales).</p>
                    </div>
                  </label>
                </div>

                {/* SECCION 4 — Datos del gerente */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Datos del gerente</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Nombre y apellido *</label>
                    <input type="text" value={gerenteNombre} onChange={(e) => setGerenteNombre(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Email *</label>
                      <input type="email" value={gerenteEmail} onChange={(e) => setGerenteEmail(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">WhatsApp * <span className="text-gray-400 font-normal">(+5491134567890)</span></label>
                      <input type="text" value={gerenteTelefono} onChange={(e) => setGerenteTelefono(e.target.value)} placeholder="+5491134567890" required className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none font-mono" />
                    </div>
                  </div>
                </div>

                {/* SECCION 5 — Notas internas */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black text-[#233b6b] uppercase tracking-wider border-b border-gray-100 pb-2">Notas internas Shipro <span className="text-gray-400 font-normal normal-case">(opcional, no visible al cliente)</span></h3>
                  <textarea value={notasInternas} onChange={(e) => setNotasInternas(e.target.value)} rows={2} placeholder="Cómo llegó, condiciones especiales, contactos secundarios, etc." className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-[#233b6b] outline-none resize-none" />
                </div>

                {/* Botones */}
                <div className="pt-2 flex gap-3 border-t border-gray-100 -mx-6 px-6 pt-4 mt-auto sticky bottom-0 bg-white">
                  <button type="button" onClick={() => {setModalAltaAbierto(false); setError("");}} className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={guardando} className="flex-1 py-3 bg-[#233b6b] text-white font-bold rounded-xl text-sm disabled:opacity-70">
                    {guardando ? <Loader2 className="w-5 h-5 mx-auto animate-spin" /> : 'Confirmar Alta'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-8 flex flex-col items-center text-center space-y-6">
                <p className="text-sm text-gray-600 font-medium">La cuenta fue creada con éxito. Copiá este mensaje y enviaselo a tu cliente por WhatsApp.</p>
                <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-left text-sm text-slate-700 font-mono whitespace-pre-wrap">
                  {linkMagico.mensajeWpp}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(linkMagico.mensajeWpp); alert("Copiado!"); setModalAltaAbierto(false); setLinkMagico(null); }} className="w-full py-3 bg-[#128C7E] text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2">
                  <Copy className="w-5 h-5" /> Copiar para WhatsApp y Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PANEL LATERAL */}
      {clienteSeleccionado && (
        <div className="fixed inset-y-0 right-0 w-full md:w-[500px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300 border-l border-gray-200">
          
          <div className="p-6 bg-slate-50 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div>
              <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">Auditando Cliente</p>
              <h2 className="text-xl font-black text-gray-800">{clienteSeleccionado.nombre}</h2>
            </div>
            <button onClick={() => {setClienteSeleccionado(null); setCreandoUsuario(false); setLinkMagicoUsuario(null);}} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"><X className="w-6 h-6" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <section>
              <h3 className="text-sm font-black text-gray-800 flex items-center gap-2 mb-4 border-b pb-2">
                <Percent className="w-4 h-4 text-amber-500" /> Reglas Comerciales (Shipro Markup)
              </h3>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 font-medium text-center">
                Para configurar los markups de Shipro hacia este cliente, debés ingresar como él (Desde la Bandeja) y entrar a "Mis Transportes".
              </div>
            </section>

            <section>
              <div className="flex justify-between items-center border-b pb-2 mb-4">
                <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-500" /> Equipo del Cliente
                </h3>
                <button onClick={() => {setCreandoUsuario(!creandoUsuario); setLinkMagicoUsuario(null);}} className="text-[10px] font-bold bg-[#233b6b] text-white px-3 py-1.5 rounded hover:bg-blue-900 transition-colors">
                  {creandoUsuario ? 'Cancelar' : '+ Agregar Miembro'}
                </button>
              </div>

              {creandoUsuario && !linkMagicoUsuario && (
                <form onSubmit={handleCrearUsuarioAdicional} className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-4 animate-in slide-in-from-top-2">
                  <h4 className="text-xs font-bold text-indigo-800 mb-3">Nuevo Acceso al Sistema</h4>
                  <div className="space-y-3">
                    <input type="text" placeholder="Nombre completo" value={nuevoUser.nombre} onChange={e => setNuevoUser({...nuevoUser, nombre: e.target.value})} required className="w-full px-3 py-2 text-sm border border-white rounded-md shadow-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                    <input type="email" placeholder="Correo electrónico" value={nuevoUser.email} onChange={e => setNuevoUser({...nuevoUser, email: e.target.value})} required className="w-full px-3 py-2 text-sm border border-white rounded-md shadow-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                    <select value={nuevoUser.rol} onChange={e => setNuevoUser({...nuevoUser, rol: e.target.value})} className="w-full px-3 py-2 text-sm border border-white rounded-md shadow-sm outline-none font-bold text-gray-700">
                      <option value="operador_cliente">Operador (Solo Depósito y Etiquetas)</option>
                      <option value="gerente_cliente">Gerente (Acceso a Finanzas y Red)</option>
                    </select>
                    <button type="submit" disabled={guardando} className="w-full bg-indigo-600 text-white font-bold text-xs py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                      {guardando ? 'Guardando...' : 'Crear Cuenta'}
                    </button>
                  </div>
                </form>
              )}

              {linkMagicoUsuario && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 text-sm text-green-900 font-medium">
                  <p className="mb-2 font-bold flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> ¡Usuario creado!</p>
                  <div className="bg-white p-3 rounded border border-green-100 font-mono text-xs whitespace-pre-wrap">
                    {linkMagicoUsuario.mensajeWpp}
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(linkMagicoUsuario.mensajeWpp); setLinkMagicoUsuario(null); setCreandoUsuario(false); }} className="mt-3 w-full py-2 bg-green-600 text-white font-bold text-xs rounded shadow flex justify-center gap-2">
                    <Copy className="w-4 h-4" /> Copiar y Cerrar
                  </button>
                </div>
              )}
              
              <div className="space-y-2">
                {clienteSeleccionado.usuarios?.map((user: any) => (
                  <div key={user.id} className="flex justify-between items-center p-3 bg-white shadow-sm rounded-lg border border-gray-200 group">
                    <div>
                      <p className="text-xs font-bold text-gray-800 flex items-center gap-1">
                        {user.nombre}
                        {user.rol === 'gerente_cliente' && <span className="bg-yellow-100 text-yellow-700 text-[8px] px-1.5 py-0.5 rounded uppercase">Admin</span>}
                      </p>
                      <p className="text-[10px] text-gray-500">{user.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-gray-400 capitalize hidden sm:block">{user.rol.replace('_', ' ')}</span>
                      <button onClick={() => handleEliminarUsuario(user.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-md hover:bg-red-50" title="Eliminar Usuario">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* CABECERA PRINCIPAL */}
      <header className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 z-10 shadow-sm flex justify-between items-end gap-4">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Cuentas E-commerce</h2>
            <p className="text-sm font-medium text-gray-500 mt-1">Panel de Administración Shipro</p>
          </div>
        </div>
        <button onClick={() => setModalAltaAbierto(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#233b6b] hover:bg-blue-900 text-white text-sm font-bold rounded-lg shadow-sm">
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </button>
      </header>

      {/* GRILLA CLIENTES */}
      <div className="p-8 flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {cargandoLista ? (
            <div className="flex justify-center py-20 text-gray-400"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clientes.map((empresa) => (
                <div key={empresa.id} className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-all hover:shadow-md`}>
                  <div className="p-5 border-b border-gray-100 flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-black uppercase bg-indigo-50 text-indigo-600 border-indigo-100`}>
                        {empresa.nombre.substring(0, 2)}
                      </div>
                      <div>
                        <h3 className={`font-black text-sm text-gray-800`}>{empresa.nombre}</h3>
                        <p className="text-[10px] font-bold text-gray-400">CUIT: {empresa.cuit}</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 flex-1 bg-gray-50/50">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <p className="text-xs font-bold text-gray-600">{empresa.usuarios?.[0]?.email || "Sin usuarios"}</p>
                    </div>
                  </div>
                  <div className="p-4 border-t border-gray-100 bg-white flex justify-between items-center">
                    <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100"><CheckCircle2 className="w-3 h-3"/> ACTIVO</span>
                    <button onClick={() => setClienteSeleccionado(empresa)} className="text-xs font-bold text-[#233b6b] hover:underline flex items-center gap-1">
                      <Settings className="w-3.5 h-3.5" /> Gestionar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {clienteSeleccionado && <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => {setClienteSeleccionado(null); setCreandoUsuario(false); setLinkMagicoUsuario(null);}}></div>}
    </div>
  );
}