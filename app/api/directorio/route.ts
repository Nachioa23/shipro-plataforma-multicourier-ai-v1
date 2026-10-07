import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolverContext } from "@/lib/auth-context";

// =============================================================================
// DEUDA 185 ETAPA 3 (2026-10-07): el buscador del Directorio lee de
// ContactoEmpresa scoped por empresa — cierra el leak cross-tenant.
//
// Modelo (Etapa 1 + 2 en prod):
//   - Direccion tipo='CONTACTO' = fila canónica compartida por email (una por
//     comprador). Datos compartidos; edits propagan a todas las empresas con
//     acceso.
//   - ContactoEmpresa(empresaId, direccionId) = fila ACL pura "esta empresa le
//     vendió al menos una vez a este contacto". Sin fields privados.
//
// Semántica del buscador:
//   - CLIENTE: lista SOLO contactos con fila ContactoEmpresa de SU empresa.
//     Un contacto compartido al que esta empresa NUNCA le vendió es invisible,
//     aun cuando otra empresa lo haya tocado. Esto es el fix del leak.
//   - SHIPRO Modo Dios (ctx.empresaId === null): mantiene la paridad previa —
//     ve TODOS los contactos del sistema (buscador transversal admin). Sin
//     scope por acceso; sí scope por tipo='CONTACTO' (excluye SNAPSHOT_ORIGEN).
//   - SHIPRO con filtroEmpresa=<id>: resolverContext devuelve empresaId=<id>;
//     entra por la rama CLIENTE y filtra por el acceso de esa empresa.
//
// Response shape IDÉNTICO al previo: { data: Direccion[], meta: {...} }. El
// frontend no cambia.
// =============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = resolverContext(request, searchParams.get("filtroEmpresa"));
    if (ctx instanceof NextResponse) return ctx;

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "25");
    const search = searchParams.get("search") || "";

    const skip = (page - 1) * limit;

    // Filtro base sobre la Direccion canónica: solo contactos (excluye
    // SNAPSHOT_ORIGEN) con email no vacío/null.
    const direccionWhereBase: {
      tipo: "CONTACTO";
      email: { not: string };
      OR?: Array<Record<string, { contains: string }>>;
    } = {
      tipo: "CONTACTO",
      email: { not: "" },
    };

    if (search) {
      direccionWhereBase.OR = [
        { nombre: { contains: search } },
        { email: { contains: search } },
        { documento: { contains: search } },
      ];
    }

    if (ctx.empresaId === null) {
      // SHIPRO Modo Dios: buscador global sin scope por acceso. Paridad con el
      // comportamiento previo (Shipro admin ve todo).
      const totalContacts = await prisma.direccion.count({
        where: direccionWhereBase,
      });
      const direcciones = await prisma.direccion.findMany({
        where: direccionWhereBase,
        orderBy: { id: "desc" },
        skip,
        take: limit,
      });
      return NextResponse.json({
        data: direcciones,
        meta: {
          total: totalContacts,
          page,
          limit,
          totalPages: Math.ceil(totalContacts / limit),
        },
      });
    }

    // CLIENTE (o Shipro con filtroEmpresa=<id>): lee ContactoEmpresa scoped.
    // El filtro de búsqueda vive en la direccion asociada (nested relation
    // filter). Solo matchea filas ACL cuya Direccion canónica cumple el filtro.
    const totalContacts = await prisma.contactoEmpresa.count({
      where: {
        empresaId: ctx.empresaId,
        direccion: direccionWhereBase,
      },
    });

    const contactos = await prisma.contactoEmpresa.findMany({
      where: {
        empresaId: ctx.empresaId,
        direccion: direccionWhereBase,
      },
      include: { direccion: true },
      orderBy: { direccion: { id: "desc" } },
      skip,
      take: limit,
    });

    // Mantiene el response shape previo: array de Direccion plano.
    const direcciones = contactos.map((c) => c.direccion);

    return NextResponse.json({
      data: direcciones,
      meta: {
        total: totalContacts,
        page,
        limit,
        totalPages: Math.ceil(totalContacts / limit),
      },
    });
  } catch (error) {
    console.error("Error en Directorio API:", error);
    return NextResponse.json(
      { error: "Error al cargar contactos" },
      { status: 500 },
    );
  }
}
