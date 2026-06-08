/**
 * Catalogo canonico de modalidades (DEUDA 47 fix + Metrica 3.3).
 *
 * Las 8 modalidades operativas que Shipro reconoce. Decision producto 2026-06-08:
 * - 5 forward (entregas al comprador).
 * - 3 reverse (devoluciones y cambios).
 *
 * El catalogo es la unica fuente de verdad para agrupar/analizar/persistir
 * modalidad en BD. Todos los strings que llegan desde el cotizador, e-commerce,
 * o legacy se normalizan a una de estas 8 categorias antes de persistirse en
 * Envio.modalidad.
 *
 * Si en el futuro el catalogo cambia (nueva modalidad, deprecation), modificar
 * aqui y los consumidores (crear.ts, endpoint metricas, dashboard) se ajustan
 * automaticamente porque dependen del tipo ModalidadCanonica.
 */

// Catalogo cerrado de modalidades canonicas v1 (2026-06-08).
export const MODALIDADES_CANONICAS = [
  // Forward (5).
  "Entrega a Domicilio (Estandar)",
  "Entrega a Domicilio (Same Day)",
  "Retiro en Sucursal (Estandar)",
  "Retiro en Punto de Retiro (Estandar)",
  "Retiro en e-locker (Estandar)",
  // Reverse (3).
  "Devolucion desde Sucursal (Estandar)",
  "Devolucion desde Domicilio (Estandar)",
  "Cambio desde Domicilio (Estandar)",
] as const;

export type ModalidadCanonica = typeof MODALIDADES_CANONICAS[number];

// Valor sentinel para modalidades no reconocidas. Se persiste en BD para no
// perder informacion, pero el dashboard puede mostrarlo separado.
export const MODALIDAD_DESCONOCIDA = "Desconocida" as const;
export type ModalidadCanonicaOrDesconocida = ModalidadCanonica | typeof MODALIDAD_DESCONOCIDA;

// Split forward/reverse para el dashboard de Metrica 3.3.
export function esModalidadForward(modalidad: ModalidadCanonica): boolean {
  return modalidad.startsWith("Entrega") || modalidad.startsWith("Retiro");
}

export function esModalidadReverse(modalidad: ModalidadCanonica): boolean {
  return modalidad.startsWith("Devolucion") || modalidad.startsWith("Cambio");
}

/**
 * Normaliza un string arbitrario a una modalidad canonica.
 *
 * Casos cubiertos:
 * 1. Match directo (case-insensitive con o sin tildes) a una de las 8 canonicas.
 * 2. Match parcial via patrones comunes ("estandar" + "domicilio" → "Entrega a Domicilio (Estandar)").
 * 3. Strings legacy ("Estandar" solo, "Estándar" con tilde, "Devolucion Inversa") → mapeo a categoria default razonable.
 * 4. Cualquier otro → MODALIDAD_DESCONOCIDA.
 *
 * @param input - String crudo (puede ser undefined/null si no llega del e-commerce)
 * @returns ModalidadCanonica si reconocida, "Desconocida" en otro caso
 */
export function normalizarModalidad(input: string | null | undefined): ModalidadCanonicaOrDesconocida {
  if (!input || typeof input !== "string") return MODALIDAD_DESCONOCIDA;

  // Sanitizar: lowercase + sin tildes + colapsar espacios.
  const sanitized = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remueve tildes
    .replace(/\s+/g, " ");

  // 1. Match directo case-insensitive contra catalogo canonico.
  for (const canonica of MODALIDADES_CANONICAS) {
    const canonicaSanitized = canonica
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
    if (sanitized === canonicaSanitized) return canonica;
  }

  // 2. Patrones comunes con palabras clave.
  // 2a. Same Day (con o sin guion, con o sin parentesis).
  if (sanitized.includes("same day") || sanitized.includes("same-day") || sanitized.includes("sameday")) {
    if (sanitized.includes("domicilio")) return "Entrega a Domicilio (Same Day)";
    // Default: Same Day = Entrega a Domicilio (Same Day).
    return "Entrega a Domicilio (Same Day)";
  }

  // 2b. Cambio.
  if (sanitized.includes("cambio")) {
    return "Cambio desde Domicilio (Estandar)";
  }

  // 2c. Devolucion.
  if (sanitized.includes("devolucion")) {
    if (sanitized.includes("sucursal")) return "Devolucion desde Sucursal (Estandar)";
    if (sanitized.includes("domicilio")) return "Devolucion desde Domicilio (Estandar)";
    // Legacy "Devolucion Inversa" o similar → asumimos desde Domicilio.
    return "Devolucion desde Domicilio (Estandar)";
  }

  // 2d. Punto de Retiro.
  if (sanitized.includes("punto de retiro") || sanitized.includes("punto retiro") || sanitized.includes("pickup point")) {
    return "Retiro en Punto de Retiro (Estandar)";
  }

  // 2e. e-locker / locker.
  if (sanitized.includes("e-locker") || sanitized.includes("elocker") || sanitized.includes("locker")) {
    return "Retiro en e-locker (Estandar)";
  }

  // 2f. Retiro en sucursal.
  if (sanitized.includes("sucursal")) {
    return "Retiro en Sucursal (Estandar)";
  }

  // 2g. Entrega a domicilio (estandar implicito).
  if (sanitized.includes("domicilio")) {
    return "Entrega a Domicilio (Estandar)";
  }

  // 3. Legacy: "estandar" solo (los 27 envios viejos en BD).
  // Asumimos Forward + Domicilio como default razonable (el mayoritario).
  if (sanitized === "estandar") {
    return "Entrega a Domicilio (Estandar)";
  }

  // 4. Nada matcheo: MODALIDAD_DESCONOCIDA.
  return MODALIDAD_DESCONOCIDA;
}

/**
 * Resultado de la inferencia de modalidad cuando el e-commerce no manda
 * el campo explicitamente.
 */
export interface ResultadoInferenciaModalidad {
  modalidad: ModalidadCanonicaOrDesconocida;
  fuente: "input_explicito" | "inferida_por_precio" | "inferida_por_courier" | "fallback_default";
  opcionMatcheada: {
    courier: string;
    modalidadOriginal: string;
    precio: number;
  } | null;
}

/**
 * Infiere la modalidad eligida por el comprador dadas las opciones del
 * cotizador y los inputs del e-commerce (nombreCourier + costoEnvio).
 *
 * Estrategia (defensa en capas β+δ):
 * 1. Si modalidadInput esta presente y se normaliza a canonica → usar.
 * 2. Si no, buscar entre opcionesCotizador la que matchea (courier + precio mas cercano) y normalizar su modalidad.
 * 3. Si no hay match perfecto pero hay opciones del mismo courier, tomar la primera y normalizar.
 * 4. Si nada matchea, fallback default.
 *
 * @param opcionesCotizador - Array de OpcionTarifa del cotizador interno (dom + suc combinados)
 * @param nombreCourierInput - Courier que el e-commerce dice que eligio (string libre)
 * @param costoEnvioInput - Precio del envio (numero o string)
 * @param modalidadInput - Modalidad explicita si vino del e-commerce (raro hoy)
 * @returns ResultadoInferenciaModalidad con la mejor estimacion
 */
export function inferirModalidad(
  opcionesCotizador: Array<{ courier: string; modalidad: string; precioFinal: number }>,
  nombreCourierInput: string | null | undefined,
  costoEnvioInput: number | string | null | undefined,
  modalidadInput: string | null | undefined
): ResultadoInferenciaModalidad {
  // Capa 1: input explicito normalizable.
  if (modalidadInput) {
    const normalizada = normalizarModalidad(modalidadInput);
    if (normalizada !== MODALIDAD_DESCONOCIDA) {
      return {
        modalidad: normalizada,
        fuente: "input_explicito",
        opcionMatcheada: null,
      };
    }
  }

  // Capa 2: inferencia por (courier + precio).
  const courierLower = (nombreCourierInput || "").toLowerCase();
  const precioNumerico = typeof costoEnvioInput === "string" ? parseFloat(costoEnvioInput) : (costoEnvioInput ?? 0);

  if (courierLower && opcionesCotizador.length > 0 && precioNumerico > 0) {
    // Filtrar opciones del mismo courier.
    const opcionesMismoCourier = opcionesCotizador.filter(
      op => op.courier.toLowerCase() === courierLower
    );

    if (opcionesMismoCourier.length > 0) {
      // Tomar la opcion del courier con precio mas cercano al input.
      let mejorMatch = opcionesMismoCourier[0];
      let mejorDelta = Math.abs(mejorMatch.precioFinal - precioNumerico);

      for (const op of opcionesMismoCourier) {
        const delta = Math.abs(op.precioFinal - precioNumerico);
        if (delta < mejorDelta) {
          mejorMatch = op;
          mejorDelta = delta;
        }
      }

      const normalizada = normalizarModalidad(mejorMatch.modalidad);
      return {
        modalidad: normalizada,
        fuente: "inferida_por_precio",
        opcionMatcheada: {
          courier: mejorMatch.courier,
          modalidadOriginal: mejorMatch.modalidad,
          precio: mejorMatch.precioFinal,
        },
      };
    }
  }

  // Capa 3: si hay opciones del mismo courier pero sin precio, tomar la primera.
  if (courierLower && opcionesCotizador.length > 0) {
    const opcionesMismoCourier = opcionesCotizador.filter(
      op => op.courier.toLowerCase() === courierLower
    );
    if (opcionesMismoCourier.length > 0) {
      const primera = opcionesMismoCourier[0];
      return {
        modalidad: normalizarModalidad(primera.modalidad),
        fuente: "inferida_por_courier",
        opcionMatcheada: {
          courier: primera.courier,
          modalidadOriginal: primera.modalidad,
          precio: primera.precioFinal,
        },
      };
    }
  }

  // Capa 4: fallback default razonable.
  return {
    modalidad: "Entrega a Domicilio (Estandar)",
    fuente: "fallback_default",
    opcionMatcheada: null,
  };
}
