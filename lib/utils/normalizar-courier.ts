// Normaliza un nombre de courier para matching case+diacritic-insensitive
// contra los canónicos del registry (lib/couriers/CourierFactory.ts:24).
//
// El registry usa canónicos ASCII plain ('hopenvios', 'correoargentino') mientras
// que los display names en BD pueden traer acentos (`"Hop Envíos"`) o apóstrofes
// (`"Moci's"`) o espacios (`"Correo Argentino"`). Sin strip de acentos, "Hop Envíos"
// normaliza a "hopenvíos" (con `í`) y NUNCA matchea con el canónico "hopenvios" —
// esto es el bug que llevaba a Hop a aparecer duplicado en /admin-couriers y a
// que POST /api/admin/couriers rompiera al recrear (colisión Courier.nombre @unique,
// error P2002 opaco).
//
// Pipeline: lowercase → NFD (descompone acentos: `í` → `i` + `́`) → strip diacríticos
// del rango U+0300-U+036F (combining marks) → strip apóstrofes + whitespace.
// El orden importa: NFD antes de strip de acentos, y todo antes del strip final.
export function normalizarNombreCourier(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['\s]/g, "");
}
