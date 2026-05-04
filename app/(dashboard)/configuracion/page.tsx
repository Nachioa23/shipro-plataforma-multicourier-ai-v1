"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConfiguracion } from "./ConfiguracionContext";

export default function ConfiguracionRoot() {
  const router = useRouter();
  const { esOperadorCliente, rol } = useConfiguracion();

  useEffect(() => {
    if (!rol) return; // Esperar a que se hidrate la sesión
    if (esOperadorCliente) {
      router.replace("/configuracion/depositos");
    } else {
      router.replace("/configuracion/transportes");
    }
  }, [rol, esOperadorCliente, router]);

  return null;
}
