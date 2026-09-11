// ============================================================================
// URLs del plugin WooCommerce — DEUDA 150 Pieza 3 (mandar plugin verb).
//
// El verbo "mandar plugin" del hub de conexiones dispara un mail al cliente
// con dos links: (1) el .zip del release del plugin (anclado a una versión
// fija — nunca `latest`; bumpear versión = update explícito acá), y (2) la
// guía de instalación (por ahora sin URL definitiva — placeholder completable
// via env var). El mail degrada con gracia si la guía todavía no está lista.
//
// REPRODUCIBILIDAD: el .zip apunta a una release específica (v0.1.0). Si se
// publica v0.2.0, este archivo debe modificarse en el mismo PR que ese bump
// (chequeo humano deliberado por versión).
//
// GUÍA COMPLETABLE: `GUIA_PLUGIN_WOOCOMMERCE_URL` sale de la env var
// `GUIA_PLUGIN_WOOCOMMERCE_URL` (Chat C está coordinando el hosting del PDF).
// Si está vacío/undefined, el mail se envía igual con el .zip + una nota de
// que la guía viaja por separado. NO se bloquea el envío por no tener guía.
// ============================================================================

export const ZIP_PLUGIN_WOOCOMMERCE_URL =
  "https://github.com/Nachioa23/shipro-woocommerce/releases/download/v0.1.0/shipro-woocommerce-0.1.0.zip";

export const GUIA_PLUGIN_WOOCOMMERCE_URL = process.env.GUIA_PLUGIN_WOOCOMMERCE_URL ?? "";
