import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validarDepositoInput } from "@/lib/depositos/validar";
import { ROLES_ESCRITURA, ROLES_LECTURA, resolverEmpresaIdParaCrear } from "@/lib/depositos/auth";
import { procesarEnviosBloqueadosPorDeposito } from "@/lib/envios/procesar-bloqueados-deposito";
import { geocodificarDireccion } from "@/lib/geo/geocodificar-direccion";

// ==========================================
// GET /api/depositos
// Lista depósitos (filtra eliminado=false por defecto).
// - Shipro: requiere ?empresaId=X
// - Cliente: usa empresaId de sesión, ignora query
// ==========================================
export async function GET(request: Request) {
  const ctx = resolverEmpresaIdParaCrear(request);
  if (!ctx.ok) return ctx.response;

  if (!ROLES_LECTURA.includes(ctx.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const url = new URL(request.url);
  const incluirEliminados = url.searchParams.get("incluirEliminados") === "true";

  const depositos = await prisma.deposito.findMany({
    where: {
      empresaId: ctx.empresaId,
      ...(incluirEliminados ? {} : { eliminado: false }),
    },
    orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
  });

  return NextResponse.json(depositos);
}

// ==========================================
// POST /api/depositos
// Crea un depósito nuevo.
// - Si es el primer depósito activo de la empresa: forzar esPredeterminado=true.
// - Si body.esPredeterminado=true: desmarcar otros en transacción.
// ==========================================
export async function POST(request: Request) {
  const body = await request.json();
  const ctx = resolverEmpresaIdParaCrear(request, body.empresaId);
  if (!ctx.ok) return ctx.response;

  if (!ROLES_ESCRITURA.includes(ctx.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const errorValidacion = validarDepositoInput(body);
  if (errorValidacion) {
    return NextResponse.json({ error: errorValidacion }, { status: 400 });
  }

  // ¿Es el primer depósito activo no eliminado de la empresa?
  const totalNoEliminados = await prisma.deposito.count({
    where: { empresaId: ctx.empresaId, eliminado: false },
  });
  const esPrimero = totalNoEliminados === 0;
  const esPredeterminado = esPrimero || body.esPredeterminado === true;

  const deposito = await prisma.$transaction(async (tx) => {
    if (esPredeterminado && !esPrimero) {
      // Desmarcar otros predeterminados (no aplica si es el primero porque no hay otros)
      await tx.deposito.updateMany({
        where: { empresaId: ctx.empresaId, esPredeterminado: true },
        data: { esPredeterminado: false },
      });
    }
    return tx.deposito.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: String(body.nombre).trim(),
        esPredeterminado,
        activo: body.activo ?? true,
        contactoNombre: String(body.contactoNombre).trim(),
        contactoTelefono: String(body.contactoTelefono).trim(),
        contactoEmail: body.contactoEmail ? String(body.contactoEmail).trim() : null,
        direccionCalle: String(body.direccionCalle).trim(),
        direccionAltura: String(body.direccionAltura).trim(),
        direccionPiso: body.direccionPiso ? String(body.direccionPiso).trim() : null,
        direccionDpto: body.direccionDpto ? String(body.direccionDpto).trim() : null,
        codigoPostal: String(body.codigoPostal).trim(),
        localidad: String(body.localidad).trim(),
        provincia: String(body.provincia).trim(),
        pais: body.pais ? String(body.pais).trim() : "Argentina",
        horarios: String(body.horarios),
        observaciones: body.observaciones ? String(body.observaciones).trim() : null,
      },
    });
  });

  // DEUDA 29 Sub-fase 2.B.0: geocodificar la dirección del depósito recién
  // creado. Si Google falla → coords y timestamp quedan en null (estado natural
  // pre-geocoding). El helper nunca lanza, NO bloquea el alta.
  const coords = await geocodificarDireccion({
    direccionCalle: deposito.direccionCalle,
    direccionAltura: deposito.direccionAltura,
    codigoPostal: deposito.codigoPostal,
    localidad: deposito.localidad,
    provincia: deposito.provincia,
    pais: deposito.pais,
  });
  let depositoConCoords = deposito;
  if (coords) {
    depositoConCoords = await prisma.deposito.update({
      where: { id: deposito.id },
      data: {
        latitud: coords.latitud,
        longitud: coords.longitud,
        ultimaGeocodificacion: new Date(),
      },
    });
  } else {
    console.warn(`[depositos] WARN: POST id=${deposito.id} (${deposito.nombre}) — geocoding falló, alta sin coords.`);
  }

  // DEUDA 4: si este depósito quedó como predeterminado (porque era el primero
  // o porque el body lo pidió), intentar destrabar envíos en BLOQUEADO_DEPOSITO.
  let recovery;
  if (deposito.esPredeterminado) {
    recovery = await procesarEnviosBloqueadosPorDeposito(ctx.empresaId);
  }

  return NextResponse.json(recovery ? { ...depositoConCoords, recovery } : depositoConCoords);
}
