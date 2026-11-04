import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { PROVINCIAS_AR } from "@/lib/constants/provincias-ar";

// =============================================================================
// PIEZA 3 cascada de promesa — CRUD del nivel DECLARADO (SlaCourier).
// Alimenta el nivel 4 de lib/utils/promesa-calibrada.ts (commit 89cbcfb):
// cuando existe una fila (courierId, provinciaNorm), la cascada la usa en vez
// del piso plano. Tabla vacía hoy → el endpoint arranca inerte; a medida que
// el admin carga filas, el nivel 4 se activa por (courier, provincia) sin
// más cambios de código.
//
// Vocabulario de zona: por contrato, `zonaNombre` DEBE ser una provincia
// canónica (PROVINCIAS_AR). El dropdown de la UI sirve como ergonomía,
// pero el guard real está acá (POST 400 si no matchea). Mismo normalizador
// que usa la cascada (`normalizarProvincia` = trim+lowercase) matchea del
// otro lado — por construcción, no por coincidencia.
//
// Provincia-only por ahora: la dimensión de servicio (sucursal/domicilio)
// se difiere a una pieza posterior como columna aditiva nullable. Las filas
// que se carguen ahora quedarán como el default "todos los servicios"
// cuando llegue. Cero reproceso.
//
// Money-safe: el endpoint sólo escribe SlaCourier (plazos declarados).
// No toca saldo, débito, markup, tarifa, selección, cobros.
// =============================================================================
// SEGURIDAD: igual patrón que app/api/admin/couriers — guard x-rol explícito
// (proxy.ts no enforza admin para /api/admin/* en general, solo valida sesión).
// =============================================================================

function esAdmin(request: Request): boolean {
  return request.headers.get("x-rol") === "admin_shipro";
}

const NO_AUTORIZADO = NextResponse.json(
  { error: "No autorizado. Esta operacion requiere rol admin_shipro." },
  { status: 403 }
);

const PROVINCIAS_SET: ReadonlySet<string> = new Set(PROVINCIAS_AR);

// =============================================================================
// GET — lista de filas SlaCourier + couriers (para dropdown) + provincias.
// Acepta ?courierId=N opcional para filtrar.
// =============================================================================
export async function GET(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const url = new URL(request.url);
  const courierIdParam = url.searchParams.get("courierId");
  const courierIdFiltro = courierIdParam ? Number(courierIdParam) : null;
  if (courierIdParam && !Number.isFinite(courierIdFiltro)) {
    return NextResponse.json({ error: "courierId invalido" }, { status: 400 });
  }

  const [slas, couriers] = await Promise.all([
    prisma.slaCourier.findMany({
      where: courierIdFiltro !== null ? { courierId: courierIdFiltro } : undefined,
      include: { courier: { select: { id: true, nombre: true } } },
    }),
    prisma.courier.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, activo: true },
    }),
  ]);

  // Orden final: courier.nombre asc, luego zonaNombre asc (Prisma no ordena
  // por campo de relación en un findMany simple, lo hacemos en memoria).
  slas.sort((a, b) => {
    const cmp = a.courier.nombre.localeCompare(b.courier.nombre, "es");
    return cmp !== 0 ? cmp : a.zonaNombre.localeCompare(b.zonaNombre, "es");
  });

  return NextResponse.json({ slas, couriers, provincias: PROVINCIAS_AR });
}

// =============================================================================
// POST — upsert de una fila (courierId, zonaNombre, diasPactados).
// Validaciones server-side (no confiar solo en el dropdown):
//   - zonaNombre ∈ PROVINCIAS_AR (vocabulario limpio por contrato).
//   - diasPactados entero > 0.
//   - courierId existe (Prisma 404 natural si no).
// =============================================================================
export async function POST(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido (JSON)" }, { status: 400 });
  }

  const courierId = Number(body?.courierId);
  const zonaNombre = typeof body?.zonaNombre === "string" ? body.zonaNombre : "";
  const diasPactados = Number(body?.diasPactados);

  if (!Number.isFinite(courierId) || courierId <= 0) {
    return NextResponse.json({ error: "courierId requerido (numero > 0)" }, { status: 400 });
  }
  if (!PROVINCIAS_SET.has(zonaNombre)) {
    return NextResponse.json(
      {
        error: `zonaNombre invalida. Debe ser una provincia canonica (PROVINCIAS_AR). Recibido: "${zonaNombre}"`,
      },
      { status: 400 }
    );
  }
  if (!Number.isInteger(diasPactados) || diasPactados <= 0) {
    return NextResponse.json(
      { error: "diasPactados debe ser un entero mayor a 0" },
      { status: 400 }
    );
  }

  // Verificar que el courier exista antes del upsert — Prisma devolveria P2003
  // (FK violation) en el create path, pero el error de aplicacion es mas claro.
  const courier = await prisma.courier.findUnique({ where: { id: courierId }, select: { id: true } });
  if (!courier) {
    return NextResponse.json({ error: `Courier ${courierId} no encontrado` }, { status: 404 });
  }

  try {
    const sla = await prisma.slaCourier.upsert({
      where: { courierId_zonaNombre: { courierId, zonaNombre } },
      update: { diasPactados },
      create: { courierId, zonaNombre, diasPactados },
      include: { courier: { select: { id: true, nombre: true } } },
    });
    return NextResponse.json({ sla });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`[admin/sla-couriers POST] Prisma ${err.code}:`, err.message);
    } else {
      console.error("[admin/sla-couriers POST] fallo:", err);
    }
    return NextResponse.json({ error: "Error al guardar la fila SlaCourier" }, { status: 500 });
  }
}

// =============================================================================
// DELETE — ?id=N elimina una fila. Baja fisica (la tabla no tiene soft-delete).
// =============================================================================
export async function DELETE(request: Request) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");
  const id = idParam ? Number(idParam) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id requerido en query (numero > 0)" }, { status: 400 });
  }

  try {
    await prisma.slaCourier.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: `Fila ${id} no encontrada` }, { status: 404 });
    }
    console.error("[admin/sla-couriers DELETE] fallo:", err);
    return NextResponse.json({ error: "Error al eliminar la fila SlaCourier" }, { status: 500 });
  }
}
