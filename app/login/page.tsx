"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, ArrowRight, ShieldCheck, Zap, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';

export default function Login() {
  const brandColor = '#233b6b';
  const router = useRouter();
  
  // Estados para controlar el formulario real
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // La función que conecta con la Base de Datos
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      redirect: false,
      email: email,
      password: password,
    });

    if (res?.error) {
      // Menor 7 (2026-06-03): NextAuth v4 con signIn redirect:false propaga
      // el message del Error tirado en authorize() a res.error. Mapeamos
      // codigos enumerables (lib/auth.ts) a mensajes user-facing.
      // Fallback: cualquier error desconocido cae al mensaje generico (incluye
      // password mismatch, usuario no encontrado, y cualquier otra falla).
      const ERROR_MESSAGES: Record<string, string> = {
        EMPRESA_INACTIVA: "Tu empresa esta deshabilitada. Contactanos a soporte.",
        USUARIO_INACTIVO: "Tu usuario esta deshabilitado. Contactate con el gerente de tu cuenta.",
      };
      setError(ERROR_MESSAGES[res.error] ?? "Email o contraseña incorrectos. Revisá tus datos.");
      setLoading(false);
    } else {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen flex bg-white font-sans">
      
      {/* ================= MITAD IZQUIERDA: BRANDING ================= */}
      <div 
        className="hidden lg:flex w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundColor: brandColor }}
      >
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-10 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white blur-3xl"></div>
          <div className="absolute bottom-12 -right-12 w-80 h-80 rounded-full bg-blue-400 blur-3xl"></div>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">
            SHIPRO<span className="text-blue-400">.</span>
          </h1>
        </div>

        <div className="relative z-10 max-w-lg mt-12">
          <h2 className="text-4xl font-black text-white leading-tight mb-6">
            La evolución operativa de tu E-commerce.
          </h2>
          <p className="text-blue-100 text-lg font-medium mb-12 leading-relaxed">
            Centralizá todos tus couriers, automatizá tus reglas de envío y eliminá los reclamos por demoras en una sola plataforma.
          </p>

          <div className="space-y-6">
            <div className="flex items-center gap-4 text-white">
              <div className="p-2 bg-white/10 rounded-lg"><Zap className="w-5 h-5 text-blue-300" /></div>
              <p className="font-medium">Cotización multi-courier en tiempo real.</p>
            </div>
            <div className="flex items-center gap-4 text-white">
              <div className="p-2 bg-white/10 rounded-lg"><ShieldCheck className="w-5 h-5 text-blue-300" /></div>
              <p className="font-medium">Motor de inteligencia para evitar errores de despacho.</p>
            </div>
            <div className="flex items-center gap-4 text-white">
              <div className="p-2 bg-white/10 rounded-lg"><TrendingUp className="w-5 h-5 text-blue-300" /></div>
              <p className="font-medium">Métricas de cumplimiento de SLA precisas.</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-4 text-sm text-blue-200 font-medium mt-auto">
          <span>© 2026 Shipro</span>
          <span>•</span>
          <a href="#" className="hover:text-white transition-colors">Soporte Técnico</a>
        </div>
      </div>

      {/* ================= MITAD DERECHA: FORMULARIO DE ACCESO ================= */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 sm:px-16 md:px-24 bg-gray-50 lg:bg-white relative">
        
        <div className="lg:hidden absolute top-8 left-8">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: brandColor }}>
            SHIPRO<span className="text-blue-600">.</span>
          </h1>
        </div>

        <div className="max-w-md w-full mx-auto mt-16 lg:mt-0">
          <div className="text-center lg:text-left mb-10">
            <h2 className="text-3xl font-black text-gray-800 tracking-tight mb-2">Iniciar Sesión</h2>
            <p className="text-gray-500 font-medium text-sm">Ingresá tus credenciales para acceder a tu panel de control logístico.</p>
          </div>

          {/* Botón de Google (Mantenido visualmente por ahora) */}
          <button 
            type="button"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border-2 border-gray-200 rounded-xl text-gray-700 font-bold hover:bg-gray-50 transition-colors mb-6 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar con Google
          </button>

          <div className="relative flex items-center py-5">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-bold uppercase tracking-wider">O usá tu email</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          {/* Formulario que SÍ conecta a la base de datos */}
          <form onSubmit={handleLogin} className="space-y-5">
            
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold flex items-center gap-2 border border-red-100 animate-in fade-in">
                <AlertCircle className="w-5 h-5" /> {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Correo Electrónico</label>
              <div className="relative">
                <Mail className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow bg-white" 
                  placeholder="ejemplo@empresa.com"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">Contraseña</label>
                <a href="#" className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">¿La olvidaste?</a>
              </div>
              <div className="relative">
                <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow bg-white" 
                  placeholder="••••••••••••"
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-all text-sm mt-8 group disabled:opacity-70 disabled:cursor-not-allowed" 
              style={{ backgroundColor: brandColor }}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</>
              ) : (
                <>Ingresar a la plataforma <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm font-medium text-gray-500 mt-8">
            ¿Tu E-commerce todavía no usa Shipro? <a href="#" className="font-bold text-blue-600 hover:underline">Solicitar una demo</a>
          </p>
        </div>
      </div>

    </div>
  );
}