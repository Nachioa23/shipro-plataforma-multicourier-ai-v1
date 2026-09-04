import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { crearEnvio } from "@/lib/envios/crear";
import { resolverContext } from "@/lib/auth-context";

// ==========================================
// GET: LECTURA DE ENVÍOS (Buscador y Filtros Dinámicos)
// ==========================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "25");
    const search = searchParams.get("search") || "";
    const courier = searchParams.get("courier") || "Todos";
    const provincia = searchParams.get("provincia") || "Todas";
    const fechaDesde = searchParams.get("fechaDesde") || "";
    const fechaHasta = searchParams.get("fechaHasta") || "";
    const estadoTab = searchParams.get("estado") || "Todos";

    let where: any = {};
    if (ctx.empresaId !== null) where.empresaId = ctx.empresaId;

    if (search) {
      where.OR = [
        { trackingNumber: { contains: search } },
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
        case "Bloqueados":
          where.estadoActual = { in: ["BLOQUEADO_SALDO", "BLOQUEADO_DEPOSITO"] };
          break;
        case "BloqueadosSaldo":
          where.estadoActual = "BLOQUEADO_SALDO";
          break;
        case "BloqueadosDeposito":
          where.estadoActual = "BLOQUEADO_DEPOSITO";
          break;
        case "Pendientes":
          where.estadoActual = { in: ["PENDIENTE", "Pendiente"] };
          break;
        case "Etiquetados":
          where.estadoActual = { notIn: ["PENDIENTE", "Pendiente", "RETENIDO", "Retenido", "BLOQUEADO_SALDO", "BLOQUEADO_DEPOSITO"] };
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
// POST: CREACIÓN DE ETIQUETA (E-COMMERCE vía API Key)
// El proxy.ts inyecta x-empresa-id resuelto desde la API Key.
// El dashboard usa /api/envios/manual (mismo `crearEnvio`, distinta auth).
// ==========================================
export async function POST(request: Request) {
  const empresaIdHeader = request.headers.get("x-empresa-id");
  if (!empresaIdHeader) {
    return NextResponse.json({ error: "Falta empresaId en el contexto de auth" }, { status: 400 });
  }
  const empresaId = parseInt(empresaIdHeader);

  try {
    // DEUDA 128: idempotency check. Si el plugin manda Idempotency-Key y ya existe
    // un envío de esta empresa con esa clave, devolvemos la respuesta original
    // (misma tracking / etiqueta) sin re-crear. Scope per-empresa: dos empresas
    // pueden mandar la misma clave sin colisionar (schema: @@unique([empresaId,
    // idempotencyKey])). Header de respuesta Idempotency-Replayed: true para que
    // el plugin distinga replay de creación fresh si lo necesita.
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? null;

    if (idempotencyKey) {
      const existing = await prisma.envio.findFirst({
        where: { empresaId, idempotencyKey },
        select: {
          trackingNumber: true,
          etiquetaUrl: true,
          estadoActual: true,
          courier: { select: { nombre: true } },
        },
      });
      if (existing) {
        return NextResponse.json(
          {
            tracking: existing.trackingNumber,
            etiquetaUrl: existing.etiquetaUrl,
            status: existing.estadoActual,
            courier: existing.courier?.nombre ?? null,
            replayed: true,
          },
          {
            status: 200,
            headers: { "Idempotency-Replayed": "true" },
          }
        );
      }
    }

    const body = await request.json();

    // === DEUDA 35: validacion de tipoOrigen ===
    // Si el body manda tipoOrigen, tiene que ser uno de los 2 valores validos.
    // Si no manda nada, se respeta el default de crearEnvio ("recoleccion_courier").
    if (body.tipoOrigen !== undefined && body.tipoOrigen !== "recoleccion_courier" && body.tipoOrigen !== "drop_off_cliente") {
      return NextResponse.json(
        { error: "tipoOrigen invalido. Valores aceptados: 'recoleccion_courier' o 'drop_off_cliente'" },
        { status: 400 }
      );
    }

    const result = await crearEnvio({
      empresaId,
      destinatarioNombre: body.destinatarioNombre,
      cpDestino: body.cpDestino,
      pesoReal: body.pesoReal,
      // DEUDA 132: forwardear dims para no perderlas entre el POST del plugin
      // y la etiqueta al courier (mismo patrón que pesoReal).
      largoCm: body.largoCm ?? null,
      anchoCm: body.anchoCm ?? null,
      altoCm: body.altoCm ?? null,
      nombreCourier: body.nombreCourier,
      calle: body.calle,
      altura: body.altura,
      piso: body.piso,
      dpto: body.dpto,
      dni: body.dni,
      email: body.email,
      telefono: body.telefono,
      localidad: body.localidad,
      modalidad: body.modalidad,
      valorDeclarado: body.valorDeclarado,
      costoEnvio: body.costoEnvio,
      costoProveedor: body.costoProveedor,
      provinciaDestino: body.provinciaDestino,
      numeroOrden: body.numeroOrden,
      idempotencyKey: idempotencyKey ?? null,
      tipoOrigen: body.tipoOrigen,
      permitirBloqueoPorDeposito: true,
    });

    if (result.bloqueadoPorDeposito) {
      return NextResponse.json({
        success: true,
        tracking: result.trackingNumber,
        etiquetaUrl: null,
        bloqueadoPorDeposito: true,
        status: "BLOQUEADO_DEPOSITO",
        warning: "El cliente no tiene depósito predeterminado configurado. Configurá uno en Shipro para que se procesen los envíos pendientes."
      });
    }

    if (result.bloqueadoPorCredencial) {
      // FASE 2 pieza 1 sub 3 (2026-07-30): credencial Rama A sin dueño configurado.
      return NextResponse.json({
        ...result,
        status: "BLOQUEADO_CREDENCIAL",
        bloqueadoPorCredencial: true,
        warning: "Envío creado pero bloqueado: la credencial de este courier es Rama A pero no tiene dueño configurado. Se destrabará automáticamente cuando admin_shipro asigne el dueño en /configuracion/transportes."
      });
    }

    if (result.bloqueadoPorOperatividad) {
      return NextResponse.json({
        ...result,
        status: "BLOQUEADO_OPERATIVIDAD",
        bloqueadoPorOperatividad: true,
        warning: "Envío creado pero bloqueado: el par (depósito × courier) no es operativo. El cliente debe configurar el par en Shipro para destrabarlo."
      });
    }

    if (result.bloqueadoPorSaldo) {
      return NextResponse.json({
        ...result,
        status: "BLOQUEADO_SALDO",
        bloqueadoPorSaldo: true,
        warning: "Envío creado pero bloqueado por falta de saldo. El cliente debe cargar saldo en Shipro para destrabarlo."
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message?.startsWith('DepositoNoEncontrado')) {
      return NextResponse.json(
        { error: 'Depósito no encontrado.', code: 'DEPOSITO_NO_ENCONTRADO' },
        { status: 400 }
      );
    }
    if (error?.message?.startsWith('DepositoInactivo')) {
      return NextResponse.json(
        { error: 'El depósito está inactivo o eliminado y no puede usarse para crear envíos.', code: 'DEPOSITO_INACTIVO' },
        { status: 400 }
      );
    }
    // FIX (2026-09-04): Fix A del bug de crear.ts — reemplaza el auto-provision
    // legacy que explotaba con 500 (PrismaClientValidationError) cuando el caller
    // mandaba nombreCourier=undefined. Ahora crear.ts throwea CourierAusente y
    // este catch lo mapea a 400 con code claro para que el caller (plugin, e-commerce)
    // sepa qué corregir. Fix B (degradar a BLOQUEADO_COURIER_AUSENTE) es aparte.
    if (error?.message?.startsWith('CourierAusente:')) {
      return NextResponse.json(
        { error: 'Falta courier o el nombre no coincide con ningún courier dado de alta. Enviá un nombre canónico existente.', code: 'COURIER_AUSENTE' },
        { status: 400 }
      );
    }
    // DEUDA 129: courier upstream no respondió en el timeout del adapter.
    // 503 = infra fallada aguas arriba (safe to retry). Los marketplaces
    // (Tiendanube et al.) tratan 5xx como transitorios sin abrir el circuit
    // breaker si el ratio se mantiene bajo — un CourierTimeout puntual es
    // aceptable operativamente.
    if (error?.message?.startsWith("CourierTimeout:")) {
      return NextResponse.json(
        { error: "El servicio de courier no respondió. Reintentá en unos segundos.", code: "COURIER_TIMEOUT" },
        { status: 503 }
      );
    }
    // DEUDA 129: courier rechazó por regla de negocio (CP fuera de cobertura,
    // dirección malformada, servicio inexistente). NO es fallo del sistema
    // Shipro — 422 = unprocessable entity, error de datos del pedido. NUNCA
    // 5xx: los marketplaces tratan 4xx como healthy (no cuentan para el
    // circuit breaker), así un error de negocio no nos autobloquea el transporte.
    if (
      error?.message?.includes("no devolvió tarifas") ||
      error?.message?.includes("no cotiza")
    ) {
      return NextResponse.json(
        { error: "El courier no pudo procesar este envío. Revisá los datos del destinatario.", code: "COURIER_REJECTED" },
        { status: 422 }
      );
    }
    console.error("Error en POST /api/envios:", error);
    return NextResponse.json({ error: "Error interno al crear el envío o debitar el saldo." }, { status: 500 });
  }
}

// ==========================================
// PUT: MANIFIESTOS Y ACTUALIZACIONES
// ==========================================
export async function PUT(request: Request) {
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
