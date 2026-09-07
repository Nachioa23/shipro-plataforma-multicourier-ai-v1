// Mapeo nombre canónico de provincia (PROVINCIAS_AR) → código ISO 3166-2:AR de 1 letra.
// Específico de Correo Argentino (Paq.ar exige el `state` como código de 1 letra).
// Andreani y los demás couriers usan el nombre directo. Si un 2do courier lo necesita,
// se promueve a lib/constants/codigos-provincia-ar.ts (acuerdo con Chat A / Núcleo).
// Claves = nombres EXACTOS de lib/constants/provincias-ar.ts (así matchea params.provincia
// que llega resuelto por crear.ts).

const NOMBRE_A_CODIGO: Record<string, string> = {
  "Buenos Aires": "B",
  "CABA": "C",
  "Catamarca": "K",
  "Chaco": "H",
  "Chubut": "U",
  "Córdoba": "X",
  "Corrientes": "W",
  "Entre Ríos": "E",
  "Formosa": "P",
  "Jujuy": "Y",
  "La Pampa": "L",
  "La Rioja": "F",
  "Mendoza": "M",
  "Misiones": "N",
  "Neuquén": "Q",
  "Río Negro": "R",
  "Salta": "A",
  "San Juan": "J",
  "San Luis": "D",
  "Santa Cruz": "Z",
  "Santa Fe": "S",
  "Santiago del Estero": "G",
  "Tierra del Fuego": "V",
  "Tucumán": "T",
};

// Sin match → "". NO inventar código: un state="" hace que Correo rechace el despacho
// con error claro (mejor que un código equivocado → etiqueta a provincia incorrecta).
// El envío degrada a BLOQUEADO/RETENIDO, que es la política vigente para datos faltantes.
export function provinciaACodigoCorreo(nombreProvincia: string | undefined | null): string {
  if (!nombreProvincia) return "";
  return NOMBRE_A_CODIGO[nombreProvincia.trim()] ?? "";
}
