import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";

// ============================================================================
// MEF Fase 2.2 (2026-09-22) — Config "Couriers Flex" per cliente. [[DEUDA 180]]
//
// Session-scoped en ambos verbos: empresaId SIEMPRE del JWT firmado NextAuth,
// NUNCA del body/query. Mirror del twin /api/empresa/mercadolibre/{connect,conexion}.
//
// GET: lista las zonas Flex vigentes del cliente (CuentaMercadoLibreZona de su
//   CuentaMercadoLibre) + su asignación courier si existe (join lógico por
//   zoneIdMl contra AsignacionCourierZonaFlex). Además devuelve la lista de
//   couriers disponibles = CredencialCourier activo del cliente resuelto a
//   { courierId, courierNombre }.
//
// PUT: body { zoneIdMl, courierId }. Verifica (defense-in-depth):
//   (a) el zoneIdMl viene EXCLUSIVAMENTE del pool de zonas de la cuenta ML de
//       ESTA empresa (no acepta un zoneIdMl arbitrario de otra empresa).
//   (b) el courierId corresponde a un courier con CredencialCourier activo para
//       ESTA empresa (no acepta un courier que el cliente no tiene contratado).
//   Persiste con upsert sobre @@unique([empresaId, zoneIdMl]) — reasignar es
//   reemplazo idempotente.
//
// Asignaciones latentes: si el sync Fase 2.1 no ve más una zona (vendedor la
// eliminó en ML), la asignación NO se borra (no hay FK cascade a la zona). El
// GET la filtra out porque no aparece entre las zonas vigentes; si la zona
// revive con el mismo zoneIdMl, la asignación vuelve a estar activa sin
// re-configurar. Sync-zonas.ts NO conoce esta tabla — cero cross-contamination.
// ============================================================================

const ROLES_LECTURA = ["gerente_cliente", "operador_cliente"];
const ROLES_ESCRITURA = ["gerente_cliente", "operador_cliente"];

// ----------------------------------------------------------------------------
// GET — devuelve zonas + asignaciones actuales + couriers disponibles.
// ----------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (token.empresaId === null) {
    return NextResponse.json(
      { error: "Este endpoint no aplica a usuarios Shipro." },
      { status: 400 },
    );
  }
  const rol = typeof token.rol === "string" ? token.rol : "";
  if (!ROLES_LECTURA.includes(rol)) {
    return NextResponse.json(
      { error: "Acceso denegado. Solo gerente_cliente / operador_cliente." },
      { status: 403 },
    );
  }
  const empresaId = token.empresaId as number;

  // 1) Cuenta ML del cliente. Si no está vinculada → 200 con estado consistente
  //    (no error) — el UI muestra el pedido de "conectar ML primero".
  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: { id: true, estado: true, flexConfigurado: true },
  });
  if (!cuenta) {
    return NextResponse.json({
      cuentaConectada: false,
      zonas: [],
      couriersDisponibles: [],
    });
  }

  // 2) Zonas vigentes de esta cuenta + couriers disponibles del cliente +
  //    asignaciones actuales — en paralelo.
  const [zonasVigentes, credencialesActivas, asignaciones] = await Promise.all([
    prisma.cuentaMercadoLibreZona.findMany({
      where: { cuentaMercadoLibreId: cuenta.id },
      select: { id: true, zoneIdMl: true, nombre: true, enabled: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.credencialCourier.findMany({
      where: { empresaId, activo: true },
      select: { nombreCourier: true },
    }),
    prisma.asignacionCourierZonaFlex.findMany({
      where: { empresaId },
      select: {
        zoneIdMl: true,
        courierId: true,
        courier: { select: { id: true, nombre: true } },
      },
    }),
  ]);

  // Resolver los nombreCourier a Courier {id, nombre} activos (la lista maestra
  // es lo que se muestra en el dropdown — mismo patrón que /api/configuracion/
  // couriers, resolviendo por Courier.nombre; solo devolvemos los que además
  // están activos globalmente para no ofrecer un courier fuera de servicio).
  const nombresCliente = credencialesActivas.map((c) => c.nombreCourier);
  const couriersDisponibles = nombresCliente.length
    ? await prisma.courier.findMany({
        where: { nombre: { in: nombresCliente }, activo: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      })
    : [];

  // Index asignaciones por zoneIdMl para join O(1) contra las zonas vigentes.
  const asignacionesPorZoneIdMl = new Map(
    asignaciones.map((a) => [a.zoneIdMl, a]),
  );

  const zonas = zonasVigentes.map((z) => {
    const asig = asignacionesPorZoneIdMl.get(z.zoneIdMl);
    return {
      id: z.id,
      zoneIdMl: z.zoneIdMl,
      nombre: z.nombre,
      enabled: z.enabled,
      asignacion: asig
        ? { courierId: asig.courierId, courierNombre: asig.courier.nombre }
        : null,
    };
  });

  return NextResponse.json({
    cuentaConectada: cuenta.estado === "activa",
    flexConfigurado: cuenta.flexConfigurado,
    zonas,
    couriersDisponibles,
  });
}

// ----------------------------------------------------------------------------
// PUT — asigna/reasigna un courier a una zona. Idempotente por upsert.
// ----------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (token.empresaId === null) {
    return NextResponse.json(
      { error: "Este endpoint no aplica a usuarios Shipro." },
      { status: 400 },
    );
  }
  const rol = typeof token.rol === "string" ? token.rol : "";
  if (!ROLES_ESCRITURA.includes(rol)) {
    return NextResponse.json(
      { error: "Acceso denegado. Solo gerente_cliente / operador_cliente." },
      { status: 403 },
    );
  }
  // 🚨 empresaId SIEMPRE del JWT firmado. Nunca del body.
  const empresaId = token.empresaId as number;

  const body: any = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 422 });
  }
  const zoneIdMl =
    typeof body.zoneIdMl === "string" && body.zoneIdMl.trim().length > 0
      ? body.zoneIdMl.trim()
      : null;
  const courierId =
    Number.isInteger(body.courierId) && body.courierId > 0
      ? (body.courierId as number)
      : null;
  if (!zoneIdMl || !courierId) {
    return NextResponse.json(
      { error: "zoneIdMl (string) y courierId (int > 0) son obligatorios" },
      { status: 422 },
    );
  }

  // Defense-in-depth (a): el zoneIdMl debe pertenecer a una zona vigente de la
  // cuenta ML de ESTA empresa. Un caller malicioso podría mandar el zoneIdMl de
  // otra empresa; el check lo bloquea con 404 genérico (no enumeration).
  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: { id: true },
  });
  if (!cuenta) {
    return NextResponse.json(
      { error: "No hay cuenta Mercado Libre vinculada a tu empresa." },
      { status: 400 },
    );
  }
  const zona = await prisma.cuentaMercadoLibreZona.findFirst({
    where: { cuentaMercadoLibreId: cuenta.id, zoneIdMl },
    select: { id: true, enabled: true },
  });
  if (!zona) {
    return NextResponse.json({ error: "Zona no encontrada" }, { status: 404 });
  }

  // Defense-in-depth (b): el courierId debe ser un courier que el cliente tiene
  // contratado (CredencialCourier activo) Y estar activo globalmente. Sin
  // esto, el cliente podría asignarse un courier fuera de su cartera.
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, activo: true },
    select: { id: true, nombre: true },
  });
  if (!courier) {
    return NextResponse.json(
      { error: "Courier no encontrado o inactivo" },
      { status: 404 },
    );
  }
  const credencial = await prisma.credencialCourier.findUnique({
    where: {
      empresaId_nombreCourier: { empresaId, nombreCourier: courier.nombre },
    },
    select: { activo: true },
  });
  if (!credencial || !credencial.activo) {
    return NextResponse.json(
      {
        error:
          "El courier seleccionado no está activo en tu cuenta. Activá el courier en /configuracion/transportes antes de asignarlo.",
      },
      { status: 400 },
    );
  }

  // Upsert idempotente sobre (empresaId, zoneIdMl). Reasignar = reemplaza courierId.
  const asignacion = await prisma.asignacionCourierZonaFlex.upsert({
    where: { empresaId_zoneIdMl: { empresaId, zoneIdMl } },
    update: { courierId },
    create: { empresaId, zoneIdMl, courierId },
    select: { zoneIdMl: true, courierId: true },
  });

  return NextResponse.json({
    ok: true,
    asignacion: {
      zoneIdMl: asignacion.zoneIdMl,
      courierId: asignacion.courierId,
      courierNombre: courier.nombre,
    },
  });
}
