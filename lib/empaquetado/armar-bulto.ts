// =============================================================================
// APROXIMACIÓN temporal de empaquetado (un bulto apilado).
// Embrión de DEUDA 143 (motor de bin-packing real). Dueño conceptual: Núcleo (Chat A).
// Cuando se implemente la 143, este helper se reemplaza acá, en un solo lugar.
// =============================================================================
// Convierte N productos de un carrito/pedido en UN bulto cotizable, modelando
// los productos como apilados. Neutral respecto al e-commerce: cada integración
// (Tiendanube, WooCommerce, etc.) normaliza sus items al tipo ItemParaEmpaquetar
// y consume armarBultoApilado(). Así la regla vive en UN solo lugar.
//
// Regla (decisión de negocio, Nacho): peso = suma de todos los items;
// depth (profundidad) = suma (dimensión de apilado); width/height = máximo entre items.

export interface ItemParaEmpaquetar {
  grams: number;       // peso unitario en gramos
  quantity: number;    // cantidad de este item
  width: number;       // cm
  height: number;      // cm
  depth: number;       // cm
}

export interface BultoCotizable {
  pesoKg: number;
  largoCm: number;   // = depth apilado
  anchoCm: number;   // = width máx
  altoCm: number;    // = height máx
}

// Defaults cuando faltan datos — MISMOS que usan hoy rates y /generate, para no
// cambiar comportamiento en el caso sin-datos:
const PESO_DEFAULT_KG = 1;
const DIM_DEFAULT_CM = 10;

export function armarBultoApilado(items: ItemParaEmpaquetar[]): BultoCotizable {
  // Filtrar items válidos (con quantity > 0).
  const validos = Array.isArray(items) ? items.filter(it => Number(it?.quantity) > 0) : [];

  if (validos.length === 0) {
    // Sin items → bulto default (mismo fallback actual).
    return { pesoKg: PESO_DEFAULT_KG, largoCm: DIM_DEFAULT_CM, anchoCm: DIM_DEFAULT_CM, altoCm: DIM_DEFAULT_CM };
  }

  // Peso: suma de (grams × quantity) → kg. Si total 0 → default.
  const gramsTotal = validos.reduce((acc, it) => acc + (Number(it.grams) || 0) * (Number(it.quantity) || 1), 0);
  const pesoKg = gramsTotal > 0 ? gramsTotal / 1000 : PESO_DEFAULT_KG;

  // Depth: suma ponderada por cantidad (dimensión de apilado). Si algún depth falta, cuenta 0.
  const depthTotal = validos.reduce((acc, it) => acc + (Number(it.depth) || 0) * (Number(it.quantity) || 1), 0);

  // Width/Height: máximo entre items (0 si faltan todos).
  const widthMax = Math.max(0, ...validos.map(it => Number(it.width) || 0));
  const heightMax = Math.max(0, ...validos.map(it => Number(it.height) || 0));

  // Si alguna dimensión quedó en 0 (data faltante), cae al default de esa dimensión —
  // preserva el comportamiento actual (no inventa medidas, no manda 0 al courier).
  return {
    pesoKg,
    largoCm: depthTotal > 0 ? depthTotal : DIM_DEFAULT_CM,
    anchoCm: widthMax > 0 ? widthMax : DIM_DEFAULT_CM,
    altoCm: heightMax > 0 ? heightMax : DIM_DEFAULT_CM,
  };
}
