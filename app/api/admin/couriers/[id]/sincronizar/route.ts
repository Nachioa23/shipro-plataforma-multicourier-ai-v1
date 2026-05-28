import { NextResponse } from "next/server";
import { sincronizarCoberturaCourier } from "@/lib/sucursales/sync";

// =============================================================================
// DEUDA 32+37 (Fase G): boton manual "Sincronizar ahora" del drawer admin.
// =============================================================================
//
// Lo invoca la UI del drawer admin-couriers (Fase H) cuando el admin hace
// click en "Sincronizar cobertura ahora". Sincroniza UN courier por vez.
//
// SEGURIDAD: guard inline de admin (x-rol === "admin_shipro"). Lo mismo que
// /api/admin/couriers — proxy.ts solo valida sesion, el rol va aca.
// =============================================================================

export const dynamic = "force-dynamic";

function esAdmin(request: Request): boolean {
  return request.headers.get("x-rol") === "admin_shipro";
}

const NO_AUTORIZADO = NextResponse.json(
  { error: "No autorizado. Esta operacion requiere rol admin_shipro." },
  { status: 403 }
);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!esAdmin(request)) return NO_AUTORIZADO;

  const { id } = await params;
  const courierId = Number(id);
  if (!Number.isInteger(courierId) || courierId <= 0) {
    return NextResponse.json({ error: "courierId invalido" }, { status: 400 });
  }

  const resultado = await sincronizarCoberturaCourier(courierId);
  return NextResponse.json(resultado);
}
