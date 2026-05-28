// =============================================================================
// DEUDA 32+37: Sincronizacion de cobertura de sucursales por courier.
// =============================================================================
//
// Funcion reutilizable que sincroniza SucursalCourier + SucursalCourierCp para
// un courier dado. La consumen el boton manual del drawer (admin-couriers) y el
// endpoint cron-via-HTTP (/api/cron/sincronizar-couriers).
//
// Cada courier que tiene API publica de sucursales declara su "fuente" en el
// mapa FUENTES_SUCURSALES de abajo. Couriers sin fuente (ej: Moci's, que no
// tiene red de sucursales) devuelven { aplica: false } — no es error.
//
// La logica de sync (upsert + soft-delete + 5% tolerance) se preserva intacta
// del script original sincronizar-sucursales-andreani.ts (probada en dev).
// =============================================================================

import prisma from "@/lib/prisma";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";

// -----------------------------------------------------------------------------
// FUENTES — declaracion por courier de "tengo API publica de sucursales".
// Cada fuente declara: la URL, y una funcion parse que mapea la respuesta cruda
// a la forma comun que el sincronizador consume.
// Couriers sin entrada aca = no aplica (no error).
// -----------------------------------------------------------------------------

interface SucursalNormalizada {
  idExterno: string;
  codigo: string | null;
  nombre: string;
  tipo: string;
  direccionCalle: string | null;
  direccionAltura: string | null;
  codigoPostal: string;
  localidad: string;
  provincia: string;
  pais: string;
  latitud: number | null;
  longitud: number | null;
  aceptaAdmision: boolean;
  aceptaEntrega: boolean;
  aceptaDevolucion: boolean;
  aceptaB2B: boolean;
  aceptaB2C: boolean;
  tieneBuzonInteligente: boolean;
  seHaceAtencionAlCliente: boolean;
  horariosJson: any;
  telefono: string | null;
  email: string | null;
  codigosPostalesAtendidos: string[];
}

interface FuenteSucursales {
  url: string;
  fetch: () => Promise<SucursalNormalizada[]>;
}

// Endpoint publico de Andreani — alineado byte-a-byte con la documentacion de
// la integracion. El mapeo replica EXACTO el script
// scripts/sincronizar-sucursales-andreani.ts (probado en dev, 154 sucursales
// sincronizadas correctamente). NO improvisar nombres de campo aca: leer el
// script y matchear.
async function fetchAndreani(): Promise<SucursalNormalizada[]> {
  const url = "https://apis.andreani.com/v2/sucursales";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Andreani /v2/sucursales devolvio HTTP ${res.status}`);
  }
  const crudas: any[] = await res.json();

  // Filtro: B2C + seHaceAtencionAlCliente (anidado en datosAdicionales).
  const filtradas = crudas.filter(
    (s) => s.canal === "B2C" && s.datosAdicionales?.seHaceAtencionAlCliente === true
  );

  return filtradas.map((suc) => {
    // Coordenadas vienen en suc.coordenadas (no en suc.direccion).
    const lat = parseFloat(suc.coordenadas?.latitud ?? "");
    const lng = parseFloat(suc.coordenadas?.longitud ?? "");
    const telCrudo = (suc.telefonos?.[0] || "").trim();

    // CPs: dedupe + trim + filter empties (mismo que el script).
    const cpsCrudos = suc.codigosPostalesAtendidos;
    const cpsNuevos = Array.isArray(cpsCrudos)
      ? Array.from(new Set(cpsCrudos.map((cp: any) => String(cp).trim()).filter(Boolean)))
      : [];

    return {
      idExterno: String(suc.id),
      codigo: suc.codigo || null,
      nombre: suc.descripcion || "Sin nombre",
      tipo: "sucursal_propia",
      direccionCalle: suc.direccion?.calle || null,
      direccionAltura: suc.direccion?.numero || null,
      codigoPostal: suc.direccion?.codigoPostal || "",
      localidad: suc.direccion?.localidad || "",
      provincia: suc.direccion?.provincia || "",
      pais: suc.direccion?.pais || "Argentina",
      latitud: isFinite(lat) ? lat : null,
      longitud: isFinite(lng) ? lng : null,
      aceptaAdmision: suc.datosAdicionales?.admiteEnvios ?? false,
      aceptaEntrega: suc.datosAdicionales?.entregaEnvios ?? false,
      aceptaDevolucion: false,
      aceptaB2B: suc.canal === "B2B",
      aceptaB2C: suc.canal === "B2C",
      tieneBuzonInteligente: suc.datosAdicionales?.conBuzonInteligente ?? false,
      seHaceAtencionAlCliente: true,
      horariosJson: suc.horarioDeAtencion || null,
      telefono: telCrudo || null,
      email: null,
      codigosPostalesAtendidos: cpsNuevos,
    };
  });
}

const FUENTES_SUCURSALES: Record<string, FuenteSucursales> = {
  andreani: {
    url: "https://apis.andreani.com/v2/sucursales",
    fetch: fetchAndreani,
  },
  // Couriers sin entrada -> no aplica (no error).
};

// -----------------------------------------------------------------------------
// RESULTADO — forma que devuelve la funcion (estructurado, NO process.exit).
// -----------------------------------------------------------------------------

export interface ResultadoSync {
  courierId: number;
  courierNombre: string;
  aplica: boolean;          // false = no hay fuente declarada para este courier
  ok: boolean;              // true = sync OK (o no aplica); false = excedio tolerancia
  procesadas: number;
  exitosas: number;
  errores: number;
  softDeleted: number;
  tasaErrorPct: number;
  motivo?: string;          // explicacion si no aplica o si fallo
  duracionMs?: number;
}

// -----------------------------------------------------------------------------
// FUNCION PRINCIPAL
// -----------------------------------------------------------------------------

const TOLERANCIA_ERROR_PCT = 5;

export async function sincronizarCoberturaCourier(courierId: number): Promise<ResultadoSync> {
  const t0 = Date.now();
  const courier = await prisma.courier.findUnique({ where: { id: courierId } });
  if (!courier) {
    return {
      courierId, courierNombre: "(desconocido)", aplica: false, ok: false,
      procesadas: 0, exitosas: 0, errores: 0, softDeleted: 0, tasaErrorPct: 0,
      motivo: `Courier id=${courierId} no encontrado`,
      duracionMs: Date.now() - t0,
    };
  }

  const claveCourier = normalizarParaComparacion(courier.nombre);
  const fuente = FUENTES_SUCURSALES[claveCourier];
  if (!fuente) {
    return {
      courierId, courierNombre: courier.nombre, aplica: false, ok: true,
      procesadas: 0, exitosas: 0, errores: 0, softDeleted: 0, tasaErrorPct: 0,
      motivo: `Courier '${courier.nombre}' sin fuente de sucursales declarada (no aplica).`,
      duracionMs: Date.now() - t0,
    };
  }

  // 1) Fetch + parse
  let sucursales: SucursalNormalizada[];
  try {
    sucursales = await fuente.fetch();
  } catch (err: any) {
    return {
      courierId, courierNombre: courier.nombre, aplica: true, ok: false,
      procesadas: 0, exitosas: 0, errores: 0, softDeleted: 0, tasaErrorPct: 100,
      motivo: `Fetch fallo: ${err?.message || String(err)}`,
      duracionMs: Date.now() - t0,
    };
  }

  // 2) Upsert + CP sync (logica preservada del script original).
  const idsExternosVistos: string[] = [];
  let exitosas = 0;
  let errores = 0;

  for (const s of sucursales) {
    try {
      await prisma.$transaction(async (tx) => {
        const suc = await tx.sucursalCourier.upsert({
          where: { courierId_idExterno: { courierId, idExterno: s.idExterno } },
          update: {
            codigo: s.codigo, nombre: s.nombre, tipo: s.tipo,
            direccionCalle: s.direccionCalle, direccionAltura: s.direccionAltura,
            codigoPostal: s.codigoPostal, localidad: s.localidad, provincia: s.provincia,
            pais: s.pais, latitud: s.latitud, longitud: s.longitud,
            aceptaAdmision: s.aceptaAdmision, aceptaEntrega: s.aceptaEntrega,
            aceptaDevolucion: s.aceptaDevolucion, aceptaB2B: s.aceptaB2B,
            aceptaB2C: s.aceptaB2C, tieneBuzonInteligente: s.tieneBuzonInteligente,
            seHaceAtencionAlCliente: s.seHaceAtencionAlCliente,
            horariosJson: s.horariosJson, telefono: s.telefono, email: s.email,
            activa: true, eliminada: false, fechaUltimaConfirmacion: new Date(),
          },
          create: {
            courierId, idExterno: s.idExterno, codigo: s.codigo, nombre: s.nombre,
            tipo: s.tipo, direccionCalle: s.direccionCalle, direccionAltura: s.direccionAltura,
            codigoPostal: s.codigoPostal, localidad: s.localidad, provincia: s.provincia,
            pais: s.pais, latitud: s.latitud, longitud: s.longitud,
            aceptaAdmision: s.aceptaAdmision, aceptaEntrega: s.aceptaEntrega,
            aceptaDevolucion: s.aceptaDevolucion, aceptaB2B: s.aceptaB2B,
            aceptaB2C: s.aceptaB2C, tieneBuzonInteligente: s.tieneBuzonInteligente,
            seHaceAtencionAlCliente: s.seHaceAtencionAlCliente,
            horariosJson: s.horariosJson, telefono: s.telefono, email: s.email,
            activa: true, eliminada: false,
          },
        });
        // CPs: delete-all + create-many (sincronizacion exacta).
        await tx.sucursalCourierCp.deleteMany({ where: { sucursalCourierId: suc.id } });
        if (s.codigosPostalesAtendidos.length > 0) {
          await tx.sucursalCourierCp.createMany({
            data: s.codigosPostalesAtendidos.map((cp) => ({
              sucursalCourierId: suc.id, codigoPostal: cp,
            })),
          });
        }
      });
      idsExternosVistos.push(s.idExterno);
      exitosas++;
    } catch (err: any) {
      console.error(`[sync ${courier.nombre}] error en sucursal ${s.idExterno}:`, err?.message || err);
      errores++;
    }
  }

  // 3) Soft-delete orphans (sucursales que desaparecieron).
  let softDeleted = 0;
  try {
    const r = await prisma.sucursalCourier.updateMany({
      where: { courierId, idExterno: { notIn: idsExternosVistos }, eliminada: false },
      data: { eliminada: true, activa: false },
    });
    softDeleted = r.count;
  } catch (err: any) {
    console.error(`[sync ${courier.nombre}] soft-delete fallo:`, err?.message || err);
  }

  const procesadas = sucursales.length;
  const tasaErrorPct = procesadas > 0 ? (errores * 100) / procesadas : 0;
  const ok = tasaErrorPct <= TOLERANCIA_ERROR_PCT;

  return {
    courierId, courierNombre: courier.nombre, aplica: true, ok,
    procesadas, exitosas, errores, softDeleted, tasaErrorPct,
    motivo: ok
      ? `Sync OK: ${exitosas}/${procesadas} sucursales, ${softDeleted} orfanas marcadas eliminadas.`
      : `Tasa de error ${tasaErrorPct.toFixed(1)}% > tolerancia ${TOLERANCIA_ERROR_PCT}%.`,
    duracionMs: Date.now() - t0,
  };
}

// -----------------------------------------------------------------------------
// HELPER: sincroniza TODOS los couriers con fuente declarada. Lo usa el endpoint
// cron (/api/cron/sincronizar-couriers).
// -----------------------------------------------------------------------------

export async function sincronizarTodosLosCouriers(): Promise<ResultadoSync[]> {
  const couriers = await prisma.courier.findMany({ where: { activo: true } });
  const resultados: ResultadoSync[] = [];
  for (const c of couriers) {
    resultados.push(await sincronizarCoberturaCourier(c.id));
  }
  return resultados;
}
