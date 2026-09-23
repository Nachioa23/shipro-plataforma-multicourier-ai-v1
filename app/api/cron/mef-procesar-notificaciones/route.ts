import { NextResponse } from "next/server";
import { procesarNotificacionesFlexPendientes } from "@/lib/mercadolibre/crear-envio-flex";

// ============================================================================
// MEF Fase 2.3.c (2026-09-23) — Cron worker que consume NotificacionFlex
// estado="valido" y crea el Envío correspondiente (o BLOQUEADO_* Flex con
// causa clara). [[DEUDA 180]]
//
// Mirror byte-a-byte de /api/cron/mef-sincronizar-zonas: handler mínimo,
// delegación al helper, auth automático vía proxy.ts kind="cron" (chequea
// `Authorization: Bearer $CRON_SECRET`). Sin auth propio.
//
// WIRING: NO WIREADO en el crontab del server hoy — mismo bucket de deuda
// que rastreo/metricas-sla/sincronizar-couriers/mef-sincronizar-zonas.
// Invocable manual con el bearer. Ver DEUDAS.md.
// ============================================================================

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  const resumen = await procesarNotificacionesFlexPendientes();
  return NextResponse.json({
    ok: resumen.errores === 0,
    duracionMs: Date.now() - t0,
    resumen,
  });
}
