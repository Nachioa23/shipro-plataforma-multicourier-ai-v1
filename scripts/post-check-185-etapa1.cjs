// =============================================================================
// DEUDA 185 ETAPA 1 — Post-deploy sanity check (READ-ONLY).
//
// Correr DESPUÉS de `prisma migrate deploy` en prod. Verifica que el backfill
// cuadra con el diagnóstico pre-deploy:
//   - 42 filas Direccion totales (de las cuales ~5 CONTACTO + ~37 SNAPSHOT_ORIGEN).
//   - Los 5 CONTACTO tienen emails distintos (unique parcial validado).
//   - ContactoEmpresa poblada: una fila por (empresa, direccion-destino) con envío.
//   - El índice parcial existe con la expresión correcta.
//
// Uso: desde la raíz del proyecto, con DATABASE_URL apuntando a prod:
//   node scripts/post-check-185-etapa1.cjs
//
// NO escribe nada. Si cualquier verificación falla, imprime el delta y exit 1.
// =============================================================================

const { PrismaClient } = require("@prisma/client");

(async () => {
  const p = new PrismaClient();
  let fail = false;

  try {
    const byTipo = await p.$queryRawUnsafe(
      `SELECT "tipo", COUNT(*)::int AS n FROM "Direccion" GROUP BY "tipo" ORDER BY "tipo"`,
    );
    const total = byTipo.reduce((s, r) => s + r.n, 0);
    console.log(`[post-check] Direccion total: ${total}`);
    for (const r of byTipo) console.log(`[post-check]   ${r.tipo}: ${r.n}`);

    // Diagnóstico pre-deploy prod: 42 totales, 37 sin email, 5 con email únicos.
    // Esperado: ~5 CONTACTO (los que tenían envíos de destino con email) + ~37 SNAPSHOT_ORIGEN.
    const nContacto = byTipo.find((r) => r.tipo === "CONTACTO")?.n ?? 0;
    const nOrigen = byTipo.find((r) => r.tipo === "SNAPSHOT_ORIGEN")?.n ?? 0;
    if (total !== 42) {
      console.warn(`[post-check] ⚠ total ≠ 42 (diagnóstico pre-deploy). Investigar deltas.`);
    }
    if (nContacto < 1 || nContacto > 10) {
      console.warn(`[post-check] ⚠ CONTACTO=${nContacto} fuera del rango esperado (~5).`);
    }
    if (nOrigen < 20) {
      console.warn(`[post-check] ⚠ SNAPSHOT_ORIGEN=${nOrigen} inesperadamente bajo.`);
    }

    const uniqueContactos = await p.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT email)::int AS u, COUNT(*)::int AS t
       FROM "Direccion" WHERE "tipo"='CONTACTO' AND email IS NOT NULL`,
    );
    const u = uniqueContactos[0].u;
    const t = uniqueContactos[0].t;
    console.log(`[post-check] CONTACTO con email: ${t} filas, ${u} emails únicos`);
    if (u !== t) {
      console.error(`[post-check] ✗ FAIL: ${t - u} email(s) duplicado(s) entre CONTACTOs. El unique parcial NO debería haber permitido esto.`);
      fail = true;
    }

    const ceCount = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "ContactoEmpresa"`,
    );
    console.log(`[post-check] ContactoEmpresa rows: ${ceCount[0].n}`);

    // Sanity: cada ContactoEmpresa.direccionId debe apuntar a una Direccion.tipo='CONTACTO'.
    const orphanAccess = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "ContactoEmpresa" ce
       JOIN "Direccion" d ON d.id = ce."direccionId"
       WHERE d."tipo" <> 'CONTACTO'`,
    );
    console.log(`[post-check] ContactoEmpresa apuntando a NO-CONTACTO: ${orphanAccess[0].n} (esperado 0)`);
    if (orphanAccess[0].n > 0) {
      console.error(`[post-check] ✗ FAIL: hay ContactoEmpresa.direccionId apuntando a filas tipo<>CONTACTO.`);
      fail = true;
    }

    // Sanity: cada (empresa, direccion) con envío de destino tiene ContactoEmpresa.
    const missingAccess = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT DISTINCT e."empresaId", e."destinoId"
         FROM "Envio" e
         WHERE e."destinoId" IS NOT NULL AND e."empresaId" IS NOT NULL
       ) tuplas
       WHERE NOT EXISTS (
         SELECT 1 FROM "ContactoEmpresa" ce
         WHERE ce."empresaId" = tuplas."empresaId"
           AND ce."direccionId" = tuplas."destinoId"
       )`,
    );
    console.log(`[post-check] (empresa, destino) sin ContactoEmpresa: ${missingAccess[0].n} (esperado 0)`);
    if (missingAccess[0].n > 0) {
      console.error(`[post-check] ✗ FAIL: hay envíos con destino cuya tupla (empresaId, destinoId) no quedó en ContactoEmpresa.`);
      fail = true;
    }

    // Partial unique index existe + predicate correcto.
    const idx = await p.$queryRawUnsafe(
      `SELECT indexdef FROM pg_indexes WHERE indexname='Direccion_email_contacto_key'`,
    );
    if (idx.length === 0) {
      console.error(`[post-check] ✗ FAIL: índice parcial Direccion_email_contacto_key no existe.`);
      fail = true;
    } else {
      console.log(`[post-check] partial unique index: ${idx[0].indexdef}`);
      if (!/WHERE/.test(idx[0].indexdef)) {
        console.error(`[post-check] ✗ FAIL: el índice existe pero NO es parcial (sin WHERE).`);
        fail = true;
      }
    }

    if (fail) {
      console.error(`\n[post-check] RESULT: ✗ FALLÓ (revisar logs arriba).`);
      process.exit(1);
    } else {
      console.log(`\n[post-check] RESULT: ✓ OK — Etapa 1 cuadra con el diagnóstico pre-deploy.`);
      process.exit(0);
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error(`[post-check] error inesperado:`, e);
  process.exit(2);
});
