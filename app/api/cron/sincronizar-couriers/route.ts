import { NextResponse } from "next/server";
import { sincronizarTodosLosCouriers } from "@/lib/sucursales/sync";

// =============================================================================
// DEUDA 32+37 (Fase G): endpoint cron-via-HTTP de sincronizacion de cobertura.
// =============================================================================
//
// Lo invoca un servicio externo (GitHub Actions, cron de Linode, Vercel Cron,
// cualquiera) con cadencia mensual dia 1.
//
// SEGURIDAD: protegido por proxy.ts via "Bearer CRON_SECRET" (clasificacion
// kind="cron" automatica por estar bajo /api/cron/). El handler asume request
// autenticado — proxy ya validó antes de delegarnos el control.
//
// Recorre TODOS los couriers activos y llama sincronizarCoberturaCourier(id)
// para cada uno. Couriers sin fuente declarada (ej: Mocis) devuelven
// aplica:false — no es error, solo no aplica. La cobertura efectiva la
// determina la presencia en FUENTES_SUCURSALES (lib/sucursales/sync.ts).
// =============================================================================

export const dynamic = "force-dynamic"; // no cachear: cada llamada hace sync real

export async function GET() {
  const t0 = Date.now();
  const resultados = await sincronizarTodosLosCouriers();

  // Resumen agregado para que el log del cron sea util de un vistazo.
  const aplicaron = resultados.filter((r) => r.aplica);
  const totalSucursales = aplicaron.reduce((acc, r) => acc + r.exitosas, 0);
  const totalErrores = aplicaron.reduce((acc, r) => acc + r.errores, 0);
  const totalSoftDeleted = aplicaron.reduce((acc, r) => acc + r.softDeleted, 0);
  const hayFallo = resultados.some((r) => r.aplica && !r.ok);

  return NextResponse.json({
    ok: !hayFallo,
    duracionMs: Date.now() - t0,
    resumen: {
      couriersTotales: resultados.length,
      couriersConFuente: aplicaron.length,
      couriersSinFuente: resultados.length - aplicaron.length,
      totalSucursalesSincronizadas: totalSucursales,
      totalErrores,
      totalSoftDeleted,
    },
    porCourier: resultados,
  });
}
