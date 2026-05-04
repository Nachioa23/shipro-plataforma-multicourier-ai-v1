import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validarDepositoInput, validarPuedeEliminarOInactivar, validarHayOtroPredeterminado } from "@/lib/depositos/validar";
import { verificarAccesoDeposito } from "@/lib/depositos/auth";
import { procesarEnviosBloqueadosPorDeposito } from "@/lib/envios/procesar-bloqueados-deposito";

// ==========================================
// GET /api/depositos/[id]
// Detalle de un depósito.
// ==========================================
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, false);
  if (!acceso.ok) return acceso.response;

  return NextResponse.json(acceso.deposito);
}

// ==========================================
// PUT /api/depositos/[id]
// Actualiza un depósito.
// - Si esPredeterminado pasa a true: desmarcar otros (transacción).
// - Si esPredeterminado pasa de true a false: bloquear si no hay otro predeterminado.
// - Si activo pasa a false y es predeterminado: bloquear.
// ==========================================
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  const body = await request.json();

  const errorValidacion = validarDepositoInput(body);
  if (errorValidacion) return NextResponse.json({ error: errorValidacion }, { status: 400 });

  const previo = acceso.deposito;
  const nuevoEsPredeterminado = body.esPredeterminado === true;
  const nuevoActivo = body.activo !== false;

  // Reglas D7
  if (previo.esPredeterminado && !nuevoEsPredeterminado) {
    const error = await validarHayOtroPredeterminado(previo.empresaId, depositoId);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }
  if (previo.esPredeterminado && !nuevoActivo) {
    return NextResponse.json({ error: 'No se puede inactivar el depósito predeterminado. Marcá otro como predeterminado primero.' }, { status: 400 });
  }
  // Si esPredeterminado=true entonces activo=true (consistencia)
  if (nuevoEsPredeterminado && !nuevoActivo) {
    return NextResponse.json({ error: 'Un depósito predeterminado no puede estar inactivo.' }, { status: 400 });
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    if (nuevoEsPredeterminado && !previo.esPredeterminado) {
      await tx.deposito.updateMany({
        where: { empresaId: previo.empresaId, esPredeterminado: true, NOT: { id: depositoId } },
        data: { esPredeterminado: false },
      });
    }
    return tx.deposito.update({
      where: { id: depositoId },
      data: {
        nombre: String(body.nombre).trim(),
        esPredeterminado: nuevoEsPredeterminado,
        activo: nuevoActivo,
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

  // DEUDA 4: si este update pasó a predeterminado (transición false → true),
  // disparar destrabado de envíos en BLOQUEADO_DEPOSITO.
  let recovery;
  if (!previo.esPredeterminado && nuevoEsPredeterminado) {
    recovery = await procesarEnviosBloqueadosPorDeposito(previo.empresaId);
  }

  return NextResponse.json(recovery ? { ...actualizado, recovery } : actualizado);
}

// ==========================================
// DELETE /api/depositos/[id]
// Soft delete: UPDATE eliminado=true, activo=false, esPredeterminado=false.
// La FK Envio.depositoId tiene ON DELETE RESTRICT como defense-in-depth.
// ==========================================
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const depositoId = parseInt(id);
  if (isNaN(depositoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const acceso = await verificarAccesoDeposito(request, depositoId, true);
  if (!acceso.ok) return acceso.response;

  const error = await validarPuedeEliminarOInactivar(acceso.deposito.empresaId, depositoId);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const actualizado = await prisma.deposito.update({
    where: { id: depositoId },
    data: { eliminado: true, activo: false, esPredeterminado: false },
  });

  return NextResponse.json({ success: true, deposito: actualizado });
}
