/**
 * Normalización de nombres de provincia que vienen de la BD (tabla Provincia)
 * a la lista canónica de PROVINCIAS_AR.
 *
 * Necesario porque el seed parseó `prisma/data/codigos.csv` con variantes en
 * MAYÚSCULAS sin acentos ("BUENOS AIRES", "CORDOBA", "TUCUMAN", etc.) y
 * además dejó 20 entradas basura del parseo (ej: "100 AL 21", "300 (APEADERO FCGB)").
 *
 * Esta función mapea variantes conocidas a la versión canónica con
 * capitalización y acentos correctos. Devuelve null si el input es basura
 * o no matchea ninguna provincia argentina.
 *
 * Política "Consistencia de formularios" (DEUDA 4): el frontend usa
 * dropdowns con `PROVINCIAS_AR`, los valores que llegan del endpoint
 * tienen que coincidir exactamente con esa lista o el `<select>` no los
 * muestra.
 *
 * Limpieza estructural de la BD: ver DEUDA 26.
 */

const ALIAS: Record<string, string> = {
  // Cada clave debe estar en MAYÚSCULAS sin acentos (lo que produce normalizarClave()).
  "BUENOS AIRES": "Buenos Aires",
  "CIUDAD AUTONOMA DE BUENOS AIRES": "CABA",
  "CIUDAD DE BUENOS AIRES": "CABA",
  "CABA": "CABA",
  "CATAMARCA": "Catamarca",
  "CHACO": "Chaco",
  "CHUBUT": "Chubut",
  "CORDOBA": "Córdoba",
  "CORRIENTES": "Corrientes",
  "ENTRE RIOS": "Entre Ríos",
  "FORMOSA": "Formosa",
  "JUJUY": "Jujuy",
  "LA PAMPA": "La Pampa",
  "LA RIOJA": "La Rioja",
  "MENDOZA": "Mendoza",
  "MISIONES": "Misiones",
  "NEUQUEN": "Neuquén",
  "RIO NEGRO": "Río Negro",
  "SALTA": "Salta",
  "SAN JUAN": "San Juan",
  "SAN LUIS": "San Luis",
  "SANTA CRUZ": "Santa Cruz",
  "SANTA FE": "Santa Fe",
  "SANTIAGO DEL ESTERO": "Santiago del Estero",
  "TIERRA DEL FUEGO": "Tierra del Fuego",
  "TUCUMAN": "Tucumán",
};

function normalizarClave(nombre: string): string {
  // NFD descompone "ó" en "o" + combining acute. ̀-ͯ cubre el rango
  // Unicode de "Combining Diacritical Marks" — se quitan, dejando solo letras base.
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

export function normalizarProvincia(nombreBD: string | null | undefined): string | null {
  if (!nombreBD) return null;
  const clave = normalizarClave(nombreBD);
  return ALIAS[clave] ?? null;
}
