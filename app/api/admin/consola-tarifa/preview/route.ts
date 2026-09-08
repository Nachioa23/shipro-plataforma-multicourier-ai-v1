import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { aplicarMarkup, type ConfigMarkup } from "@/lib/cotizador";
import {
  resolverMarkupCourierPorcentaje,
  resolverSmoNeto,
  resolverIntermediarioMarkupPorcentaje,
} from "@/lib/utils/resolvers-tarifa";
import { calcularFeeOperacion } from "@/lib/utils/operacion-fee";
import { IVA_AR_MULTIPLIER_NUM } from "@/lib/constants/iva";

// DEUDA 170 Parte 2 Pieza 5 (2026-09-08): Preview LIVE de la cascada de tarifa.
//
// GARANTÍA DE MATCH CON EL MOTOR: este endpoint IMPORTA y LLAMA la función real
// `aplicarMarkup` del motor de precios (lib/cotizador.ts) + los 4 resolvers
// reales (resolverMarkupCourierPorcentaje, resolverSmoNeto,
// resolverIntermediarioMarkupPorcentaje, calcularFeeOperacion). CERO
// duplicación de la fórmula de cascada — si el motor cambia, el preview
// automáticamente refleja el cambio. Cero drift posible.
//
// READ-ONLY: consulta la DB (via los resolvers) para armar el ConfigMarkup,
// pero NO ESCRIBE nada — no crea envíos, no debita saldo, no toca tablas de
// audit. Es una calculadora pura sobre config vigente. Cero side effects.
//
// AISLAMIENTO DEL MOTOR: el pipeline server-side es un ESPEJO byte-exact del
// call site del cotizador (lib/cotizador.ts:530-544):
//   1. Resolvers en paralelo → obtener % Shipro + % dueño + SMO + Fee.
//   2. Armar ConfigMarkup con los 4 valores + los toggles del preview.
//   3. Llamar aplicarMarkup(secoNetoSample, config) → obtener desglose + precio.
//
// GATE: admin_shipro.
//
// DEFAULTS del preview (caso común Rama A + intermediario COURIER):
//   - usaCredencialesPropias: false (Rama A)
//   - propietarioTipo: "COURIER" (creds de tercero prestando, markup dueño aplica)
//   - tarifaIncluyeIva: false (el sample tipeado por el operador se trata como neto directo)
//   - markupFijo: 0 (no se usa en prod hoy — ver DEUDA 172)
//
// Los toggles opcionales del body permiten explorar Rama B / SHIPRO-owned /
// strip IVA para casos edge.

type PropietarioTipoBody = "COURIER" | "SHIPRO" | "CLIENTE" | null;
const PROPIETARIO_TIPOS_VALIDOS = new Set<PropietarioTipoBody>([
  "COURIER",
  "SHIPRO",
  "CLIENTE",
  null,
]);

export async function POST(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    // ---- Parse + validate inputs ----
    const courierIdRaw = body?.courierId;
    const courierId =
      typeof courierIdRaw === "number" ? courierIdRaw : Number(courierIdRaw);
    if (!Number.isInteger(courierId) || courierId <= 0) {
      return NextResponse.json({ error: "courierId inválido." }, { status: 400 });
    }

    const empresaIdRaw = body?.empresaId;
    const empresaId =
      typeof empresaIdRaw === "number" ? empresaIdRaw : Number(empresaIdRaw);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json({ error: "empresaId inválido." }, { status: 400 });
    }

    const secoRaw = body?.secoNetoSample;
    const secoNetoSample =
      typeof secoRaw === "number" ? secoRaw : Number(secoRaw);
    if (!Number.isFinite(secoNetoSample) || secoNetoSample < 0) {
      return NextResponse.json(
        { error: "secoNetoSample inválido (debe ser un número finito ≥ 0)." },
        { status: 400 }
      );
    }

    const usaCredencialesPropias: boolean =
      body?.usaCredencialesPropias === true;
    const tarifaIncluyeIva: boolean = body?.tarifaIncluyeIva === true;

    // propietarioTipo default "COURIER" — el caso donde markup del dueño aplica.
    // Si el operador quiere previsualizar Shipro-owned o CLIENTE, toggle.
    const propietarioTipoInput =
      typeof body?.propietarioTipo === "string"
        ? (body.propietarioTipo as PropietarioTipoBody)
        : "COURIER";
    const propietarioTipo: PropietarioTipoBody = PROPIETARIO_TIPOS_VALIDOS.has(
      propietarioTipoInput
    )
      ? propietarioTipoInput
      : "COURIER";

    // Verificar que courier + empresa existen (evita queries en resolvers para
    // ids inválidos → 404 explícito).
    const [courier, empresa] = await Promise.all([
      prisma.courier.findUnique({
        where: { id: courierId },
        select: { id: true, nombre: true, activo: true },
      }),
      prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { id: true, nombre: true, activo: true },
      }),
    ]);
    if (!courier) {
      return NextResponse.json(
        { error: `Courier ${courierId} no existe.` },
        { status: 404 }
      );
    }
    if (!empresa) {
      return NextResponse.json(
        { error: `Empresa ${empresaId} no existe.` },
        { status: 404 }
      );
    }

    // ---- Resolvers en paralelo (mirror exacto de cotizador.ts:530-544) ----
    const [shiproPct, smoNetoRaw, intermPct, feeResult] = await Promise.all([
      resolverMarkupCourierPorcentaje(courierId, usaCredencialesPropias),
      resolverSmoNeto(courierId),
      resolverIntermediarioMarkupPorcentaje(
        {
          usaCredencialesPropias,
          propietarioTipo,
          // propietarioCourierId no es usado por el resolver moderno (motor
          // rewireado 2026-09-08 lee `courierId=courierEjecutorId`). Pasamos null.
          propietarioCourierId: null,
        },
        courierId
      ),
      // basePrecio=0 mantiene el mismo comportamiento que el cotizador vigente
      // (para tipo FIJO da bien; para PORCENTAJE es la limitación conocida —
      // ver el flag `feeAproximado` en el response).
      calcularFeeOperacion(empresaId, new Prisma.Decimal(0)),
    ]);

    const feeShiproNeto = feeResult?.feePreIva ?? new Prisma.Decimal(0);
    const feeTipo = feeResult?.tipo ?? null;
    const feeAproximado = feeTipo === "PORCENTAJE";

    // ---- Armar ConfigMarkup — mirror byte-exact de cotizador.ts:541-551 ----
    const config: ConfigMarkup = {
      usaCredencialesPropias,
      ajusteTarifaPorcentaje: shiproPct,
      // markupFijo: 0 fijo en el preview. En prod hoy está en 0 en todas las
      // credenciales (verificado sesión anterior). Ver DEUDA 172 para el bug
      // latente del cascade + fijo — no aplica al preview hasta que se use.
      markupFijo: new Prisma.Decimal(0),
      tarifaIncluyeIva,
      intermediarioMarkupPorcentaje: intermPct,
      smoNeto: smoNetoRaw,
      feeShiproNeto,
    };

    // ---- Motor real. Cero replica de fórmula. ----
    const resultado = aplicarMarkup(secoNetoSample, config);

    return NextResponse.json({
      input: {
        courier: { id: courier.id, nombre: courier.nombre },
        empresa: { id: empresa.id, nombre: empresa.nombre },
        secoNetoSample,
        usaCredencialesPropias,
        propietarioTipo,
        tarifaIncluyeIva,
      },
      config: {
        ajusteTarifaPorcentaje: shiproPct,
        intermediarioMarkupPorcentaje: intermPct,
        smoNeto: smoNetoRaw.toString(),
        feeShiproNeto: feeShiproNeto.toString(),
        feeTipo,
        feeAproximado,
        ivaMultiplier: IVA_AR_MULTIPLIER_NUM,
      },
      desglose: {
        secoNeto: resultado.desglose.secoNeto.toString(),
        baseConIntermediario: resultado.desglose.baseConIntermediario.toString(),
        cascadaNeto: resultado.desglose.cascadaNeto.toString(),
        smoAplicado: resultado.desglose.smoNeto.toString(),
        feeAplicado: resultado.desglose.feeNeto.toString(),
        netoAcumulado: resultado.desglose.netoAcumulado.toString(),
      },
      precioFinal: resultado.precioFinal.toString(),
    });
  } catch (error: any) {
    console.error("Error en preview de consola de tarifa:", error);
    return NextResponse.json(
      { error: error?.message || "Error interno" },
      { status: 500 }
    );
  }
}
