// ============================================================================
// DEUDA 104 — LGPD customers/redact para Tiendanube.
// DEUDA 185 ETAPA 4 (2026-10-07) — reescrito para OPCIÓN B del modelo de
// contacto compartido con acceso per-empresa (Etapas 1-3):
//
//   El store Tiendanube es DATA CONTROLLER de SU comprador. Shipro es
//   PROCESSOR. Un pedido de redact de ese store NO debe nullear la PII del
//   contacto para otras empresas que también le vendieron al mismo buyer —
//   cada una tiene su propio controller con su propio ciclo de redact.
//
//   Política Opción B:
//     1. Quitar el ACCESO: delete ContactoEmpresa(empresaId_del_store, direccionId).
//        El store deja de ver al contacto en su directorio (Etapa 3).
//     2. Si al contacto le quedan OTRAS empresas con acceso: KEEP la Direccion
//        + sus datos. Las otras empresas lo siguen viendo con la data que
//        tenían al momento (edits propagan por diseño).
//     3. Si NO queda ningún acceso (último retiro): NULL la PII del shared
//        Direccion — el contacto quedó huérfano, nadie lo va a volver a mirar,
//        es seguro anonimizar.
//
//   NULL en caso de orfandad (persona desaparece):
//     nombre, documento, telefono, email, piso, dpto, observacion
//
//   KEEP SIEMPRE (datos postales anonimizados):
//     calle, altura, cp, localidad, provincia, pais
//     — se preservan para dashboards de Torre/métricas geográficas; sin
//       identidad linkeada dejan de ser PII.
//
//   Edge: nullear email en un CONTACTO huérfano saca la fila del índice
//   parcial Direccion_email_contacto_key (WHERE email IS NOT NULL) sin
//   colisión. El tipo queda en CONTACTO (anonimizado); si el mismo email
//   vuelve en el futuro (otro comprador, otra empresa), crear.ts creará
//   una fila CONTACTO nueva (el índice parcial permite email NULL repetido).
//
// SCOPE (invariantes):
//   - SOLO se tocan Direcciones referenciadas via `envio.destino` (NUNCA
//     `envio.origen`, que son snapshots de depósito del seller).
//   - NUNCA se borra el envío ni los registros financieros (iron rule Nacho).
//   - Los tickets de soporte NO se scrubbean (política: historial operativo).
//
// MATCH (dos vías, se une el resultado):
//   - PRIMARIO por order_id: (storeId, tiendanubeOrderId IN orders_to_redact).
//   - FALLBACK por buyer PII: (storeId, destino.email=X OR destino.documento=Y).
//
// IDEMPOTENCIA (post-Opción B):
//   Guard previo: contar ContactoEmpresa de ESTA empresa para los destinoIds
//   matched. Si son 0 → esta empresa ya no tiene acceso → es retry sobre un
//   redact ya aplicado → skip. Reintentos de Tiendanube (16× en 48h) son
//   no-ops limpios.
//
// ATOMICIDAD:
//   El delete-de-acceso + el nulling-de-huérfanos corre en una $transaction.
//   Si algo falla a mitad, Postgres rolea back; un orfano no puede quedarse
//   con PII por un crash entre pasos.
//
// AUDIT (compliance proof):
//   Una fila en AuditoriaConfiguracion con campo="lgpd:customers_redact",
//   counts + nota sobre acceso vs anonimización. NO PII del comprador.
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

  // empresaId del store (invariant: todos los envíos matched comparten la
  // empresa del store). Usado para scope-ear el acceso + el audit.
  const empresaId = envios[0].empresaId;

  // ---- Idempotency guard (OPCIÓN B) ----
  // ¿Esta empresa todavía tiene algún acceso a los contactos matched? Si no,
  // es retry sobre un redact ya aplicado para esta empresa → skip.
  const accesosEmpresa = await prisma.contactoEmpresa.findMany({
    where: { empresaId, direccionId: { in: destinoIds } },
    select: { direccionId: true },
  });
  if (accesosEmpresa.length === 0) {
    console.log("[lgpd customers/redact] retry sobre redact ya aplicado para esta empresa — skip:", {
      storeId,
      empresaId,
      destinoIds: destinoIds.length,
      envios: envios.length,
    });
    return;
  }

  const direccionIdsConAcceso = accesosEmpresa.map((a) => a.direccionId);

  // ---- Delete access + null orphans (atomic) ----
  // El delete + el null corren en la misma $transaction para que un crash
  // intermedio no deje un contacto huérfano con PII. Si falla el null tras
  // el delete, Postgres rollea back el delete también (si re-aplica más
  // tarde, idempotency guard arriba lo detecta limpio).
  const resultado = await prisma.$transaction(async (tx) => {
    // 1. Quitar el acceso de ESTA empresa a los contactos matched.
    const deleted = await tx.contactoEmpresa.deleteMany({
      where: { empresaId, direccionId: { in: direccionIdsConAcceso } },
    });

    // 2. ¿Qué contactos quedaron HUÉRFANOS (ninguna otra empresa con acceso)?
    const sobrevivientes = await tx.contactoEmpresa.findMany({
      where: { direccionId: { in: direccionIdsConAcceso } },
      select: { direccionId: true },
    });
    const vivasIds = new Set(sobrevivientes.map((c) => c.direccionId));
    const huerfanos = direccionIdsConAcceso.filter((id) => !vivasIds.has(id));

    // 3. Para los huérfanos: NULL los 7 fields PII (persona desaparece). KEEP
    //    calle/altura/cp/localidad/provincia/pais.
    let anonimizados = 0;
    if (huerfanos.length > 0) {
      const updated = await tx.direccion.updateMany({
        where: { id: { in: huerfanos } },
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
      anonimizados = updated.count;
    }

    return { accesosRemovidos: deleted.count, anonimizados, huerfanosCount: huerfanos.length };
  });

  // ---- Audit (compliance proof) ----
  await prisma.auditoriaConfiguracion
    .create({
      data: {
        empresaId,
        campo: "lgpd:customers_redact",
        valorAnterior: `${direccionIdsConAcceso.length} contactos con acceso de esta empresa (vía ContactoEmpresa)`,
        valorNuevo: `${resultado.accesosRemovidos} accesos ContactoEmpresa removidos (Opción B: data controller); ${resultado.anonimizados}/${resultado.huerfanosCount} direcciones huérfanas anonimizadas (PII 7 fields → null, postales conservados); ${envios.length} envíos afectados; tickets de soporte RETENIDOS por política (historial operativo)`,
        motivo: `LGPD customers/redact de Tiendanube (storeId=${storeId})`,
      },
    })
    .catch((auditErr) =>
      // Que el audit falle NO revierte el redact — el redact es lo que importa
      // para compliance. Loguear para investigación posterior.
      console.error("[lgpd customers/redact] audit no persistió (post-update):", {
        storeId,
        empresaId,
        err: String(auditErr).slice(0, 300),
      }),
    );

  console.log("[lgpd customers/redact] redact Opción B completo:", {
    storeId,
    empresaId,
    envios: envios.length,
    accesosRemovidos: resultado.accesosRemovidos,
    direccionesHuerfanas: resultado.huerfanosCount,
    anonimizadas: resultado.anonimizados,
  });
}
