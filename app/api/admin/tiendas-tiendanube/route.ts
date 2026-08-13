import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 144 — Lista las tiendas Tiendanube vinculadas para el panel de reasignación
// del equipo Shipro.
//
// SESSION-AUTHED (NO está en PUBLIC_API_EXACT). Gate más restrictivo que /clientes:
// solo admin_shipro, porque el panel que consume este endpoint es la puerta de
// entrada al reassign de tiendas (acción sensible). El proxy inyecta x-rol tras
// validar sesión; sin sesión, el proxy devuelve 401 antes de llegar acá.
//
// SEGURIDAD: NUNCA se devuelve el accessToken (secreto encriptado). Se usa
// `select` explícito en vez de `include` para hacerlo estructural, no accidental
// — cualquier cambio futuro que quiera exponer accessToken debe agregarlo aposta.
//
// Filtros opcionales via query string: ?empresaId=X (una empresa específica),
// ?estado=instalada|desinstalada|suspendida.
export async function GET(request: Request) {
  // Solo admin Shipro (mirror del gate más restrictivo — reasignar tiendas es acción sensible).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo admin Shipro." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const empresaIdParam = searchParams.get("empresaId");
    const estadoParam = searchParams.get("estado");

    const where: { empresaId?: number; estado?: string } = {};
    if (empresaIdParam) {
      const eid = Number(empresaIdParam);
      if (Number.isInteger(eid) && eid > 0) where.empresaId = eid;
    }
    if (estadoParam) where.estado = estadoParam;

    // select explícito: NUNCA incluir accessToken (secreto encriptado). Traemos la empresa dueña
    // (nombre + cuit + activo) para que la UI muestre a quién pertenece cada tienda.
    const tiendas = await prisma.tiendaTiendanube.findMany({
      where,
      select: {
        id: true,
        storeId: true,
        nombre: true,
        dominio: true,
        empresaId: true,
        estado: true,
        shippingCarrierId: true,
        instaladaEn: true,
        desinstaladaEn: true,
        updatedAt: true,
        empresa: { select: { id: true, nombre: true, cuit: true, activo: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(tiendas);
  } catch (e) {
    console.error("[/api/admin/tiendas-tiendanube] Error:", e);
    return NextResponse.json({ error: "Error al listar tiendas" }, { status: 500 });
  }
}
