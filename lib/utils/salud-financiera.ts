// ============================================================================
// HELPER — Salud Financiera de la Operación (Métrica 4.4 Torre de Control)
//
// READ-ONLY. Lee Empresa.saldoActivo/modalidadPago/limiteDescubierto/suspendida
// + MovimientoFinanciero (débitos y créditos) para proyectar consumo diario y
// días-hasta-agotamiento por empresa.
//
// NO escribe nada. NO toca el motor de débito. NO muta saldo. CERO
// create/update/delete/upsert — solo findMany + aggregate + count.
//
// SCOPE-AWARE (mismo patrón que lib/utils/fuga-ruteo.ts):
// - Cliente (modoDios=false): retorna solo su empresa (shape "cliente").
// - Shipro global (modoDios=true, sin filtroEmpresa): retorna todas las
//   empresas + agregado (riesgo, suspensión, consumo total) — shape "shipro".
// - Shipro filtrado (modoDios=true, con filtroEmpresa=N): retorna la lista
//   con 1 elemento (empresa pedida) + agregado sobre esa única empresa.
//
// MODALIDADES:
// - PREPAGO: la empresa carga saldo, los envíos consumen de ahí. Riesgo = se
//   agota el saldo cargado antes de recargar.
// - POSTPAGO: la empresa opera sobre `limiteDescubierto` (línea de crédito).
//   Riesgo = cruzar el umbral de suspensión -(limiteDescubierto × 1.5)
//   (constante `MULTIPLICADOR_SUSPENSION` en lib/utils/suspension-cuenta.ts).
//
// PROYECCIÓN días-hasta-agotamiento (sin div-por-cero):
//   base = saldoActivo + limiteDescubierto
//   consumoDiarioPromedio = SUM(debitos 30d) / 30
//   - Si consumoDiarioPromedio = 0 → null ("N/D — sin consumo reciente").
//   - Si base <= 0 → 0 (ya agotado / en descubierto).
//   - Else → base / consumoDiarioPromedio.
//
// Estado vacío correcto: pre-cliente con 0 movimientos → consumo=0 → N/D.
// ============================================================================

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth-context";
import { MULTIPLICADOR_SUSPENSION } from "@/lib/utils/suspension-cuenta";

const VENTANA_DIAS_CONSUMO = 30;
const VENTANA_DIAS_RECIENTE = 7;

// Tipos de MovimientoFinanciero que cuentan como "consumo" (débito al saldo).
// Grep de escritura en app/lib confirmó estos 2 writers de débito.
const TIPOS_DEBITO = ["DEBITO_ENVIO", "DEBITO_AJUSTE_AFORO"];

export type NivelRiesgo = "ok" | "atencion" | "critico" | "suspendida";

export interface SaludFinancieraEmpresa {
  empresaId: number;
  empresaNombre: string;
  modalidadPago: string; // "PREPAGO" | "POSTPAGO"
  suspendida: boolean;
  saldoActivo: number;
  limiteDescubierto: number;
  umbralSuspension: number; // -(limiteDescubierto × MULTIPLICADOR_SUSPENSION), negativo (o 0).
  distanciaAlUmbral: number; // saldoActivo - umbralSuspension; >0 = sobre el umbral; ≤0 = ya cruzó.
  consumo7d: number; // suma positiva de débitos en los últimos 7 días
  consumo30d: number; // suma positiva de débitos en los últimos 30 días
  consumoDiarioPromedio: number; // consumo30d / 30
  diasHastaAgotamiento: number | null; // null = sin consumo (N/D); 0 = ya agotado.
  riesgo: NivelRiesgo;
}

export interface AgregadoSaludFinanciera {
  totalEmpresas: number;
  empresasPrepago: number;
  empresasPostpago: number;
  empresasSuspendidas: number;
  empresasEnRiesgoCritico: number; // ≤3 días proyectados
  empresasEnAtencion: number; // ≤10 días proyectados
  saldoTotalPositivo: number; // suma de saldoActivo > 0
  deudaTotalNegativa: number; // suma de |saldoActivo < 0|
  consumoDiarioAgregado: number;
  empresasConConsumoReciente: number; // tuvieron al menos 1 débito en 30d
}

export interface CalidadDatosSaludFinanciera {
  ventanaDiasConsumo: number;
  ventanaDiasReciente: number;
  multiplicadorSuspension: number;
  tiposDebito: string[];
  fuente: string;
  notas: string[];
}

export interface ResultadoSaludFinancieraCliente {
  empresa: SaludFinancieraEmpresa;
  calidadDatos: CalidadDatosSaludFinanciera;
  scope: "cliente";
}

export interface ResultadoSaludFinancieraShipro {
  empresas: SaludFinancieraEmpresa[];
  agregado: AgregadoSaludFinanciera;
  calidadDatos: CalidadDatosSaludFinanciera;
  scope: "shipro";
}

export type ResultadoSaludFinanciera =
  | ResultadoSaludFinancieraCliente
  | ResultadoSaludFinancieraShipro;

function clasificarRiesgo(
  suspendida: boolean,
  dias: number | null
): NivelRiesgo {
  if (suspendida) return "suspendida";
  if (dias === null) return "ok"; // sin consumo reciente
  if (dias <= 3) return "critico";
  if (dias <= 10) return "atencion";
  return "ok";
}

function toNumber(d: Prisma.Decimal | number): number {
  return typeof d === "number" ? d : d.toNumber();
}

export async function calcularSaludFinanciera(
  ctx: AuthContext
): Promise<ResultadoSaludFinanciera> {
  const ahora = new Date();
  const inicio30 = new Date(ahora);
  inicio30.setDate(inicio30.getDate() - VENTANA_DIAS_CONSUMO);
  const inicio7 = new Date(ahora);
  inicio7.setDate(inicio7.getDate() - VENTANA_DIAS_RECIENTE);

  // Scope de empresas: cliente ve 1, Shipro ve todas o filtrada.
  const empresaWhere: { id?: number } = {};
  if (!ctx.modoDios) {
    empresaWhere.id = ctx.empresaId as number;
  } else if (ctx.empresaId !== null) {
    empresaWhere.id = ctx.empresaId;
  }

  const empresas = await prisma.empresa.findMany({
    where: empresaWhere,
    select: {
      id: true,
      nombre: true,
      modalidadPago: true,
      suspendida: true,
      saldoActivo: true,
      limiteDescubierto: true,
    },
  });

  // Suma de débitos agrupada por empresa en una sola query (groupBy),
  // tanto para 30d como para 7d.
  const debitos30 = await prisma.movimientoFinanciero.groupBy({
    by: ["empresaId"],
    where: {
      ...(empresaWhere.id ? { empresaId: empresaWhere.id } : {}),
      fecha: { gte: inicio30 },
      tipo: { in: TIPOS_DEBITO },
    },
    _sum: { monto: true },
  });
  const debitos7 = await prisma.movimientoFinanciero.groupBy({
    by: ["empresaId"],
    where: {
      ...(empresaWhere.id ? { empresaId: empresaWhere.id } : {}),
      fecha: { gte: inicio7 },
      tipo: { in: TIPOS_DEBITO },
    },
    _sum: { monto: true },
  });

  const debito30Map = new Map<number, number>();
  for (const row of debitos30) {
    // Nota: monto de DEBITO es POSITIVO en el ledger de Shipro (DEUDA 158 patrón).
    // El código de dispatch persiste el débito como monto positivo + tipo="DEBITO_*",
    // y suma esa cifra al saldo con `increment: -monto` o `decrement: monto`.
    // Para la métrica, usamos la suma tal cual (es el "consumo" en pesos positivos).
    debito30Map.set(row.empresaId, row._sum.monto ? toNumber(row._sum.monto) : 0);
  }
  const debito7Map = new Map<number, number>();
  for (const row of debitos7) {
    debito7Map.set(row.empresaId, row._sum.monto ? toNumber(row._sum.monto) : 0);
  }

  const empresasShape: SaludFinancieraEmpresa[] = empresas.map((e) => {
    const saldo = toNumber(e.saldoActivo);
    const limite = toNumber(e.limiteDescubierto);
    const umbralSuspension = -(limite * MULTIPLICADOR_SUSPENSION);
    const distanciaAlUmbral = saldo - umbralSuspension;

    const consumo30 = debito30Map.get(e.id) ?? 0;
    const consumo7 = debito7Map.get(e.id) ?? 0;
    const consumoDiarioPromedio = consumo30 / VENTANA_DIAS_CONSUMO;

    let diasHastaAgotamiento: number | null = null;
    if (consumoDiarioPromedio <= 0) {
      diasHastaAgotamiento = null; // N/D — sin consumo reciente.
    } else {
      const basePorConsumir = saldo + limite;
      if (basePorConsumir <= 0) {
        diasHastaAgotamiento = 0; // ya agotado / en descubierto profundo.
      } else {
        diasHastaAgotamiento =
          Math.round((basePorConsumir / consumoDiarioPromedio) * 10) / 10;
      }
    }

    return {
      empresaId: e.id,
      empresaNombre: e.nombre,
      modalidadPago: e.modalidadPago,
      suspendida: e.suspendida,
      saldoActivo: Math.round(saldo * 100) / 100,
      limiteDescubierto: Math.round(limite * 100) / 100,
      umbralSuspension: Math.round(umbralSuspension * 100) / 100,
      distanciaAlUmbral: Math.round(distanciaAlUmbral * 100) / 100,
      consumo7d: Math.round(consumo7 * 100) / 100,
      consumo30d: Math.round(consumo30 * 100) / 100,
      consumoDiarioPromedio: Math.round(consumoDiarioPromedio * 100) / 100,
      diasHastaAgotamiento,
      riesgo: clasificarRiesgo(e.suspendida, diasHastaAgotamiento),
    };
  });

  const notas: string[] = [];
  if (empresasShape.every((e) => e.consumoDiarioPromedio === 0)) {
    notas.push(
      "Sin consumo registrado en la ventana — se poblará desde el día 1 con tráfico real. Al menos 7 días de operación son necesarios para una proyección estable."
    );
  }

  const calidadDatos: CalidadDatosSaludFinanciera = {
    ventanaDiasConsumo: VENTANA_DIAS_CONSUMO,
    ventanaDiasReciente: VENTANA_DIAS_RECIENTE,
    multiplicadorSuspension: MULTIPLICADOR_SUSPENSION,
    tiposDebito: TIPOS_DEBITO,
    fuente:
      "Empresa.saldoActivo/modalidadPago/limiteDescubierto/suspendida + MovimientoFinanciero (débitos tipo DEBITO_*)",
    notas,
  };

  if (!ctx.modoDios) {
    // Cliente: debe venir exactamente 1 empresa.
    if (empresasShape.length === 0) {
      throw new Error("Empresa no encontrada");
    }
    return {
      empresa: empresasShape[0],
      calidadDatos,
      scope: "cliente",
    };
  }

  // Shipro: agregado sobre la lista (todas, o la filtrada).
  const agregado: AgregadoSaludFinanciera = {
    totalEmpresas: empresasShape.length,
    empresasPrepago: empresasShape.filter((e) => e.modalidadPago === "PREPAGO").length,
    empresasPostpago: empresasShape.filter((e) => e.modalidadPago === "POSTPAGO").length,
    empresasSuspendidas: empresasShape.filter((e) => e.suspendida).length,
    empresasEnRiesgoCritico: empresasShape.filter((e) => e.riesgo === "critico").length,
    empresasEnAtencion: empresasShape.filter((e) => e.riesgo === "atencion").length,
    saldoTotalPositivo: Math.round(
      empresasShape.filter((e) => e.saldoActivo > 0).reduce((acc, e) => acc + e.saldoActivo, 0) * 100
    ) / 100,
    deudaTotalNegativa: Math.round(
      empresasShape.filter((e) => e.saldoActivo < 0).reduce((acc, e) => acc + Math.abs(e.saldoActivo), 0) * 100
    ) / 100,
    consumoDiarioAgregado: Math.round(
      empresasShape.reduce((acc, e) => acc + e.consumoDiarioPromedio, 0) * 100
    ) / 100,
    empresasConConsumoReciente: empresasShape.filter((e) => e.consumo30d > 0).length,
  };

  // Ordenar por riesgo (más crítico primero), luego por días hasta agotamiento ascendente.
  const prioridad: Record<NivelRiesgo, number> = {
    suspendida: 0,
    critico: 1,
    atencion: 2,
    ok: 3,
  };
  const empresasOrdenadas = empresasShape.sort((a, b) => {
    const pa = prioridad[a.riesgo];
    const pb = prioridad[b.riesgo];
    if (pa !== pb) return pa - pb;
    const da = a.diasHastaAgotamiento ?? Number.POSITIVE_INFINITY;
    const db = b.diasHastaAgotamiento ?? Number.POSITIVE_INFINITY;
    return da - db;
  });

  return {
    empresas: empresasOrdenadas,
    agregado,
    calidadDatos,
    scope: "shipro",
  };
}
