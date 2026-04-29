import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { enviarMailCreacion } from "@/lib/mailer";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { cotizar } from "@/lib/cotizador";

export interface CrearEnvioInput {
  empresaId: number;
  destinatarioNombre: string;
  cpDestino: string | number;
  pesoReal: number | string;
  nombreCourier: string;
  calle?: string;
  altura?: string;
  piso?: string;
  dpto?: string;
  dni?: string;
  email?: string;
  telefono?: string;
  localidad?: string;
  modalidad?: string;
  valorDeclarado?: number | string;
  costoEnvio?: number | string;
  costoProveedor?: number | string;
  provinciaDestino?: string;
  numeroOrden?: string | null;
}

export async function crearEnvio(input: CrearEnvioInput) {
  // Política de negocio: crear envío requiere una empresa específica.
  // Modo Dios "TODAS" no aplica acá. Defensivo runtime check (TS ya garantiza
  // empresaId: number, pero si en el futuro se cambia el tipo este guard atrapa).
  if (input.empresaId === null || input.empresaId === undefined) {
    throw new Error('EmpresaRequerida: crear envío requiere una empresa específica. Modo Dios sin filtro no aplica acá.');
  }

  const {
    empresaId, destinatarioNombre, cpDestino, pesoReal, nombreCourier,
    calle, altura, piso, dpto, dni, email, telefono, localidad, modalidad,
    valorDeclarado, costoEnvio, costoProveedor, provinciaDestino, numeroOrden
  } = input;

  let trackingOficial = "SHP-" + Math.floor(Math.random() * 900000 + 100000);
  let trackingFirstMile: string | null = null;
  let urlEtiquetaFinal: string | null = null;
  let estadoInicialEnvio = "Pendiente";
  let falloPorPeaje = false;
  let motivoRetencion = "";

  // =========================================================
  // DICCIONARIO INTELIGENTE DE COURIERS (Anti-Duplicados)
  // =========================================================
  const textoIngresado = nombreCourier.toLowerCase().replace(/['\s]/g, '');
  let nombreOficial = nombreCourier;

  if (textoIngresado.includes('andreani')) nombreOficial = "Andreani";
  else if (textoIngresado.includes('mocis') || textoIngresado.includes('moci')) nombreOficial = "Mocis";

  let courierReal = await prisma.courier.findFirst({
    where: { nombre: nombreOficial }
  });

  if (!courierReal) {
    courierReal = await prisma.courier.create({ data: { nombre: nombreOficial, activo: true } });
  }
  const courierIdReal = courierReal.id;
  const courierNombreLimpio = nombreOficial.toLowerCase().replace(/['\s]/g, '');

  // DIRECTORIO Y ABM: Actualizar o crear contacto
  const direccionExistente = await prisma.direccion.findFirst({ where: { email: email } });
  let direccionId: number;
  if (direccionExistente) {
    const dirActualizada = await prisma.direccion.update({
      where: { id: direccionExistente.id },
      data: { nombre: destinatarioNombre, documento: dni, telefono: telefono, calle: calle, altura: altura, piso: piso, dpto: dpto, cp: String(cpDestino), localidad: localidad, provincia: provinciaDestino }
    });
    direccionId = dirActualizada.id;
  } else {
    const nuevaDir = await prisma.direccion.create({
      data: { nombre: destinatarioNombre, documento: dni, email: email, telefono: telefono, calle: calle, altura: altura, piso: piso, dpto: dpto, cp: String(cpDestino), localidad: localidad, provincia: provinciaDestino, pais: "Argentina" }
    });
    direccionId = nuevaDir.id;
  }

  const nombreDeposito = `Depósito Central - Empresa ${empresaId}`;
  let direccionOrigen = await prisma.direccion.findFirst({ where: { nombre: nombreDeposito } });
  if (!direccionOrigen) {
    direccionOrigen = await prisma.direccion.create({
      data: { nombre: nombreDeposito, calle: "Av. Libertador", altura: "1234", localidad: "CABA", cp: "1000", provincia: "CABA", pais: "Argentina" }
    });
  }

  // ==============================================================
  // REGLA DEL PEAJE (Google Maps)
  // ==============================================================
  const calleLower = calle?.toLowerCase() || "";
  const alturaStr = altura?.toString().trim() || "";

  const keywordsTolerancia = ["lote", "ruta", "km", "barrio", "manzana", "country", "s/n", "sin numero", "parcela"];
  const tienePalabraClave = keywordsTolerancia.some(kw => calleLower.includes(kw));

  if (!calle || calle.trim() === "") {
    estadoInicialEnvio = "RETENIDO";
    falloPorPeaje = true;
    motivoRetencion = "El nombre de la calle está vacío.";
  } else if (!alturaStr && !tienePalabraClave) {
    estadoInicialEnvio = "RETENIDO";
    falloPorPeaje = true;
    motivoRetencion = "Falta altura y no posee palabras clave de excepción.";
  }

  if (!falloPorPeaje) {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      try {
        const direccionQuery = `${calle} ${alturaStr}, ${localidad}, ${provinciaDestino}, Argentina`;
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccionQuery)}&key=${apiKey}`);
        const geoData = await geoRes.json();

        if (geoData.status === "ZERO_RESULTS") {
          estadoInicialEnvio = "RETENIDO";
          falloPorPeaje = true;
          motivoRetencion = "Google Maps no pudo ubicar esta dirección en el mapa.";
        } else if (geoData.status === "OK" && geoData.results.length > 0) {
          const primerResultado = geoData.results[0];

          const isStreetLevel = primerResultado.types.includes("street_address") ||
                                primerResultado.types.includes("route") ||
                                primerResultado.types.includes("premise") ||
                                primerResultado.types.includes("intersection");

          if (!isStreetLevel && !tienePalabraClave) {
            estadoInicialEnvio = "RETENIDO";
            falloPorPeaje = true;
            motivoRetencion = `La calle no parece ser válida. Google solo encontró la zona o localidad.`;
          } else {
            let cpGoogle = "";
            for (const comp of primerResultado.address_components) {
              if (comp.types.includes("postal_code")) {
                cpGoogle = comp.long_name.replace(/\D/g, '');
              }
            }

            const cpUserLimpio = String(cpDestino).replace(/\D/g, '');
            if (cpGoogle && cpUserLimpio && cpGoogle.substring(0, 2) !== cpUserLimpio.substring(0, 2)) {
              estadoInicialEnvio = "RETENIDO";
              falloPorPeaje = true;
              motivoRetencion = `Discrepancia geográfica: El CP ingresado difiere de la zona real.`;
            }
          }
        }
      } catch (geoErr) {
        console.warn("Error en Geocoding API.");
      }
    }
  }

  // DESPACHO AL COURIER (Solo si NO falló el peaje)
  if (!falloPorPeaje) {
    try {
      // courierReal.nombre es la capitalización canónica de BD (ya validada arriba
      // en el findFirst). NO usar courierNombreLimpio (lowercase) porque
      // CredencialCourier.nombreCourier en BD está capitalizado y findUnique
      // requiere match exacto. Ver DEUDA 11.
      const credencialMain = await prisma.credencialCourier.findUnique({
        where: { empresaId_nombreCourier: { empresaId, nombreCourier: courierReal.nombre } }
      });

      if (credencialMain && credencialMain.activo) {
        // Si el cliente usa credenciales propias y son inválidas/incompletas,
        // parsearCredencialesPropias lanza un error que el catch outer absorbe.
        // NO hay fallback automático a Shipro (política de protección financiera):
        // el envío queda con tracking genérico SHP-xxxx hasta que el cliente
        // arregle sus credenciales en /mis-transportes.
        const llavesMain = credencialMain.usaCredencialesPropias
          ? parsearCredencialesPropias(courierNombreLimpio, credencialMain.credencialesJson)
          : obtenerCredencialesShipro(courierNombreLimpio);

        const motorMain = CourierFactory.crear(courierNombreLimpio, llavesMain);

        let tipoEntregaFormateado: "sucursal" | "domicilio" | "inversa" | "cambio" = "domicilio";
        const mod = modalidad?.toLowerCase() || "";
        if (mod.includes('sucursal')) tipoEntregaFormateado = "sucursal";
        if (mod.includes('inversa') || mod.includes('devolucion')) tipoEntregaFormateado = "inversa";
        if (mod.includes('cambio')) tipoEntregaFormateado = "cambio";

        // Si llegamos acá, el peaje no falló → calle/altura/localidad están definidas.
        // Coercimos a "" para satisfacer DespachoParams (string requerido) sin asumir non-null.
        const paramsDespacho = {
          destinatarioNombre,
          calle: calle || "",
          altura: altura || "",
          piso, dpto,
          localidad: localidad || "",
          provincia: provinciaDestino,
          cp: String(cpDestino),
          dni: dni || "",
          email: email || "",
          telefono: telefono || "",
          peso: parseFloat(String(pesoReal)) || 1,
          paquetes: [{
            pesoKg: parseFloat(String(pesoReal)) || 1, largoCm: 10, anchoCm: 10, altoCm: 10,
            valorDeclarado: parseFloat(String(valorDeclarado)) || 0, requiereSeguro: credencialMain.requiereSeguro
          }],
          referencia: numeroOrden ? `ORDEN-${numeroOrden}` : `ORDEN-${Date.now()}`,
          tipoEntrega: tipoEntregaFormateado
        };

        const respuestaMain = await motorMain.despachar(paramsDespacho);
        if (respuestaMain && respuestaMain.tracking) {
          trackingOficial = respuestaMain.tracking;
          urlEtiquetaFinal = respuestaMain.etiquetaUrl || null;
        }

        const recolector = credencialMain.courierRecolector?.trim() || "";
        const recolectorLower = recolector.toLowerCase();
        const mainNombreLower = credencialMain.nombreCourier?.toLowerCase() || "";

        const esMismoCourier =
          !recolector ||
          recolectorLower === "mismo_courier" ||
          recolectorLower === "pickup" ||
          recolectorLower === mainNombreLower;

        const esDropoff = recolectorLower === "dropoff";

        if (!esMismoCourier && !esDropoff) {
          const courierMicrohub = recolectorLower === "shipro_cross" ? "mocis" : recolector;
          const llavesRecolector = obtenerCredencialesShipro(courierMicrohub);
          const motorRecolector = CourierFactory.crear(courierMicrohub, llavesRecolector);

          const paramsRecolector = { ...paramsDespacho, referencia: `FIRST-MILE: ${trackingOficial}` };
          const respuestaRecolector = await motorRecolector.despachar(paramsRecolector);

          if (respuestaRecolector && respuestaRecolector.tracking) {
            trackingFirstMile = respuestaRecolector.tracking;
          }
        }
      }
    } catch (errorDisp) {
      console.warn(`[Shipro] Aviso: Falló el despacho en los couriers (puede ser por API caída o credenciales inválidas).`, errorDisp);
    }
  }

  const montoDebito = parseFloat(String(costoEnvio)) || 0;
  const montoProveedor = parseFloat(String(costoProveedor)) || 0;
  let empresaNombreParaMail = "la Tienda";

  let fugaCalculada = 0;
  let courierSugeridoStr: string | null = null;
  let servicioSugeridoStr: string | null = null;

  try {
    // HARDCODED: CP de origen del depósito.
    // Eliminar cuando se implemente módulo Depósitos (DEUDA 4).
    // Ver DEUDAS.md
    const dataCotizacion = await cotizar({
      empresaId,
      cpOrigen: "1050",
      cpDestino: String(cpDestino),
      provinciaDestino,
      paquetes: [{
        pesoKg: parseFloat(String(pesoReal)) || 1,
        largoCm: 10, anchoCm: 10, altoCm: 10,
        valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
        requiereSeguro: false
      }]
    });

    const mod = modalidad?.toLowerCase() || "";
    let opcionesParaComparar: any[] = [];

    if (mod.includes('sucursal')) opcionesParaComparar = dataCotizacion.sucursal || [];
    else if (mod.includes('domicilio') || mod.includes('estándar') || mod.includes('sameday') || mod.includes('same-day')) opcionesParaComparar = dataCotizacion.domicilio || [];

    if (opcionesParaComparar.length > 0) {
      const opcionMasBarata = opcionesParaComparar.reduce((prev, curr) => prev.precioFinal < curr.precioFinal ? prev : curr);
      if (opcionMasBarata.precioFinal < montoDebito) {
        fugaCalculada = montoDebito - opcionMasBarata.precioFinal;
        courierSugeridoStr = opcionMasBarata.courier;
        servicioSugeridoStr = opcionMasBarata.modalidad;
      }
    }
  } catch (errorFuga) {}

  const resultadoTransaccion = await prisma.$transaction(async (tx) => {
    const empresaData = await tx.empresa.findUnique({ where: { id: empresaId } });
    if (empresaData) empresaNombreParaMail = empresaData.nombre;

    const nuevoSaldo = (empresaData?.saldoActivo || 0) - montoDebito;

    const envioCreado = await tx.envio.create({
      data: {
        trackingNumber: trackingOficial,
        trackingFirstMile: trackingFirstMile,
        numeroOrden: numeroOrden || null,
        etiquetaUrl: urlEtiquetaFinal,
        pesoReal: parseFloat(String(pesoReal)) || 1.0,
        estadoActual: estadoInicialEnvio,
        modalidad: modalidad || "Estándar",
        empresa: { connect: { id: empresaId } },
        courier: { connect: { id: courierIdReal } },
        origen: { connect: { id: direccionOrigen.id } },
        destino: { connect: { id: direccionId } },
        finanzas: {
          create: {
            precioProveedor: montoProveedor,
            precioFactura: montoDebito,
            precioMostrado: montoDebito,
            valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
            pesoCobrado: parseFloat(String(pesoReal)) || 1.0,
            fugaFinanciera: fugaCalculada,
            courierSugerido: courierSugeridoStr,
            servicioSugerido: servicioSugeridoStr
          }
        }
      },
      include: { courier: true, destino: true, finanzas: true }
    });

    await tx.movimientoFinanciero.create({
      data: {
        empresaId,
        tipo: "DEBITO_ENVIO",
        monto: -montoDebito,
        saldoPosterior: nuevoSaldo,
        referencia: trackingOficial,
        descripcion: `Generación de etiqueta ${nombreOficial.toUpperCase()}`,
        envioId: envioCreado.id
      }
    });

    await tx.empresa.update({
      where: { id: empresaId },
      data: { saldoActivo: nuevoSaldo }
    });

    if (falloPorPeaje) {
      await tx.eventoTracking.create({ data: { estado: "RETENIDO", observacion: `Retenido en Peaje: ${motivoRetencion}`, envioId: envioCreado.id } });
    } else {
      await tx.eventoTracking.create({ data: { estado: "Pendiente", observacion: "Envío registrado en plataforma y etiqueta generada.", envioId: envioCreado.id } });
    }

    return envioCreado;
  });

  if (email) {
    if (falloPorPeaje) {
      const { enviarMailRetenido } = await import("@/lib/mailer");
      await enviarMailRetenido(email, trackingOficial, destinatarioNombre, `${process.env.APP_URL || "http://localhost:3000"}/corregir/${trackingOficial}`, empresaNombreParaMail);
    } else {
      enviarMailCreacion(email, trackingOficial, destinatarioNombre, nombreOficial, `${process.env.APP_URL || "http://localhost:3000"}/seguimiento/${trackingOficial}`);
    }
  }

  return { ...resultadoTransaccion, trackingNumber: trackingOficial };
}
