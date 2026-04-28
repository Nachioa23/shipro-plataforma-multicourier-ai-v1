import { NextResponse } from "next/server";

// ==========================================
// EL CEREBRO DEL PEAJE (Diccionario Oficial)
// ==========================================
const POSTAL_LOOKUP: Record<string, { provincia: string; localidades: string[] }> = {
  "1614": { provincia: "Buenos Aires", localidades: ["Los Polvorines", "Villa de Mayo", "Ingeniero Adolfo Sourdeaux"] },
  "5000": { provincia: "Córdoba", localidades: ["Córdoba Capital"] },
  "7600": { provincia: "Buenos Aires", localidades: ["Mar del Plata", "Batán"] },
  // HARDCODED: CP de origen del depósito.
  // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
  // Ver DEUDAS.md
  "1050": { provincia: "CABA", localidades: ["CABA (San Nicolas)"] }
};

export async function POST(request: Request) {
  try {
    const ordenCruda = await request.json();
    const { id_orden, comprador, direccion } = ordenCruda;

    // Arrancamos con un puntaje perfecto
    let score = 100;
    let problemas: string[] = [];

    // ==========================================
    // REGLA 1: Existencia del Código Postal (Penalidad Máxima)
    // ==========================================
    const datosOficiales = POSTAL_LOOKUP[direccion.cp];
    if (!datosOficiales) {
      score -= 60; // Freno total
      problemas.push("El Código Postal no existe o no tiene cobertura.");
    } else {
      // ==========================================
      // REGLA 2: Consistencia Provincia vs CP
      // ==========================================
      if (direccion.provincia.toLowerCase() !== datosOficiales.provincia.toLowerCase()) {
        score -= 40;
        problemas.push(`Inconsistencia: El CP ${direccion.cp} pertenece a ${datosOficiales.provincia}, pero ingresó ${direccion.provincia}.`);
      }

      // ==========================================
      // REGLA 3: Consistencia Localidad vs CP
      // ==========================================
      const localidadValida = datosOficiales.localidades.some(loc => 
        loc.toLowerCase().includes(direccion.localidad.toLowerCase()) || 
        direccion.localidad.toLowerCase().includes(loc.toLowerCase())
      );
      
      if (!localidadValida) {
        score -= 30;
        problemas.push(`El CP ${direccion.cp} no corresponde a la localidad de ${direccion.localidad}.`);
      }
    }

    // ==========================================
    // REGLA 4: Altura Numérica en la Calle
    // ==========================================
    // Expresión regular que busca si hay al menos un número en el texto de la calle
    const tieneNumeros = /\d/.test(direccion.calle);
    if (!tieneNumeros) {
      score -= 30;
      problemas.push("La dirección no contiene altura numérica (ej: 123).");
    }

    // ==========================================
    // LA DECISIÓN DEL PEAJE
    // ==========================================
    
    // CASO A: Aprobado (Luz Verde)
    if (score >= 80) {
      return NextResponse.json({
        accion: "APROBADO_GENERAR_ETIQUETA",
        orden_id: id_orden,
        scoreCalidad: score,
        mensaje: "Dirección validada con éxito. Enviando al Courier."
      });
    }

    // CASO B: Frenado (Luz Roja) - Requiere intervención
    else {
      // Acá en la vida real, generaríamos el "Magic Link" y se lo mandaríamos por mail con Resend/SendGrid
      const magicLink = `https://shipro.pro/fix/${id_orden}`;
      
      return NextResponse.json({
        accion: "FRENADO_EN_STANDBY",
        orden_id: id_orden,
        scoreCalidad: score,
        problemasDetectados: problemas,
        accionesAutomaticas: [
          "Envío de email al comprador con Magic Link",
          "Orden derivada al Bloque 2 (Auditoría de Checkouts)"
        ],
        magicLinkGenerado: magicLink
      });
    }

  } catch (error) {
    console.error("Error en el Peaje:", error);
    return NextResponse.json({ error: "Error al procesar la validación" }, { status: 500 });
  }
}