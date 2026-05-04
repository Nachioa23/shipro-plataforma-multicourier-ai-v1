"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import TransportesTab from "@/components/configuracion/TransportesTab";
import { useConfiguracion } from "../ConfiguracionContext";

export default function ConfiguracionTransportesPage() {
  const router = useRouter();
  const { empresaActivaId, esOperadorCliente, rol } = useConfiguracion();

  // operador_cliente no tiene acceso a esta pestaña → redirect a depósitos
  useEffect(() => {
    if (rol && esOperadorCliente) router.replace("/configuracion/depositos");
  }, [rol, esOperadorCliente, router]);

  if (esOperadorCliente) return null;

  return <TransportesTab empresaActivaId={empresaActivaId} />;
}
