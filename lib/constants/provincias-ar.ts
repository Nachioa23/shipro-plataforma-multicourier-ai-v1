/**
 * Lista oficial de las 24 provincias argentinas.
 * Fuente única de verdad para dropdowns de provincia en formularios.
 *
 * Política "Consistencia de formularios" (DEUDA 4): listas cerradas
 * deben ser dropdowns, no texto libre — evita datos sucios como
 * "BS AS", "Bs. As.", "bsas", etc. que rompen integraciones con couriers.
 */
export const PROVINCIAS_AR = [
  "Buenos Aires",
  "CABA",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const;
