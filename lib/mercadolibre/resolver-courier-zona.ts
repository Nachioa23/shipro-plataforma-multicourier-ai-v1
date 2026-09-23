// ============================================================================
// MEF Fase 2.3.a (2026-09-22) — Resolver PURO: CP → zona Flex activa → courier
// asignado. [[DEUDA 180]]
//
// Dado un `empresaId` (Shipro) + un `codigoPostal` (destino del envío ML Flex),
// devuelve el courier que el cliente asignó a la zona ML que cubre ese CP.
//
// Cadena de resolución:
//   Empresa
//     └── CuentaMercadoLibre (por empresaId @unique)
//           └── CuentaMercadoLibreZona (enabled=true) ← ⚠️ FILTRO ACTIVE ANTES DE MATCHEAR
//                 └── CuentaMercadoLibreZonaCp (codigoPostal = cp)
//   +
//   AsignacionCourierZonaFlex (empresaId, zoneIdMl @@unique) → Courier
//
// GARANTÍAS DE ML (confirmadas por GN + Chat D):
//   - Los CPs son DISJUNTOS entre zonas ACTIVAS. Un CP dado matchea 0 o 1 zona
//     enabled=true. No hay tie-break porque no puede haber empate.
//   - Un CP PUEDE aparecer en una zona `enabled=false` (el vendedor la
//     deshabilitó pero conservó los CPs). Por eso el filtro `enabled=true`
//     va DENTRO de la query — si dejáramos afuera el filtro, una zona
//     desactivada podría rutear un CP que sí tiene cobertura Flex activa en
//     OTRA zona (misma cuenta), y elegiríamos mal.
//
// PURO: solo lee + retorna. NO crea envíos, NO toca plata, NO persiste. NO
// tiene side-effects más allá de un `console.warn` defensivo en el caso
// (que GN dice que no puede pasar) de >1 zona activa matcheando el mismo CP.
//
// Variantes tipadas (discriminated union sobre ok/motivo):
//   - { ok: true, ... }                       — feliz: hay courier asignado.
//   - { ok: false, motivo: "sin_cuenta_ml" }  — la empresa no tiene cuenta ML
//                                                vinculada (OAuth incompleto).
//   - { ok: false, motivo: "cp_no_matchea" } — ninguna zona ACTIVA cubre el
//                                                CP (fuera de cobertura Flex,
//                                                o solo lo cubre una zona
//                                                deshabilitada).
//   - { ok: false, motivo: "zona_sin_courier",
//       zoneIdMl, zonaNombre }                — matcheó una zona activa pero
//                                                el cliente no le asignó
//                                                courier todavía (estado
//                                                "acción requerida" en 2.2).
//   - { ok: false, motivo: "input_invalido" }  — cp vacío/basura.
// ============================================================================

import prisma from "@/lib/prisma";

export type ResolucionCourierZonaFlex =
  | {
      ok: true;
      courierId: number;
      courierNombre: string;
      zoneIdMl: string;
      zonaNombre: string;
    }
  | { ok: false; motivo: "input_invalido" }
  | { ok: false; motivo: "sin_cuenta_ml" }
  // sin_zonas_flex — la cuenta ML NO tiene zonas activas configuradas (el
  // vendedor no seteó Flex en el portal ML, o deshabilitó todas). Distinto
  // de cp_no_matchea (donde SÍ hay zonas activas pero ninguna cubre el CP).
  // Habilitado por Chat D para que 2.3.c pueda dar UX diferenciado ("configurá
  // Flex primero" vs "este CP está fuera de tu cobertura").
  | { ok: false; motivo: "sin_zonas_flex" }
  | { ok: false; motivo: "cp_no_matchea" }
  | {
      ok: false;
      motivo: "zona_sin_courier";
      zoneIdMl: string;
      zonaNombre: string;
    }
  // anomalo — GN garantiza que CPs son disjuntos entre zonas ACTIVAS de una
  // cuenta. Si aparece >1 match acá, algo anda mal (drift entre ML y nuestro
  // sync, o contrato ML cambió). Fail-fast: NO ruteamos determinístico — se
  // reporta el caso y el caller crea un envío BLOQUEADO "flex_anomalo" para
  // que quede visible. Política Chat D 2026-09-23: nunca elegir a ciegas.
  | { ok: false; motivo: "anomalo"; zoneIds: string[] };

/**
 * Resuelve el courier que despacha un envío Flex dado el CP de destino + la
 * empresa Shipro. Devuelve una variante tipada — el caller decide qué hacer
 * con cada rama (crear envío / marcar bloqueado / fallback / etc). El helper
 * mismo NO tiene efectos.
 *
 * @param empresaId - Shipro empresa id (uniqueness via CuentaMercadoLibre.empresaId).
 * @param codigoPostal - CP destino del shipment ML (se sanitiza acá con la
 *   misma regla que usó el sync al persistir: `String(cp).trim()`).
 */
export async function resolverCourierPorCpFlex(
  empresaId: number,
  codigoPostal: string,
): Promise<ResolucionCourierZonaFlex> {
  // 1. Normalización simétrica al sync (lib/mercadolibre/sync-zonas.ts L152-157):
  //    String(...).trim(); string vacía → input inválido. Sin lower-case ni
  //    zero-padding — los CPs argentinos son numéricos, y si el vendedor cargó
  //    "1000" en ML pero el shipment trae "01000", el mismatch es real (no
  //    algo que el helper deba enmascarar silenciosamente).
  const cp = String(codigoPostal ?? "").trim();
  if (cp.length === 0) {
    return { ok: false, motivo: "input_invalido" };
  }

  // 2. Resolver la cuenta ML de la empresa. Sin cuenta = OAuth incompleto o
  //    revocado — Fase 3 debería re-checkear estado antes de intentar la
  //    creación de envío, pero acá reportamos el motivo específico para que
  //    el caller distinga esto de "sin cobertura Flex".
  const cuenta = await prisma.cuentaMercadoLibre.findUnique({
    where: { empresaId },
    select: { id: true },
  });
  if (!cuenta) {
    return { ok: false, motivo: "sin_cuenta_ml" };
  }

  // 3. Pre-check sin_zonas_flex: ¿la cuenta tiene alguna zona ACTIVA? Si no,
  //    la variante es sin_zonas_flex (el vendedor no configuró Flex, o
  //    deshabilitó todas). Distinto de cp_no_matchea (hay zonas activas pero
  //    ninguna cubre el CP). Chat D pidió separar para UX diferenciado.
  const totalZonasActivas = await prisma.cuentaMercadoLibreZona.count({
    where: { cuentaMercadoLibreId: cuenta.id, enabled: true },
  });
  if (totalZonasActivas === 0) {
    return { ok: false, motivo: "sin_zonas_flex" };
  }

  // 4. Buscar la zona ACTIVA (enabled=true) que cubre el CP. El filtro sobre
  //    `zona.enabled=true` va DENTRO del where — nunca matcheamos contra una
  //    zona desactivada aunque tenga el CP en su lista. GN garantiza 0 o 1
  //    match entre zonas activas.
  //
  //    Query pattern: buscamos las filas Cp que coinciden con el cp Y
  //    pertenecen a una zona activa de ESTA cuenta. Traemos la zona anidada
  //    para el pivot zoneIdMl.
  const matches = await prisma.cuentaMercadoLibreZonaCp.findMany({
    where: {
      codigoPostal: cp,
      zona: {
        cuentaMercadoLibreId: cuenta.id,
        enabled: true,
      },
    },
    select: {
      zona: {
        select: { zoneIdMl: true, nombre: true },
      },
    },
  });

  if (matches.length === 0) {
    return { ok: false, motivo: "cp_no_matchea" };
  }

  // 5. Defense-in-depth: GN afirma que zonas activas tienen CPs disjuntos —
  //    NUNCA debería haber >1 match acá. Política Chat D 2026-09-23:
  //    FAIL-FAST si aparece — NO elegir determinístico + warn (política vieja
  //    del 2026-09-22 que enmascaraba el problema). El caller debe crear un
  //    envío BLOQUEADO con causa "flex_anomalo" para que el drift quede
  //    visible + accionable, no ruteado silenciosamente al azar.
  if (matches.length > 1) {
    const zoneIds = matches.map((m) => m.zona.zoneIdMl);
    console.error(
      `[resolverCourierPorCpFlex] 🚨 CP ${cp} matcheó ${matches.length} zonas activas para empresaId=${empresaId} (GN garantiza disjuntos entre activas) — FAIL-FAST, no ruteo. zoneIds=${JSON.stringify(zoneIds)}`,
    );
    return { ok: false, motivo: "anomalo", zoneIds };
  }
  const elegida = matches[0].zona;

  // 5. Lookup de la asignación por el @@unique (empresaId, zoneIdMl). Sin
  //    asignación = "acción requerida" — el cliente ve la zona en rojo en la
  //    pantalla Fase 2.2 y todavía no eligió courier.
  const asignacion = await prisma.asignacionCourierZonaFlex.findUnique({
    where: {
      empresaId_zoneIdMl: {
        empresaId,
        zoneIdMl: elegida.zoneIdMl,
      },
    },
    select: {
      courierId: true,
      courier: { select: { nombre: true } },
    },
  });

  if (!asignacion) {
    return {
      ok: false,
      motivo: "zona_sin_courier",
      zoneIdMl: elegida.zoneIdMl,
      zonaNombre: elegida.nombre,
    };
  }

  return {
    ok: true,
    courierId: asignacion.courierId,
    courierNombre: asignacion.courier.nombre,
    zoneIdMl: elegida.zoneIdMl,
    zonaNombre: elegida.nombre,
  };
}
