import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { enviarMailCreacion } from "@/lib/mailer";

function obtenerCredencialesShipro(courier: string) {
  const c = courier.toLowerCase().replace(/['\s]/g, '');
  if (c === 'andreani') {
    return { 
      username: process.env.ANDREANI_USER?.trim() || '', 
      password: process.env.ANDREANI_PASS?.trim() || '', 
      cliente: process.env.ANDREANI_CLIENTE?.trim() || '',
      id_sucursal_origen: process.env.ANDREANI_SUCURSAL_ORIGEN?.trim() || '',
      contrato_domicilio: process.env.ANDREANI_CONTRATO_DOM?.trim() || '',
      contrato_sucursal: process.env.ANDREANI_CONTRATO_SUC?.trim() || '',
      contrato_cambio: process.env.ANDREANI_CONTRATO_CAMBIO?.trim() || '',
      contrato_devolucion: process.env.ANDREANI_CONTRATO_DEVOLUCION?.trim() || ''
    };
  }
  if (c === 'mocis') {
    return { clientApi: process.env.MOCIS_CLIENT_API?.trim() || '', clientSecret: process.env.MOCIS_CLIENT_SECRET?.trim() || '' };
  }
  return {};
}

// ==========================================
// GET: LECTURA DE ENVÍOS (Buscador y Filtros Dinámicos)
// ==========================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresaId");
    const rol = searchParams.get("rol")?.toLowerCase() || ""; 
    const filtroEmpresa = searchParams.get("filtroEmpresa"); 
    
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "25");
    const search = searchParams.get("search") || "";
    const courier = searchParams.get("courier") || "Todos";
    const provincia = searchParams.get("provincia") || "Todas";
    const fechaDesde = searchParams.get("fechaDesde") || "";
    const fechaHasta = searchParams.get("fechaHasta") || "";
    const estadoTab = searchParams.get("estado") || "Todos";

    let where: any = {};

    if (rol.includes("admin") || rol.includes("shipro")) {
      if (filtroEmpresa && filtroEmpresa !== "TODAS") {
        where.empresaId = parseInt(filtroEmpresa);
      }
    } else {
      if (!empresaId) return NextResponse.json({ error: "Falta empresaId" }, { status: 400 });
      where.empresaId = parseInt(empresaId);
    }

    if (search) {
      where.OR = [
        { trackingNumber: { contains: search } },
        { trackingFirstMile: { contains: search } },
        { numeroOrden: { contains: search } }, 
        { destino: { nombre: { contains: search } } },
        { destino: { email: { contains: search } } },
        { destino: { telefono: { contains: search } } },
        { destino: { documento: { contains: search } } }
      ];
    }

    if (courier !== "Todos") where.courier = { nombre: courier };
    
    if (provincia !== "Todas") {
      const diccionarioProvincias: Record<string, string[]> = {
        "Ciudad Autónoma de Buenos Aires": ["CABA", "Capital Federal", "Ciudad Autónoma de Buenos Aires", "Ciudad de Buenos Aires", "Capital"],
        "Buenos Aires": ["Buenos Aires", "Bs. As.", "Bs As", "Provincia de Buenos Aires", "PBA"],
        "Tierra del Fuego": ["Tierra del Fuego", "Tierra del Fuego, Antártida e Islas del Atlántico Sur", "TDF"]
      };
      
      const variaciones = diccionarioProvincias[provincia] || [provincia];
      where.destino = { ...where.destino, provincia: { in: variaciones } };
    }

    if (fechaDesde || fechaHasta) {
      where.fechaImpresion = {}; 
      if (fechaDesde) where.fechaImpresion.gte = new Date(`${fechaDesde}T00:00:00.000Z`);
      if (fechaHasta) where.fechaImpresion.lte = new Date(`${fechaHasta}T23:59:59.999Z`);
    }

    if (estadoTab !== "Todos") {
      switch (estadoTab) {
        case "Retenidos":
          where.estadoActual = { in: ["RETENIDO", "Retenido"] };
          break;
        case "Pendientes":
          where.estadoActual = { in: ["PENDIENTE", "Pendiente"] };
          break;
        case "Etiquetados":
          where.estadoActual = { notIn: ["PENDIENTE", "Pendiente", "RETENIDO", "Retenido"] };
          break;
      }
    }

    const skip = (page - 1) * limit;

    const [total, envios, couriersActivos] = await prisma.$transaction([
      prisma.envio.count({ where }),
      prisma.envio.findMany({
        where,
        include: { courier: true, empresa: { select: { nombre: true } }, destino: true, finanzas: true },
        orderBy: { id: 'desc' }, skip, take: limit
      }),
      prisma.courier.findMany({ where: { activo: true }, select: { nombre: true } })
    ]);

    return NextResponse.json({ 
      data: envios, 
      meta: { 
        total, page, limit, totalPages: Math.ceil(total / limit),
        filtrosDinamicos: { couriers: couriersActivos.map(c => c.nombre) }
      } 
    });
  } catch (error) {
    console.error("Error en GET envios:", error);
    return NextResponse.json({ data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0, filtrosDinamicos: { couriers: [] } } });
  }
}

// ==========================================
// POST: CREACIÓN DE ETIQUETA (Con Cotizador Silencioso)
// ==========================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      destinatarioNombre, cpDestino, pesoReal, nombreCourier, 
      empresaId, calle, altura, piso, dpto, dni, email, telefono, localidad, modalidad,
      valorDeclarado, costoEnvio, costoProveedor, provinciaDestino,
      numeroOrden 
    } = body;
    
    let trackingOficial = "SHP-" + Math.floor(Math.random() * 900000 + 100000);
    let trackingFirstMile = null;
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
        estadoInicialEnvio = "RETENIDO"; // FORZAMOS EL ESTADO INICIAL AQUÍ
        falloPorPeaje = true;
        motivoRetencion = "El nombre de la calle está vacío.";
    } else if (!alturaStr && !tienePalabraClave) {
        estadoInicialEnvio = "RETENIDO"; // FORZAMOS EL ESTADO INICIAL AQUÍ
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
          const credencialMain = await prisma.credencialCourier.findUnique({
            where: { empresaId_nombreCourier: { empresaId: parseInt(empresaId), nombreCourier: courierNombreLimpio } }
          });

          if (credencialMain && credencialMain.activo) {
            let llavesMain = credencialMain.usaCredencialesPropias 
              ? JSON.parse(credencialMain.credencialesJson || '{}') 
              : obtenerCredencialesShipro(courierNombreLimpio);
            
            if (!llavesMain.clientApi && !llavesMain.username) llavesMain = obtenerCredencialesShipro(courierNombreLimpio);
            
            const motorMain = CourierFactory.crear(courierNombreLimpio, llavesMain);
            
            let tipoEntregaFormateado: "sucursal" | "domicilio" | "inversa" | "cambio" = "domicilio";
            const mod = modalidad?.toLowerCase() || "";
            if (mod.includes('sucursal')) tipoEntregaFormateado = "sucursal";
            if (mod.includes('inversa') || mod.includes('devolucion')) tipoEntregaFormateado = "inversa";
            if (mod.includes('cambio')) tipoEntregaFormateado = "cambio";

            const paramsDespacho = {
              destinatarioNombre, calle, altura, piso, dpto, localidad, 
              provincia: provinciaDestino, cp: String(cpDestino), dni, email, telefono, 
              peso: parseFloat(pesoReal) || 1, 
              paquetes: [{ 
                pesoKg: parseFloat(pesoReal) || 1, largoCm: 10, anchoCm: 10, altoCm: 10,
                valorDeclarado: parseFloat(valorDeclarado) || 0, requiereSeguro: credencialMain.requiereSeguro      
              }], 
              referencia: numeroOrden ? `ORDEN-${numeroOrden}` : `ORDEN-${Date.now()}`,
              tipoEntrega: tipoEntregaFormateado
            };

            const respuestaMain = await motorMain.despachar(paramsDespacho);
            if (respuestaMain && respuestaMain.tracking) {
              trackingOficial = respuestaMain.tracking; 
              urlEtiquetaFinal = respuestaMain.etiquetaUrl || null; 
            }

            if (credencialMain.courierRecolector && credencialMain.courierRecolector !== "mismo_courier") {
              let llavesRecolector = obtenerCredencialesShipro(credencialMain.courierRecolector);
              const motorRecolector = CourierFactory.crear(credencialMain.courierRecolector, llavesRecolector);
              
              const paramsRecolector = { ...paramsDespacho, referencia: `FIRST-MILE: ${trackingOficial}` };
              const respuestaRecolector = await motorRecolector.despachar(paramsRecolector);
              
              if (respuestaRecolector && respuestaRecolector.tracking) {
                trackingFirstMile = respuestaRecolector.tracking;
              }
            }
          }
        } catch (errorDisp) {
           console.warn(`[Shipro] Aviso: Falló el despacho en los couriers.`, errorDisp);
        }
    }

    const montoDebito = parseFloat(costoEnvio) || 0;
    const montoProveedor = parseFloat(costoProveedor) || 0;
    let empresaNombreParaMail = "la Tienda";

    let fugaCalculada = 0;
    let courierSugeridoStr = null;
    let servicioSugeridoStr = null;

    try {
      const payloadCotizador = {
        empresaId, cpOrigen: "1000", cpDestino, provinciaDestino,
        paquetes: [{ pesoKg: parseFloat(pesoReal) || 1, largoCm: 10, anchoCm: 10, altoCm: 10, valorDeclarado: parseFloat(valorDeclarado) || 0 }]
      };

      const urlBase = request.headers.get("origin") || "http://localhost:3000";
      const resCotizador = await fetch(`${urlBase}/api/cotizar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadCotizador)
      });

      if (resCotizador.ok) {
        const dataCotizacion = await resCotizador.json();
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
      }
    } catch (errorFuga) {}

    const resultadoTransaccion = await prisma.$transaction(async (tx) => {
      const empresaData = await tx.empresa.findUnique({ where: { id: parseInt(empresaId) } });
      if (empresaData) empresaNombreParaMail = empresaData.nombre;
      
      const nuevoSaldo = (empresaData?.saldoActivo || 0) - montoDebito;

      const envioCreado = await tx.envio.create({
        data: {
          trackingNumber: trackingOficial,
          trackingFirstMile: trackingFirstMile, 
          numeroOrden: numeroOrden || null,
          etiquetaUrl: urlEtiquetaFinal,
          pesoReal: parseFloat(pesoReal) || 1.0, 
          estadoActual: estadoInicialEnvio, // ACÁ AHORA SE GRABA "RETENIDO" SI FALLÓ
          modalidad: modalidad || "Estándar",
          empresa: { connect: { id: parseInt(empresaId) } },
          courier: { connect: { id: courierIdReal } }, 
          origen: { connect: { id: direccionOrigen.id } }, 
          destino: { connect: { id: direccionId } }, 
          finanzas: { 
            create: { 
              precioProveedor: montoProveedor,          
              precioFactura: montoDebito,               
              precioMostrado: montoDebito,              
              valorDeclarado: parseFloat(valorDeclarado) || 0,
              pesoCobrado: parseFloat(pesoReal) || 1.0,
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
          empresaId: parseInt(empresaId),
          tipo: "DEBITO_ENVIO",
          monto: -montoDebito,
          saldoPosterior: nuevoSaldo,
          referencia: trackingOficial,
          descripcion: `Generación de etiqueta ${nombreOficial.toUpperCase()}`,
          envioId: envioCreado.id
        }
      });

      await tx.empresa.update({
        where: { id: parseInt(empresaId) },
        data: { saldoActivo: nuevoSaldo }
      });

      if (falloPorPeaje) {
        // ACÁ DEJAMOS EL EVENTO COMO RETENIDO PARA EL HISTORIAL
        await tx.eventoTracking.create({ data: { estado: "RETENIDO", observacion: `Retenido en Peaje: ${motivoRetencion}`, envioId: envioCreado.id } });
      } else {
        await tx.eventoTracking.create({ data: { estado: "Pendiente", observacion: "Envío registrado en plataforma y etiqueta generada.", envioId: envioCreado.id } });
      }

      return envioCreado;
    });

    if (email) {
      if (falloPorPeaje) {
         const { enviarMailRetenido } = await import("@/lib/mailer");
         await enviarMailRetenido(email, trackingOficial, destinatarioNombre, `http://localhost:3000/corregir/${trackingOficial}`, empresaNombreParaMail);
      } else {
         enviarMailCreacion(email, trackingOficial, destinatarioNombre, nombreOficial, `http://localhost:3000/seguimiento/${trackingOficial}`);
      }
    }

    return NextResponse.json({ ...resultadoTransaccion, trackingNumber: trackingOficial });
    
  } catch (error) { 
    console.error("Error en POST envio:", error);
    return NextResponse.json({ error: "Error interno al crear el envío o debitar el saldo." }, { status: 500 }); 
  }
}

// ==========================================
// PUT: MANIFIESTOS Y ACTUALIZACIONES
// ==========================================
export async function PUT(request: Request) {
  // ... (El código de PUT se mantiene intacto)
  try {
    const body = await request.json();
    const { ids, nuevoEstado, generarManifiestoParaCourier, empresaId } = body;
    
    if (!ids || !ids.length || !nuevoEstado) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    if (generarManifiestoParaCourier && empresaId) {
      const cantManifiestos = await prisma.manifiesto.count({
        where: { empresaId: parseInt(empresaId) }
      });
      const proximoNumero = cantManifiestos + 1;

      const nuevoManifiesto = await prisma.manifiesto.create({
        data: {
          numeroCorrelativo: proximoNumero,
          courier: generarManifiestoParaCourier,
          cantidadPaquetes: ids.length,
          empresa: { connect: { id: parseInt(empresaId) } },
        }
      });

      await prisma.envio.updateMany({
        where: { id: { in: ids } },
        data: { 
          estadoActual: nuevoEstado,
          manifiestoId: nuevoManifiesto.id,
          fechaImpresion: (nuevoEstado === "Impreso" || nuevoEstado === "Impreso / Listo") ? new Date() : undefined
        }
      });

      return NextResponse.json({ success: true, actualizados: ids.length, manifiestoId: nuevoManifiesto.id, numeroCorrelativo: proximoNumero });
    } else {
      await prisma.envio.updateMany({ 
        where: { id: { in: ids } }, 
        data: { 
          estadoActual: nuevoEstado,
          fechaImpresion: (nuevoEstado === "Impreso" || nuevoEstado === "Impreso / Listo") ? new Date() : undefined
        } 
      });
      return NextResponse.json({ success: true, actualizados: ids.length });
    }

  } catch (error) { 
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 }); 
  }
}