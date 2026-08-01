import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  registrarCambioConfiguracion,
  MotivoRequeridoError,
} from "@/lib/auditoria-configuracion";

// FASE 2 sub 4 parte A (2026-08-01): admin ver/editar el Fee por empresa
// (OperacionFee) con vigencias. Mirror de las rutas de markup Shipro (sub 2a,
// commit 9b6aa1d) y SMO por courier (sub 3, commit 144b4ce), con TRES
// diferencias:
//
//   (i) OperacionFee ESTÁ WIRED al motor de plata en vivo desde FASE 1
//       (calcularFeeOperacion en lib/utils/operacion-fee.ts es leído por
//       lib/cotizador.ts:355, lib/envios/crear.ts:478 y
//       app/api/conciliacion/route.ts:296). Editar un Fee mueve plata REAL
//       en el próximo envío de la empresa. La UI advierte antes de guardar.
//
//   (ii) OperacionFee usa la ortografía `vigente*` (vigenteDesde/vigenteHasta),
//        NO `vigencia*` (DEUDA 114 — la unificación se cierra aparte). Este
//        writer respeta el spelling de la tabla; no lo cruza con las tablas
//        nuevas.
//
//  (iii) Motivo OBLIGATORIO en cada cambio — se persiste vía el helper
//        registrarCambioConfiguracion (lib/auditoria-configuracion.ts),
//        mismo camino que tipoCuenta / propietarioTipo. Los campos
//        operacionFeeValor + operacionFeeTipo se registraron con
//        sensible:true en CAMPOS_AUDITABLES, así que el helper mismo tira
//        MotivoRequeridoError si falta el motivo — enforcement en dos capas
//        (validación explícita en el route + guard del helper).
//
// PATRÓN DE ESCRITURA — "cerrar + crear" por empresa. Cerrar la vigencia
// activa (activo=false, vigenteHasta=now) y crear una nueva (activo=true,
// vigenteDesde=now). NUNCA in-place. vigenteDesde=`ahora` SIEMPRE se calcula
// server-side (`new Date()`); jamás se acepta del body — evita back-date o
// future-date de un cambio de plata.

const MIN_VALOR = 0.01;
const MAX_VALOR_FIJO = 1_000_000; // pesos ARS
const MAX_VALOR_PORCENTAJE = 100;
const TIPOS_VALIDOS = new Set(["FIJO", "PORCENTAJE"]);

export async function GET(request: Request) {
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro." },
      { status: 403 }
    );
  }

  try {
    const empresas = await prisma.empresa.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, cuit: true },
    });

    const filas = await Promise.all(
      empresas.map(async (e) => {
        const activa = await prisma.operacionFee.findFirst({
          where: { empresaId: e.id, activo: true },
          orderBy: { vigenteDesde: "desc" },
        });
        const historial = await prisma.operacionFee.findMany({
          where: { empresaId: e.id },
          orderBy: { vigenteDesde: "desc" },
          take: 50,
        });
        return { empresa: e, activa, historial };
      })
    );

    return NextResponse.json({ filas });
  } catch (error) {
    console.error("Error cargando OperacionFee por empresa:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

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
    const empresaIdRaw = body?.empresaId;
    const tipoRaw = body?.tipo;
    const valorRaw = body?.valor;
    const motivoRaw = body?.motivo;

    // Motivo OBLIGATORIO (decisión Nacho, sub 4 parte A) — validación
    // explícita al ingreso; el helper del audit también la enforce con
    // MotivoRequeridoError como red de seguridad.
    const motivo =
      typeof motivoRaw === "string" && motivoRaw.trim().length > 0
        ? motivoRaw.trim()
        : null;
    if (!motivo) {
      return NextResponse.json(
        {
          error:
            "El motivo es obligatorio para cambiar el Fee de una empresa (mueve plata en vivo).",
        },
        { status: 400 }
      );
    }

    const empresaId =
      typeof empresaIdRaw === "number" ? empresaIdRaw : Number(empresaIdRaw);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return NextResponse.json(
        { error: "empresaId inválido." },
        { status: 400 }
      );
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true },
    });
    if (!empresa) {
      return NextResponse.json(
        { error: `Empresa ${empresaId} no existe.` },
        { status: 404 }
      );
    }

    const tipo = typeof tipoRaw === "string" ? tipoRaw : "";
    if (!TIPOS_VALIDOS.has(tipo)) {
      return NextResponse.json(
        { error: `tipo debe ser "FIJO" o "PORCENTAJE".` },
        { status: 400 }
      );
    }

    const valor = typeof valorRaw === "number" ? valorRaw : Number(valorRaw);
    const maxValor = tipo === "PORCENTAJE" ? MAX_VALOR_PORCENTAJE : MAX_VALOR_FIJO;
    if (!Number.isFinite(valor) || valor < MIN_VALOR || valor > maxValor) {
      return NextResponse.json(
        {
          error: `valor inválido para tipo ${tipo}. Debe ser un número finito entre ${MIN_VALOR} y ${maxValor}.`,
        },
        { status: 400 }
      );
    }

    const nuevoValor = new Prisma.Decimal(valor.toString()).toDecimalPlaces(2);

    // vigenteDesde SIEMPRE server-side. Jamás del body.
    const ahora = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      const previa = await tx.operacionFee.findFirst({
        where: { empresaId, activo: true },
        orderBy: { vigenteDesde: "desc" },
      });

      // No-op guard por empresa: si ni el valor ni el tipo cambian respecto
      // de la vigencia activa, no crear filas idénticas contiguas.
      if (
        previa &&
        previa.tipo === tipo &&
        previa.valor.equals(nuevoValor)
      ) {
        return { previa, nueva: previa, noop: true };
      }

      // Cerrar la vigencia activa de ESTA empresa si existe (spelling vigente*).
      if (previa) {
        await tx.operacionFee.update({
          where: { id: previa.id },
          data: { activo: false, vigenteHasta: ahora },
        });
      }

      // Crear la nueva vigencia activa. Si no había previa (empresa que estaba
      // en "sin Fee = $0"), esta es su primera vigencia.
      const nueva = await tx.operacionFee.create({
        data: {
          empresaId,
          tipo,
          valor: nuevoValor,
          activo: true,
          vigenteDesde: ahora,
        },
      });

      return { previa, nueva, noop: false };
    });

    // AUDIT — persistente en AuditoriaConfiguracion vía el helper existente.
    // Motivo se propaga; helper valida sensible:true → motivo obligatorio.
    // Dos entradas separadas (valor + tipo) por consistencia con el patrón
    // de configuracion/couriers/route.ts:341 (una entrada por campo cambiado).
    // Si un campo no cambia, el helper skippea silencioso (valAnterior===valNuevo).
    if (!resultado.noop) {
      try {
        await registrarCambioConfiguracion({
          request,
          empresaId,
          courierId: null,
          campo: "operacionFeeValor",
          valorAnterior: resultado.previa?.valor?.toString() ?? null,
          valorNuevo: resultado.nueva.valor.toString(),
          motivo,
        });
        await registrarCambioConfiguracion({
          request,
          empresaId,
          courierId: null,
          campo: "operacionFeeTipo",
          valorAnterior: resultado.previa?.tipo ?? null,
          valorNuevo: resultado.nueva.tipo,
          motivo,
        });
      } catch (auditErr) {
        if (auditErr instanceof MotivoRequeridoError) {
          // No debería llegar acá — el motivo se valida arriba. Es red de seguridad.
          return NextResponse.json(
            { error: auditErr.message },
            { status: 400 }
          );
        }
        throw auditErr;
      }
    }

    return NextResponse.json({ success: true, empresa, ...resultado });
  } catch (error: any) {
    console.error("Error guardando OperacionFee:", error);
    return NextResponse.json(
      { error: error?.message || "Error al guardar" },
      { status: 500 }
    );
  }
}
