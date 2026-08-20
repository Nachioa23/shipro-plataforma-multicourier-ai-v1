// ============================================================================
// DEUDA 104 — LGPD customers/redact para Tiendanube.
//
// Anonimiza la PII de un comprador (identificado por email/documento del
// webhook + su lista de order_ids) sobre TODAS las direcciones destino de sus
// envíos en la tienda. La política es "anonimización real" pero con criterio:
//
//   NULL (PII personal — la persona desaparece):
//     nombre, documento, telefono, email, piso, dpto, observacion
//
//   KEEP (datos postales — la dirección queda "huérfana"):
//     calle, altura, cp, localidad, provincia, pais
//
// Rationale: sin nombre/doc/tel/email la dirección deja de identificar a una
// persona. calle/altura se preservan porque el Panel de Control y la Torre de
// Control las consumen (geolocalización, "top direcciones problemáticas") — sin
// identidad linkeada dejan de ser PII. cp/localidad/provincia se usan en TODAS
// las métricas geográficas (SLA por provincia, distribución, devoluciones);
// nullearlas rompería dashboards.
//
// SCOPE (críticos):
//   - SOLO se anonimizan las direcciones referenciadas via `envio.destino`.
//     NUNCA `envio.origen` (que son depósitos de la empresa, no del comprador).
//   - NUNCA se borra el envío ni los registros financieros (iron rule Nacho).
//   - Los tickets de soporte NO se scrubbean (Nacho: retener historia
//     operativa). Esta decisión se documenta explícitamente en el audit log.
//
// MATCH (dos vías, se une el resultado):
//   - PRIMARIO por order_id: (storeId, tiendanubeOrderId IN orders_to_redact).
//     Cobertura garantizada para envíos con order_id ya backfilled por el
//     webhook fulfillment_order/*.
//   - FALLBACK por buyer PII: (storeId, destino.email=X OR destino.documento=Y).
//     Cobertura para envíos viejos cuyo tiendanubeOrderId aún es null.
//   Union por envío id.
//
// IDEMPOTENCIA:
//   Tiendanube reintenta cualquier no-2xx hasta 16× en 48h. Guard previo:
//   contar direcciones destino con `nombre` no-null entre las matched. Si son
//   0 → es retry sobre un redact ya aplicado → skip update + skip audit + log.
//   Si son >0 → hay PII que anonimizar → run update + audit.
//
// AUDIT (compliance proof):
//   Una fila en AuditoriaConfiguracion con campo="lgpd:customers_redact",
//   counts + nota de tickets retenidos por política. NO PII del comprador en
//   el audit (obviously). empresaId de los envíos matched (todos comparten la
//   empresa del store); si no hay matches, se deriva vía TiendaTiendanube.
// ============================================================================

import prisma from "@/lib/prisma";

export interface RedactCustomerInput {
  storeId: number;
  orderIds: string[];
  email: string | null;
  documento: string | null;
}

interface EnvioMinimal {
  id: number;
  destinoId: number | null;
  empresaId: number;
}

export async function redactCustomer(input: RedactCustomerInput): Promise<void> {
  const { storeId, orderIds, email, documento } = input;

  // ---- MATCH ----
  // Union de dos vías: primary (order_id), fallback (email/documento).
  const enviosPorId = new Map<number, EnvioMinimal>();

  if (orderIds.length > 0) {
    const primary = await prisma.envio.findMany({
      where: {
        tiendanubeStoreId: storeId,
        tiendanubeOrderId: { in: orderIds },
      },
      select: { id: true, destinoId: true, empresaId: true },
    });
    for (const e of primary) enviosPorId.set(e.id, e);
  }

  // Fallback OR — construimos la lista con las condiciones truthy (Prisma
  // rechaza OR: [] vacío). Solo corre la query si hay algo que buscar.
  const orConditions: Array<{ email?: string; documento?: string }> = [];
  if (email) orConditions.push({ email });
  if (documento) orConditions.push({ documento });

  if (orConditions.length > 0) {
    const fallback = await prisma.envio.findMany({
      where: {
        tiendanubeStoreId: storeId,
        destino: { OR: orConditions },
      },
      select: { id: true, destinoId: true, empresaId: true },
    });
    for (const e of fallback) enviosPorId.set(e.id, e);
  }

  const envios = Array.from(enviosPorId.values());
  const destinoIds = Array.from(
    new Set(envios.map((e) => e.destinoId).filter((id): id is number => id !== null)),
  );

  // ---- Sin matches ----
  // Igual escribimos el audit (proof que recibimos + procesamos el request).
  // Necesitamos empresaId — si no lo tenemos vía envíos, lo derivamos del store.
  if (envios.length === 0) {
    console.warn("[lgpd customers/redact] sin envíos matched:", {
      storeId,
      orderIds: orderIds.length,
      byEmail: !!email,
      byDocumento: !!documento,
    });
    const tienda = await prisma.tiendaTiendanube.findUnique({
      where: { storeId },
      select: { empresaId: true },
    });
    if (!tienda) {
      console.warn("[lgpd customers/redact] store desconocida — skip audit:", { storeId });
      return;
    }
    await prisma.auditoriaConfiguracion
      .create({
        data: {
          empresaId: tienda.empresaId,
          campo: "lgpd:customers_redact",
          valorAnterior: "0 envíos matched",
          valorNuevo:
            "request recibido y auditado; sin envíos que anonimizar; tickets de soporte no aplican",
          motivo: `LGPD customers/redact de Tiendanube (storeId=${storeId}) — sin matches`,
        },
      })
      .catch((auditErr) =>
        console.error("[lgpd customers/redact] audit no persistió (no-matches):", {
          storeId,
          err: String(auditErr).slice(0, 300),
        }),
      );
    return;
  }

  // ---- Idempotency guard ----
  // Contamos direcciones destino que todavía tienen PII (nombre no-null es
  // el proxy más simple — los 7 fields se nullean juntos). Si 0 → retry sobre
  // un redact ya aplicado → skip todo, log observable.
  const pendientes = await prisma.direccion.count({
    where: { id: { in: destinoIds }, nombre: { not: null } },
  });
  if (pendientes === 0) {
    console.log("[lgpd customers/redact] retry sobre redact ya aplicado — skip:", {
      storeId,
      destinoIds: destinoIds.length,
      envios: envios.length,
    });
    return;
  }

  // ---- Anonimización ----
  // NULL los 7 fields PII personales. KEEP calle/altura/cp/localidad/provincia/pais.
  const updated = await prisma.direccion.updateMany({
    where: { id: { in: destinoIds } },
    data: {
      nombre: null,
      documento: null,
      telefono: null,
      email: null,
      piso: null,
      dpto: null,
      observacion: null,
    },
  });

  // empresaId para el audit: viene de cualquier envío matched (todos comparten
  // la empresa del store por invariant del labels flow).
  const empresaId = envios[0].empresaId;

  await prisma.auditoriaConfiguracion
    .create({
      data: {
        empresaId,
        campo: "lgpd:customers_redact",
        valorAnterior: `${destinoIds.length} direcciones destino con PII (nombre/doc/tel/email/piso/dpto/observacion)`,
        valorNuevo: `PII anonimizada (7 fields → null); datos postales conservados (calle/altura/cp/localidad/provincia/pais); ${envios.length} envíos afectados; tickets de soporte RETENIDOS por política (historial operativo)`,
        motivo: `LGPD customers/redact de Tiendanube (storeId=${storeId})`,
      },
    })
    .catch((auditErr) =>
      // Que el audit falle NO revierte la anonimización — la anonimización es
      // lo que importa para compliance. Loguear para investigación posterior.
      console.error("[lgpd customers/redact] audit no persistió (post-update):", {
        storeId,
        empresaId,
        err: String(auditErr).slice(0, 300),
      }),
    );

  console.log("[lgpd customers/redact] anonimización completa:", {
    storeId,
    envios: envios.length,
    direccionesAnonimizadas: updated.count,
  });
}
