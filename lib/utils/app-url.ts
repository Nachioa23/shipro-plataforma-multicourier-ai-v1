// =============================================================================
// DEUDA 14 (QW#4 Fase BLOQUE 1, 2026-06-02): helpers de APP_URL.
// =============================================================================
// Hoy 7 archivos tienen process.env.APP_URL || "http://localhost:3000" como
// fallback. Eso causa que si APP_URL no esta configurada en produccion, el
// sistema manda mails con links rotos (apuntando a localhost:3000) sin
// avisar — peor UX que no mandarlos.
//
// Solucion: 2 helpers bifurcados segun contexto.
//
// - getAppUrlOrThrow(): para crons y endpoints donde queremos fail-fast.
//   Si APP_URL falta, el sistema tira error y el deploy se ve roto inmediato.
//
// - getAppUrl(): para mails en runtime de envios (donde "que la venta no se
//   pierda"). Si APP_URL falta, retorna null + warn en consola, el caller
//   skipea el mail. El envio se crea igual, solo el mail no se manda.
// =============================================================================

// Para crons y endpoints: fail-fast.
// Usar cuando es OK que el sistema rompa si APP_URL no esta configurada,
// porque el contexto operativo (cron, endpoint admin) lo permite.
export function getAppUrlOrThrow(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error(
      "APP_URL no esta configurada. Setear la variable de entorno antes de operar este endpoint o cron."
    );
  }
  return url;
}

// Para mails en runtime de envios: best-effort.
// Si APP_URL falta, retorna null. El caller debe chequear y decidir skipear
// el mail con console.warn. NUNCA debe romper el flujo principal (creacion
// de envio) por falta de configuracion de mail.
// Principio operativo: "que la venta no se pierda" — un mail no enviado es
// preferible a un mail con link roto que confunde al destinatario.
export function getAppUrl(): string | null {
  const url = process.env.APP_URL;
  if (!url) {
    console.warn(
      "[APP_URL] No esta configurada. Mails no se enviaran para mantener la operacion. Configurar variable APP_URL en .env."
    );
    return null;
  }
  return url;
}
