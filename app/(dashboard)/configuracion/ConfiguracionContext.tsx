"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface ConfiguracionContextValue {
  empresaActivaId: number | null;
  setEmpresaActivaId: (id: number | null) => void;
  empresasLista: any[];
  esEquipoShipro: boolean;
  esAdminShipro: boolean;
  esGerenteCliente: boolean;
  esOperadorCliente: boolean;
  esOperadorShipro: boolean;
  rol: string;
}

const Ctx = createContext<ConfiguracionContextValue | null>(null);

export function ConfiguracionProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const rol = session?.user?.rol || "";
  const esAdminShipro = rol === 'admin_shipro';
  const esOperadorShipro = rol === 'operador_shipro';
  const esEquipoShipro = esAdminShipro || esOperadorShipro;
  const esGerenteCliente = rol === 'gerente_cliente';
  const esOperadorCliente = rol === 'operador_cliente';

  const [empresaActivaId, setEmpresaActivaId] = useState<number | null>(session?.user?.empresaId ?? null);
  const [empresasLista, setEmpresasLista] = useState<any[]>([]);

  // Cargar lista de empresas para Modo Dios
  useEffect(() => {
    if (esEquipoShipro) {
      fetch('/api/admin/empresas').then(res => res.json()).then(data => {
        if (Array.isArray(data)) {
          setEmpresasLista(data);
          if (empresaActivaId === null && data.length > 0) {
            setEmpresaActivaId(data[0].id);
          }
        }
      });
    }
  }, [esEquipoShipro]);

  // Sincronizar empresaActivaId cuando llega session (cliente)
  useEffect(() => {
    if (!esEquipoShipro && session?.user?.empresaId !== undefined && session.user.empresaId !== null) {
      setEmpresaActivaId(session.user.empresaId);
    }
  }, [session, esEquipoShipro]);

  return (
    <Ctx.Provider value={{
      empresaActivaId, setEmpresaActivaId, empresasLista,
      esEquipoShipro, esAdminShipro, esGerenteCliente, esOperadorCliente, esOperadorShipro,
      rol
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConfiguracion(): ConfiguracionContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfiguracion debe usarse dentro de ConfiguracionProvider");
  return ctx;
}
