"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RuteoTab from "@/components/configuracion/RuteoTab";
import { useConfiguracion } from "../ConfiguracionContext";

export default function ConfiguracionRuteoPage() {
  const router = useRouter();
  const { empresaActivaId, esOperadorCliente, rol } = useConfiguracion();

  useEffect(() => {
    if (rol && esOperadorCliente) router.replace("/configuracion/depositos");
  }, [rol, esOperadorCliente, router]);

  if (esOperadorCliente) return null;

  return <RuteoTab empresaActivaId={empresaActivaId} />;
}
