import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DEUDA 144 — Reasignación manual de una tienda Tiendanube entre empresas.
//
// SESSION-AUTHED, admin_shipro únicamente. Este endpoint es la CONTRACARA del rechazo del cruce en el
// callback OAuth: allí, si una tienda ya vinculada llega con un link de otra empresa, el sistema
// rechaza automáticamente (409) sin cambiar nada. Acá, un admin PUEDE moverla — deliberadamente,
// con motivo escrito — para casos legítimos (venta del negocio, error operativo, etc.).
//
// PATRÓN:
// - Motivo obligatorio: la reasignación cambia el dueño de una tienda, tiene que quedar por qué.
// - Update de TiendaTiendanube + registro en AuditoriaConfiguracion en un $transaction (o pasan las
//   dos cosas, o ninguna — evita quedar con la tienda movida sin traza, o traza sin movimiento).
// - Escribimos directo a prisma.auditoriaConfiguracion.create (el campo "tiendanube:store_reassign"
//   no está en el enum CAMPOS_AUDITABLES del helper registrarCambioConfiguracion, mismo criterio
//   que la rama del cruce en el callback).
export async function POST(request: Request) {
  // Solo admin Shipro — reasignar una tienda de un cliente a otro es una acción deliberada y sensible.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo admin Shipro." }, { status: 403 });
  }

  try {
    const body: any = await request.json().catch(() => null);
    const tiendaId = Number(body?.tiendaId);
    const nuevaEmpresaId = Number(body?.nuevaEmpresaId);
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";

    if (!Number.isInteger(tiendaId) || tiendaId <= 0) {
      return NextResponse.json({ error: "tiendaId inválido" }, { status: 400 });
    }
    if (!Number.isInteger(nuevaEmpresaId) || nuevaEmpresaId <= 0) {
      return NextResponse.json({ error: "nuevaEmpresaId inválido" }, { status: 400 });
    }
    // Motivo obligatorio: la reasignación cambia el dueño de una tienda; tiene que quedar por qué.
    if (motivo.length === 0) {
      return NextResponse.json({ error: "El motivo de la reasignación es obligatorio" }, { status: 400 });
    }

    // La tienda tiene que existir.
    const tienda = await prisma.tiendaTiendanube.findUnique({ where: { id: tiendaId } });
    if (!tienda) {
      return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
    }

    // La empresa destino tiene que existir y estar activa.
    const nuevaEmpresa = await prisma.empresa.findUnique({
      where: { id: nuevaEmpresaId },
      select: { id: true, activo: true },
    });
    if (!nuevaEmpresa) {
      return NextResponse.json({ error: "Empresa destino no encontrada" }, { status: 404 });
    }
    if (!nuevaEmpresa.activo) {
      return NextResponse.json({ error: "La empresa destino está inactiva" }, { status: 409 });
    }

    // No-op defensivo: si ya pertenece a esa empresa, no hay nada que reasignar.
    if (tienda.empresaId === nuevaEmpresaId) {
      return NextResponse.json({ error: "La tienda ya pertenece a esa empresa" }, { status: 409 });
    }

    const empresaAnterior = tienda.empresaId;

    // Update + auditoría, atómico. El registro escribe directo a AuditoriaConfiguracion (el campo
    // "tiendanube:store_reassign" no está en el enum del helper — mismo criterio que el cruce).
    await prisma.$transaction([
      prisma.tiendaTiendanube.update({
        where: { id: tiendaId },
        data: { empresaId: nuevaEmpresaId },
      }),
      prisma.auditoriaConfiguracion.create({
        data: {
          empresaId: nuevaEmpresaId, // la empresa que ahora es dueña
          campo: "tiendanube:store_reassign",
          valorAnterior: JSON.stringify({ storeId: tienda.storeId, empresaId: empresaAnterior }),
          valorNuevo: JSON.stringify({ storeId: tienda.storeId, empresaId: nuevaEmpresaId }),
          motivo,
          usuarioEmail: request.headers.get("x-usuario-email") ?? null,
          rolUsuario: rol,
          ipOrigen: request.headers.get("x-ip-origen") ?? request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, tiendaId, storeId: tienda.storeId, empresaAnterior, nuevaEmpresaId }, { status: 200 });
  } catch (e) {
    console.error("[/api/admin/tiendas-tiendanube/reasignar] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
