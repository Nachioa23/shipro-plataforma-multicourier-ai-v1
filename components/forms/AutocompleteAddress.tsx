"use client";

import { useEffect, useRef, useState } from "react";
import { Search, AlertTriangle } from "lucide-react";

declare global {
  interface Window {
    google: any;
  }
}

const SCRIPT_ID = "google-maps-script";
const TIMEOUT_MS = 5000;

export interface AddressData {
  calle: string;
  altura: string;
  cp: string;
  localidad: string;
  provincia: string;
}

interface Props {
  onPlaceChanged: (data: AddressData) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Input con autocompletado de Google Maps Places, restringido a Argentina.
 *
 * Encapsula:
 * - Carga idempotente del script de Google Maps (no duplica si ya está cargado).
 * - Listener de `place_changed` que parsea address_components.
 * - Degradación elegante: si no hay API key, el script falla, o tarda > 5s,
 *   se renderiza un input texto plano + aviso amber. El usuario puede tipear
 *   manualmente. El callback `onPlaceChanged` no se dispara en este modo
 *   (el padre debe usar inputs separados de calle/altura/CP/etc).
 *
 * No mantiene state propio del valor — solo invoca onPlaceChanged cuando
 * el usuario selecciona una dirección del dropdown de Google.
 */
export default function AutocompleteAddress({ onPlaceChanged, placeholder, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceRef = useRef<any>(null);
  const [apiFalla, setApiFalla] = useState(false);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setApiFalla(true);
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const initAutocomplete = () => {
      if (cancelado) return;
      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (!inputRef.current || !window.google) return;
      if (instanceRef.current) return;

      try {
        instanceRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "ar" },
          fields: ["address_components", "geometry", "name"],
          types: ["address"],
        });

        instanceRef.current.addListener("place_changed", () => {
          const place = instanceRef.current.getPlace();
          if (!place || !place.address_components) return;

          let calle = "";
          let altura = "";
          let cp = "";
          let localidad = "";
          let provincia = "";

          for (const component of place.address_components) {
            const componentType = component.types[0];
            switch (componentType) {
              case "route": calle = component.short_name; break;
              case "street_number": altura = component.long_name; break;
              case "postal_code": cp = component.long_name.replace(/\D/g, ''); break;
              case "locality":
              case "sublocality_level_1": localidad = component.long_name; break;
              case "administrative_area_level_1": provincia = component.long_name; break;
            }
          }

          onPlaceChanged({ calle, altura, cp, localidad, provincia });
        });
      } catch (e) {
        console.error("[AutocompleteAddress] Error inicializando Google Places:", e);
        setApiFalla(true);
      }
    };

    const onScriptError = () => {
      console.warn("[AutocompleteAddress] Falló la carga de Google Maps API");
      setApiFalla(true);
    };

    // Si Google ya está disponible
    if (window.google) {
      initAutocomplete();
      return () => { cancelado = true; };
    }

    // Si el script ya se inyectó (otra parte de la app)
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', initAutocomplete);
      existing.addEventListener('error', onScriptError);
      timeoutHandle = setTimeout(() => {
        if (!instanceRef.current && !cancelado) setApiFalla(true);
      }, TIMEOUT_MS);
      return () => {
        cancelado = true;
        existing.removeEventListener('load', initAutocomplete);
        existing.removeEventListener('error', onScriptError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };
    }

    // Inyectar el script con id único (idempotente para futuras instancias)
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = initAutocomplete;
    script.onerror = onScriptError;
    document.head.appendChild(script);

    timeoutHandle = setTimeout(() => {
      if (!instanceRef.current && !cancelado) setApiFalla(true);
    }, TIMEOUT_MS);

    return () => {
      cancelado = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [onPlaceChanged]);

  // Bloquear submit del form al apretar Enter dentro del input de búsqueda
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  if (apiFalla) {
    return (
      <div className="space-y-2">
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs font-bold text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>La API de Google Maps está fuera de servicio. Completá los campos de dirección manualmente.</span>
        </div>
        <div className="relative flex items-center bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
          <div className="pl-4 pr-2 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-amber-500" />
          </div>
          <input
            type="text"
            disabled
            placeholder="Buscador no disponible"
            className="w-full py-3.5 pr-4 bg-transparent text-sm font-medium text-amber-600 outline-none cursor-not-allowed"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-center bg-blue-50/50 border-2 border-blue-200 rounded-xl overflow-hidden focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
      <div className="pl-4 pr-2 flex items-center pointer-events-none">
        <Search className="w-5 h-5 text-blue-500" />
      </div>
      <input
        ref={inputRef}
        type="text"
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder ?? "Empezá a escribir la dirección acá..."}
        className="w-full py-3.5 pr-4 bg-transparent text-sm font-bold text-gray-800 outline-none placeholder:text-blue-300"
      />
    </div>
  );
}
