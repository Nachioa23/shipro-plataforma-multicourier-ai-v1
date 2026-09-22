// ============================================================================
// MEF Fase 2.1 (2026-09-22) — Sync de zonas Flex del vendedor. [[DEUDA 180]]
//
// Fuente: GET /users/{mlUserId}/shipping_preferences → services.self_service.
// Shape esperado (validado en Chat D):
//   services.self_service = {
//     enabled, cut_off_time, daily_capacity,
//     zones: [{ zone_id, name, enabled, zip_codes: ["1000", ...] }]
//   }
//
// PRECISION 1 — ATOMICIDAD (correctitud, no perf):
//   El delete+recreate de UNA cuenta corre DENTRO de un solo $transaction. Desde
//   afuera (Fase 2.3 resolviendo cp→zona en el receiver de webhooks) NUNCA se ve
//   el estado intermedio "cuenta con cero zonas". Si un webhook Flex cae justo
//   ahí, la lectura ve las zonas viejas O las nuevas — nunca el vacío.
//
// PRECISION 1b — EMPTY-READ GUARD:
//   Si `services.self_service` está AUSENTE en el payload (vendedor sin Flex,
//   deshabilitó el servicio, o refresh transitorio con shape reducido) → NO se
//   borran las zonas existentes. Se logea "cuenta sin Flex" y se sale limpio.
//   Nunca zero-outear un snapshot bueno por una lectura vacía.
//
// PRECISION 2 — CRON WIRING:
//   El endpoint /api/cron/mef-sincronizar-zonas existe pero NO está wireado en
//   el crontab del server (mismo bucket que rastreo/metricas-sla/
//   sincronizar-couriers). Mientras tanto es invocable manual con
//   `Authorization: Bearer $CRON_SECRET`. Ver DEUDAS.md.
// ============================================================================

import prisma from "@/lib/prisma";
import { mlFetch } from "@/lib/mercadolibre/client";

// ----------------------------------------------------------------------------
// Tipos de la respuesta de ML — defensivos. ML puede agregar campos; nosotros
// leemos sólo lo que sabemos.
// ----------------------------------------------------------------------------

interface MlSelfServiceZone {
  zone_id?: unknown;
  name?: unknown;
  enabled?: unknown;
  zip_codes?: unknown;
}

interface MlSelfService {
  enabled?: unknown;
  cut_off_time?: unknown;
  daily_capacity?: unknown;
  zones?: unknown;
}

// ----------------------------------------------------------------------------
// Resultado por-cuenta — legible en el log del batch (allSettled).
// ----------------------------------------------------------------------------

export type ResultadoSincronizacionZonas =
  | { empresaId: number; ok: true; sinFlex: true }
  | { empresaId: number; ok: true; sinFlex: false; zonas: number; cps: number }
  | { empresaId: number; ok: false; error: string };

// ============================================================================
// PUBLIC: sincronizarZonasFlex(empresaId)
//
// GET → parse → (si services.self_service presente) $transaction { delete +
// recreate + update scalars }.
// ============================================================================

export async function sincronizarZonasFlex(
  empresaId: number,
): Promise<ResultadoSincronizacionZonas> {
  // 1. Resolver mlUserId. El path de ML lo pide con el user_id del seller;
  //    getMercadoLibreAccessToken (dentro de mlFetch) resuelve el token del
  //    seller vía CuentaMercadoLibre.empresaId (1-1).
  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: { id: true, mlUserId: true, estado: true },
  });
  if (!cuenta) {
    return { empresaId, ok: false, error: "No hay cuenta ML vinculada" };
  }
  if (cuenta.estado !== "activa") {
    return {
      empresaId,
      ok: false,
      error: `Cuenta ML en estado "${cuenta.estado}"; requiere re-autorización`,
    };
  }

  // 2. GET autenticado. mlFetch inyecta Bearer + hace refresh lazy + retry 401.
  //    BigInt → string vía template literal (auto).
  const path = `/users/${cuenta.mlUserId}/shipping_preferences`;
  let res: Response;
  try {
    res = await mlFetch(empresaId, path);
  } catch (e) {
    return {
      empresaId,
      ok: false,
      error: `mlFetch fallo: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!res.ok) {
    return {
      empresaId,
      ok: false,
      error: `ML respondió HTTP ${res.status} en ${path}`,
    };
  }
  const payload: any = await res.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return { empresaId, ok: false, error: "Payload no-JSON o vacío" };
  }

  // 3. PRECISION 1b — EMPTY-READ GUARD.
  //    services.self_service ausente = vendedor sin Flex. NO tocar snapshot.
  const selfService: MlSelfService | undefined = payload?.services?.self_service;
  if (!selfService || typeof selfService !== "object") {
    console.log(
      `[mef-zonas] empresaId=${empresaId} sin services.self_service — no se tocan zonas existentes (empty-read guard)`,
    );
    // Marcamos flexConfigurado=false SÓLO si la cuenta nunca vio Flex; si ya
    // tuvo Flex configurado, dejamos el snapshot y el flag como estaban — el
    // operador decide (podría ser drift transitorio del payload ML).
    // Estrategia conservadora: no tocar ningún flag/valor. El caller ve sinFlex=true.
    return { empresaId, ok: true, sinFlex: true };
  }

  // 4. Parse defensivo del payload.
  const cutOffTime =
    typeof selfService.cut_off_time === "string" ? selfService.cut_off_time : null;
  const dailyCapacity =
    typeof selfService.daily_capacity === "number" &&
    Number.isFinite(selfService.daily_capacity)
      ? Math.trunc(selfService.daily_capacity)
      : null;
  const zonesRaw: MlSelfServiceZone[] = Array.isArray(selfService.zones)
    ? (selfService.zones as MlSelfServiceZone[])
    : [];

  // Normalizamos las zonas a la forma que va a persistir. Un zone_id que no
  // sea string/number se skipea (no rompemos el sync por un item malformado).
  const zonasNormalizadas = zonesRaw
    .map((z) => {
      const zoneId =
        typeof z?.zone_id === "string" || typeof z?.zone_id === "number"
          ? String(z.zone_id)
          : null;
      if (!zoneId) return null;
      const nombre = typeof z?.name === "string" ? z.name : "";
      const enabled = z?.enabled === true; // default false si no viene
      const zipCodesRaw = Array.isArray(z?.zip_codes) ? z.zip_codes : [];
      const codigosPostales = zipCodesRaw
        .filter(
          (cp): cp is string | number =>
            typeof cp === "string" || typeof cp === "number",
        )
        .map((cp) => String(cp).trim())
        .filter((cp) => cp.length > 0);
      // Dedup dentro de la zona (defensa si ML manda duplicados).
      const cpsUnicos = Array.from(new Set(codigosPostales));
      return { zoneIdMl: zoneId, nombre, enabled, codigosPostales: cpsUnicos };
    })
    .filter(
      (
        z,
      ): z is {
        zoneIdMl: string;
        nombre: string;
        enabled: boolean;
        codigosPostales: string[];
      } => z !== null,
    );

  // Dedup por zoneIdMl a nivel cuenta (si ML repite un zone_id, el @@unique
  // rechazaría la segunda; nos quedamos con la última — es determinístico y
  // no hay verdad más específica).
  const zonasPorId = new Map<
    string,
    { zoneIdMl: string; nombre: string; enabled: boolean; codigosPostales: string[] }
  >();
  for (const z of zonasNormalizadas) zonasPorId.set(z.zoneIdMl, z);
  const zonasFinal = Array.from(zonasPorId.values());
  const totalCps = zonasFinal.reduce((acc, z) => acc + z.codigosPostales.length, 0);

  // 5. PRECISION 1 — ATOMICIDAD.
  //    Todo el delete+recreate + update scalars corre en UN $transaction. Fase
  //    2.3 nunca observa "zero zonas" para esta cuenta.
  //    onDelete: Cascade → borrar CuentaMercadoLibreZona cascadea los CPs.
  await prisma.$transaction(async (tx) => {
    await tx.cuentaMercadoLibreZona.deleteMany({
      where: { cuentaMercadoLibreId: cuenta.id },
    });

    for (const z of zonasFinal) {
      await tx.cuentaMercadoLibreZona.create({
        data: {
          cuentaMercadoLibreId: cuenta.id,
          zoneIdMl: z.zoneIdMl,
          nombre: z.nombre,
          enabled: z.enabled,
          codigosPostales: {
            create: z.codigosPostales.map((cp) => ({ codigoPostal: cp })),
          },
        },
      });
    }

    await tx.cuentaMercadoLibre.update({
      where: { id: cuenta.id },
      data: {
        flexConfigurado: true,
        flexCutOffTime: cutOffTime,
        flexDailyCapacity: dailyCapacity,
      },
    });
  });

  return {
    empresaId,
    ok: true,
    sinFlex: false,
    zonas: zonasFinal.length,
    cps: totalCps,
  };
}

// ============================================================================
// PUBLIC: sincronizarZonasFlexTodasLasCuentas()
//
// Batch: findMany cuentas activas → Promise.allSettled loop. Una falla por
// cuenta NO aborta el batch. Log per-account result.
// ============================================================================

export async function sincronizarZonasFlexTodasLasCuentas(): Promise<
  ResultadoSincronizacionZonas[]
> {
  const cuentas = await prisma.cuentaMercadoLibre.findMany({
    where: { estado: "activa" },
    select: { empresaId: true },
  });

  const resultados = await Promise.allSettled(
    cuentas.map((c) => sincronizarZonasFlex(c.empresaId)),
  );

  return resultados.map((r, i): ResultadoSincronizacionZonas => {
    if (r.status === "fulfilled") return r.value;
    return {
      empresaId: cuentas[i].empresaId,
      ok: false,
      error:
        r.reason instanceof Error ? r.reason.message : String(r.reason ?? "unknown"),
    };
  });
}
