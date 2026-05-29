import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { capacidadTecnica, CODIGOS_SERVICIO, displayCourier } from "@/lib/couriers/serviciosSoportados";
import { couriersSoportados, courierTieneSoporte } from "@/lib/couriers/CourierFactory";

// =============================================================================
// DEUDA 32+37: ABM de couriers (espacio Shipro).
// Gestiona couriers, sus servicios comerciales, y los datos del consolidador.
// =============================================================================
// SEGURIDAD: estos endpoints son solo para admin_shipro. El guard lee x-rol
// (inyectado por proxy.ts). NOTA: proxy.ts no enforza rol admin para /api/admin/*
// en general — solo valida sesion. Por eso el guard va aca explicito.
// DEUDA de seguridad registrada: auditar TODOS los /api/admin/* y protegerlos.
// =============================================================================

function esAdmin(request: Request): boolean {
  return request.headers.get("x-rol") === "admin_shipro";
}

const NO_AUTORIZADO = NextResponse.json(
  { error: "No autorizado. Esta operacion requiere rol admin_shipro." },
  { status: 403 }
);

// Grupo de cada servicio (para ordenar/agrupar en la UI sin depender de la BD).
function grupoDeServicio(codigo: string): string {
  return codigo.startsWith("inversa_") ? "logistica_inversa" : "entrega";
}

// =============================================================================
// GET — lista de couriers con servicios + datos consolidador + integrables.
// =============================================================================
export async function GET(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const couriers = await prisma.courier.findMany({
    orderBy: { nombre: "asc" },
    include: {
      servicios: { orderBy: { ordenVisual: "asc" } },
    },
  });

  // Couriers integrables: tienen adapter (couriersSoportados) pero NO fila en BD.
  // Es lo que el asistente de alta ofrece para crear. Devolvemos canonico (lo que
  // espera el POST) + display (para mostrar en UI).
  const nombresEnBd = new Set(
    couriers.map((c) => c.nombre.toLowerCase().replace(/['\s]/g, ""))
  );
  const integrables = couriersSoportados()
    .filter((n) => !nombresEnBd.has(n))
    .map((canonico) => ({ canonico, display: displayCourier(canonico) }));

  return NextResponse.json({ couriers, integrables });
}

// =============================================================================
// PUT — update PARCIAL de un courier. Solo toca los campos presentes en el body.
// Acepta: campos de contacto, datos del consolidador, y un array de servicios.
// REGLA: no se puede activar un servicio cuya capacidad tecnica es null.
// =============================================================================
export async function PUT(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "Falta el id del courier" }, { status: 400 });
  }

  const courier = await prisma.courier.findUnique({ where: { id: Number(id) } });
  if (!courier) {
    return NextResponse.json({ error: "Courier no encontrado" }, { status: 404 });
  }

  // --- Build partial update: solo campos presentes en el body ---
  const data: any = {};
  const camposDirectos = [
    "activo", "emailSoporte", "telefonoSoporte", "contactoComercial", "logoUrl",
    "puedeConsolidar",
    "cpDepositoConsolidadorCalle", "cpDepositoConsolidadorNumero",
    "cpDepositoConsolidadorCp", "cpDepositoConsolidadorLocalidad",
    "cpDepositoConsolidadorProvincia",
  ];
  for (const campo of camposDirectos) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }

  // --- Servicios: array de { codigoServicio, activo } ---
  // REGLA enforced: activar un servicio con capacidad null => 400.
  if (Array.isArray(body.servicios)) {
    for (const s of body.servicios) {
      if (!s || typeof s.codigoServicio !== "string") {
        return NextResponse.json(
          { error: "Cada servicio debe tener codigoServicio (string)" },
          { status: 400 }
        );
      }
      const capacidad = capacidadTecnica(courier.nombre, s.codigoServicio);
      if (s.activo === true && capacidad === null) {
        return NextResponse.json(
          {
            error: `No se puede activar '${s.codigoServicio}': el courier '${courier.nombre}' no lo soporta tecnicamente (sin capacidad mapeada).`,
          },
          { status: 400 }
        );
      }
    }
  }

  // --- Aplicar todo en una transaccion ---
  try {
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.courier.update({ where: { id: Number(id) }, data });
      }
      if (Array.isArray(body.servicios)) {
        for (const s of body.servicios) {
          const capacidad = capacidadTecnica(courier.nombre, s.codigoServicio);
          const activoEfectivo = capacidad !== null && s.activo === true;
          await tx.servicioCourier.upsert({
            where: {
              courierId_codigoServicio: {
                courierId: Number(id),
                codigoServicio: s.codigoServicio,
              },
            },
            update: { activo: activoEfectivo, capacidadTecnicaMapeada: capacidad },
            create: {
              courierId: Number(id),
              codigoServicio: s.codigoServicio,
              grupo: grupoDeServicio(s.codigoServicio),
              ordenVisual: CODIGOS_SERVICIO.indexOf(s.codigoServicio as any) + 1,
              activo: activoEfectivo,
              capacidadTecnicaMapeada: capacidad,
            },
          });
        }
      }
    });
  } catch (err: any) {
    console.error("[admin/couriers PUT] fallo:", err);
    return NextResponse.json({ error: "Error al actualizar el courier" }, { status: 500 });
  }

  const actualizado = await prisma.courier.findUnique({
    where: { id: Number(id) },
    include: { servicios: { orderBy: { ordenVisual: "asc" } } },
  });
  return NextResponse.json({ courier: actualizado });
}

// =============================================================================
// POST — alta guiada de courier. Crea la fila + seedea sus 8 servicios desde el
// registry. Solo permite couriers que tienen adapter (courierTieneSoporte).
// =============================================================================
export async function POST(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const body = await request.json();
  const { nombre } = body;
  if (!nombre || typeof nombre !== "string") {
    return NextResponse.json({ error: "Falta el nombre del courier" }, { status: 400 });
  }

  // Verificar que exista un adapter para este courier.
  if (!courierTieneSoporte(nombre)) {
    return NextResponse.json(
      {
        error: `No hay adapter para '${nombre}'. Para integrar un courier nuevo, primero hay que desarrollar su adapter (ver CourierFactory).`,
      },
      { status: 400 }
    );
  }

  // Verificar que no exista ya (por nombre normalizado).
  const existentes = await prisma.courier.findMany();
  const normalizar = (s: string) => s.toLowerCase().replace(/['\s]/g, "");
  if (existentes.some((c) => normalizar(c.nombre) === normalizar(nombre))) {
    return NextResponse.json(
      { error: `El courier '${nombre}' ya existe.` },
      { status: 409 }
    );
  }

  // Crear courier + seedear sus 8 servicios desde el registry, en transaccion.
  try {
    const nuevo = await prisma.$transaction(async (tx) => {
      const courier = await tx.courier.create({
        data: {
          nombre,
          activo: true,
          ...(body.emailSoporte ? { emailSoporte: body.emailSoporte } : {}),
          ...(body.telefonoSoporte ? { telefonoSoporte: body.telefonoSoporte } : {}),
          ...(body.contactoComercial ? { contactoComercial: body.contactoComercial } : {}),
        },
      });

      for (let i = 0; i < CODIGOS_SERVICIO.length; i++) {
        const codigo = CODIGOS_SERVICIO[i];
        const capacidad = capacidadTecnica(nombre, codigo);
        await tx.servicioCourier.create({
          data: {
            courierId: courier.id,
            codigoServicio: codigo,
            grupo: grupoDeServicio(codigo),
            ordenVisual: i + 1,
            // Alta: todos los servicios arrancan apagados. El admin los activa
            // despues. (Un servicio sin capacidad nunca podra activarse — regla.)
            activo: false,
            capacidadTecnicaMapeada: capacidad,
          },
        });
      }

      return courier;
    });

    const conServicios = await prisma.courier.findUnique({
      where: { id: nuevo.id },
      include: { servicios: { orderBy: { ordenVisual: "asc" } } },
    });
    return NextResponse.json({ courier: conServicios }, { status: 201 });
  } catch (err: any) {
    console.error("[admin/couriers POST] fallo:", err);
    return NextResponse.json({ error: "Error al crear el courier" }, { status: 500 });
  }
}
