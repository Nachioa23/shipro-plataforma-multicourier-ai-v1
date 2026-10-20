// ============================================================================
// Shopify Fase 4 LGPD — libs de redact (customers/redact + shop/redact).
// Variante Shopify del molde TN (lib/tiendanube/lgpd-redact.ts), aplicando el
// contrato de imports que Chat B necesita + decisión B para shop/redact.
//
// MOLDE: todo lo delicado — modelo de contacto compartido Opción B (DEUDA 185),
// scope de preservación (Envio + MovimientoFinanciero intactos), idempotency
// por retry — ES ESPEJO LITERAL de TN. Diferencias puntuales marcadas inline:
//
//   1. Identificador del store: shopDomain String (no storeId Int). La lib
//      resuelve TiendaShopify adentro — el endpoint pasa shopDomain pelado.
//   2. Match por order: shopifyOrderId String (GID: "gid://shopify/Order/N").
//      Chat B pasa los GIDs ya construidos; se usan literal.
//   3. Match por PII fallback: email OR telefono (Shopify no envía documento).
//
// INVARIANTES (iguales a TN):
//   - SOLO se tocan Direcciones referenciadas vía envio.destino (NUNCA
//     envio.origen — snapshot de depósito del seller).
//   - NUNCA se borra el envío ni ningún registro financiero.
//   - Tickets de soporte RETENIDOS por política.
//
// MATCH (dos vías, union):
//   - PRIMARIO por GID: (tiendaShopifyId, shopifyOrderId IN orderGids).
//   - FALLBACK por buyer PII: (tiendaShopifyId, destino.email=X OR destino.telefono=Y).
//
// IDEMPOTENCIA (post-Opción B):
//   Mismo guard que TN: contar ContactoEmpresa(empresaId, direccionId IN
//   matched). Si 0 → retry sobre redact ya aplicado → skip.
//
// SHOP/REDACT (decisión B, Chat A+B 2026-10-20):
//   TN hace inline en el route: nullea solo accessToken (preserva estado +
//   dominio + nombre + empresaId como "registro histórico"). Shopify tiene
//   MÁS credenciales residuales (accessToken + rateCallbackTokenHash) y además
//   columnas lifecycle que TN no tiene (estado + desinstaladaEn). Esta lib
//   limpia AMBAS credenciales + marca estado/desinstaladaEn IDEMPOTENTEMENTE
//   — si el app/uninstalled del Chat B ya marcó la tienda, este helper actúa
//   como backstop sin pisar la fecha original. Preserva shopDomain/nombre/
//   dominio/empresaId/carrierServiceId/envios/instaladaEn.
// ============================================================================

import prisma from "@/lib/prisma";

// ---- customers/redact ----

export interface RedactCustomerShopifyInput {
  shopDomain: string;
  orderGids: string[];
  email: string | null;
  phone: string | null;
}

export interface RedactCustomerShopifyResult {
  /** Direcciones huérfanas efectivamente anonimizadas (PII → null). */
  anonimizados: number;
  /** Direcciones donde al menos otra empresa conserva acceso → KEEP, NO se nullearon. */
  preservados: number;
}

interface EnvioMinimal {
  id: number;
  destinoId: number | null;
  empresaId: number;
}

export async function redactCustomerShopify(
  input: RedactCustomerShopifyInput,
): Promise<RedactCustomerShopifyResult> {
  const { shopDomain, orderGids, email, phone } = input;

  // ---- Resolver TiendaShopify (reemplaza el lookup por storeId de TN) ----
  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain },
    select: { id: true, empresaId: true },
  });
  if (!tienda) {
    // Store desconocida — no-op silencioso. Mismo criterio que TN cuando no
    // existe TiendaTiendanube: nada que redactar + no podemos auditar sin
    // empresaId.
    console.warn("[lgpd shopify customers/redact] shopDomain desconocido — skip:", { shopDomain });
    return { anonimizados: 0, preservados: 0 };
  }
  const tiendaShopifyId = tienda.id;
  const empresaIdDeTienda = tienda.empresaId;

  // ---- MATCH ----
  const enviosPorId = new Map<number, EnvioMinimal>();

  if (orderGids.length > 0) {
    const primary = await prisma.envio.findMany({
      where: {
        tiendaShopifyId,
        shopifyOrderId: { in: orderGids },
      },
      select: { id: true, destinoId: true, empresaId: true },
    });
    for (const e of primary) enviosPorId.set(e.id, e);
  }

  // Fallback OR — construimos la lista con las condiciones truthy (Prisma
  // rechaza OR: [] vacío). Solo corre la query si hay algo que buscar.
  const orConditions: Array<{ email?: string; telefono?: string }> = [];
  if (email) orConditions.push({ email });
  if (phone) orConditions.push({ telefono: phone });

  if (orConditions.length > 0) {
    const fallback = await prisma.envio.findMany({
      where: {
        tiendaShopifyId,
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
  if (envios.length === 0) {
    console.warn("[lgpd shopify customers/redact] sin envíos matched:", {
      shopDomain,
      orderGids: orderGids.length,
      byEmail: !!email,
      byPhone: !!phone,
    });
    await prisma.auditoriaConfiguracion
      .create({
        data: {
          empresaId: empresaIdDeTienda,
          campo: "shopify:customers_redact",
          valorAnterior: "0 envíos matched",
          valorNuevo:
            "request recibido y auditado; sin envíos que anonimizar; tickets de soporte no aplican",
          motivo: `LGPD customers/redact de Shopify (shopDomain=${shopDomain}) — sin matches`,
        },
      })
      .catch((auditErr) =>
        console.error("[lgpd shopify customers/redact] audit no persistió (no-matches):", {
          shopDomain,
          err: String(auditErr).slice(0, 300),
        }),
      );
    return { anonimizados: 0, preservados: 0 };
  }

  // empresaId del store (invariant: todos los envíos matched comparten la
  // empresa de la tienda). Usado para scope-ear acceso + audit.
  const empresaId = envios[0].empresaId;

  // ---- Idempotency guard (Opción B) ----
  const accesosEmpresa = await prisma.contactoEmpresa.findMany({
    where: { empresaId, direccionId: { in: destinoIds } },
    select: { direccionId: true },
  });
  if (accesosEmpresa.length === 0) {
    console.log("[lgpd shopify customers/redact] retry sobre redact ya aplicado para esta empresa — skip:", {
      shopDomain,
      empresaId,
      destinoIds: destinoIds.length,
      envios: envios.length,
    });
    return { anonimizados: 0, preservados: 0 };
  }

  const direccionIdsConAcceso = accesosEmpresa.map((a) => a.direccionId);

  // ---- Delete access + null orphans (atomic) ----
  const resultado = await prisma.$transaction(async (tx) => {
    const deleted = await tx.contactoEmpresa.deleteMany({
      where: { empresaId, direccionId: { in: direccionIdsConAcceso } },
    });

    const sobrevivientes = await tx.contactoEmpresa.findMany({
      where: { direccionId: { in: direccionIdsConAcceso } },
      select: { direccionId: true },
    });
    const vivasIds = new Set(sobrevivientes.map((c) => c.direccionId));
    const huerfanos = direccionIdsConAcceso.filter((id) => !vivasIds.has(id));

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

    return {
      accesosRemovidos: deleted.count,
      anonimizados,
      huerfanosCount: huerfanos.length,
      preservadosCount: direccionIdsConAcceso.length - huerfanos.length,
    };
  });

  // ---- Audit ----
  await prisma.auditoriaConfiguracion
    .create({
      data: {
        empresaId,
        campo: "shopify:customers_redact",
        valorAnterior: `${direccionIdsConAcceso.length} contactos con acceso de esta empresa (vía ContactoEmpresa)`,
        valorNuevo: `${resultado.accesosRemovidos} accesos ContactoEmpresa removidos (Opción B: data controller); ${resultado.anonimizados}/${resultado.huerfanosCount} direcciones huérfanas anonimizadas (PII 7 fields → null, postales conservados); ${resultado.preservadosCount} direcciones preservadas (otras empresas conservan acceso); ${envios.length} envíos afectados; tickets de soporte RETENIDOS por política (historial operativo)`,
        motivo: `LGPD customers/redact de Shopify (shopDomain=${shopDomain})`,
      },
    })
    .catch((auditErr) =>
      console.error("[lgpd shopify customers/redact] audit no persistió (post-update):", {
        shopDomain,
        empresaId,
        err: String(auditErr).slice(0, 300),
      }),
    );

  console.log("[lgpd shopify customers/redact] redact Opción B completo:", {
    shopDomain,
    empresaId,
    envios: envios.length,
    accesosRemovidos: resultado.accesosRemovidos,
    direccionesHuerfanas: resultado.huerfanosCount,
    anonimizadas: resultado.anonimizados,
    preservadas: resultado.preservadosCount,
  });

  return {
    anonimizados: resultado.anonimizados,
    preservados: resultado.preservadosCount,
  };
}

// ---- shop/redact (DECISIÓN B — purga credenciales + lifecycle idempotente) ----

export interface RedactShopShopifyInput {
  shopDomain: string;
}

export async function redactShopShopify(input: RedactShopShopifyInput): Promise<void> {
  const { shopDomain } = input;

  const tienda = await prisma.tiendaShopify.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      empresaId: true,
      accessToken: true,
      rateCallbackTokenHash: true,
      estado: true,
      desinstaladaEn: true,
    },
  });

  if (!tienda) {
    // Store desconocida — nunca se registró en Shipro vía OAuth. No-op
    // silencioso para que Shopify no reintente contra nada.
    console.warn("[lgpd shopify shop/redact] shopDomain desconocido, no-op:", { shopDomain });
    return;
  }

  // Idempotencia por-retry: si YA está todo purgado (ambas credenciales null
  // y estado desinstalada), skip. Deja debugging observable en logs.
  const yaPurgado =
    tienda.accessToken == null &&
    tienda.rateCallbackTokenHash == null &&
    tienda.estado === "desinstalada";
  if (yaPurgado) {
    console.log("[lgpd shopify shop/redact] ya purgado (retry) — skip:", {
      shopDomain,
      tiendaId: tienda.id,
    });
    return;
  }

  // Lifecycle idempotente: solo pisar `desinstaladaEn` si NO estaba seteado
  // (el app/uninstalled del Chat B lo marca primero cuando llega; este helper
  // actúa como backstop por si el app/uninstalled nunca llegó).
  // `estado` sí se fuerza a "desinstalada" — es un string canónico, no una
  // fecha; sobreescribir un estado "suspendida"/"instalada" por "desinstalada"
  // es lo correcto en este webhook.
  await prisma.tiendaShopify.update({
    where: { shopDomain },
    data: {
      accessToken: null,
      rateCallbackTokenHash: null,
      estado: "desinstalada",
      ...(tienda.desinstaladaEn == null ? { desinstaladaEn: new Date() } : {}),
    },
  });

  // Audit compliance proof — NO poner PII/token en los campos.
  await prisma.auditoriaConfiguracion
    .create({
      data: {
        empresaId: tienda.empresaId,
        campo: "shopify:shop_redact",
        valorAnterior:
          `accessToken=${tienda.accessToken ? "presente" : "null"}; ` +
          `rateCallbackTokenHash=${tienda.rateCallbackTokenHash ? "presente" : "null"}; ` +
          `estado=${tienda.estado}; ` +
          `desinstaladaEn=${tienda.desinstaladaEn ? "ya seteado" : "null"}`,
        valorNuevo:
          "accessToken + rateCallbackTokenHash purgados (vínculo Shopify cortado); " +
          "estado=desinstalada; " +
          `desinstaladaEn=${tienda.desinstaladaEn ? "preservado (app/uninstalled lo marcó primero)" : "seteado ahora (backstop)"}; ` +
          "cuenta + historial conservados",
        motivo: `LGPD shop/redact de Shopify (shopDomain=${shopDomain})`,
      },
    })
    .catch((auditErr) =>
      console.error("[lgpd shopify shop/redact] audit no persistió:", {
        shopDomain,
        err: String(auditErr).slice(0, 300),
      }),
    );

  console.log("[lgpd shopify shop/redact] credenciales purgadas + lifecycle marcado:", {
    shopDomain,
    tiendaId: tienda.id,
    desinstaladaEnPreservado: tienda.desinstaladaEn != null,
  });
}
