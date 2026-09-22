import { NextResponse } from "next/server";
import { sincronizarZonasFlexTodasLasCuentas } from "@/lib/mercadolibre/sync-zonas";

// ============================================================================
// MEF Fase 2.1 (2026-09-22) — Cron endpoint de refresh de zonas Flex. [[DEUDA 180]]
//
// Mirror byte-a-byte de /api/cron/sincronizar-couriers: handler mínimo,
// delegación al helper, auth automático vía proxy.ts kind="cron" (chequea
// `Authorization: Bearer $CRON_SECRET`). No hay auth propio acá.
//
// WIRING: NO WIREADO en el crontab del server hoy. Mismo bucket que rastreo/
// metricas-sla/sincronizar-couriers (ver docs/CRONS.md §2b). Mientras tanto
// es invocable manual con el bearer. Registrado como deuda en DEUDAS.md.
// ============================================================================

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  const resultados = await sincronizarZonasFlexTodasLasCuentas();

  const okSinFlex = resultados.filter((r) => r.ok && r.sinFlex).length;
  const okConFlex = resultados.filter(
    (r): r is Extract<typeof r, { ok: true; sinFlex: false }> =>
      r.ok && !r.sinFlex,
  );
  const fallidos = resultados.filter((r) => !r.ok).length;
  const totalZonas = okConFlex.reduce((acc, r) => acc + r.zonas, 0);
  const totalCps = okConFlex.reduce((acc, r) => acc + r.cps, 0);
  const hayFallo = fallidos > 0;

  return NextResponse.json({
    ok: !hayFallo,
    duracionMs: Date.now() - t0,
    resumen: {
      cuentasTotales: resultados.length,
      okConFlex: okConFlex.length,
      okSinFlex,
      fallidos,
      totalZonas,
      totalCps,
    },
    porCuenta: resultados,
  });
}
