import prisma from "@/lib/prisma";

const CAMPOS_REQUERIDOS = [
  'nombre',
  'contactoNombre',
  'contactoTelefono',
  'direccionCalle',
  'direccionAltura',
  'codigoPostal',
  'localidad',
  'provincia',
  'horarios',
];

/**
 * Valida que el body tenga los campos obligatorios y formatos correctos.
 * Retorna null si está OK, o un mensaje de error si no.
 */
export function validarDepositoInput(input: any): string | null {
  if (!input || typeof input !== 'object') return 'Body inválido';

  for (const campo of CAMPOS_REQUERIDOS) {
    const valor = input[campo];
    if (valor === undefined || valor === null) return `Campo requerido faltante: ${campo}`;
    if (typeof valor === 'string' && valor.trim() === '') return `Campo requerido vacío: ${campo}`;
  }

  // CP: 4 dígitos numéricos (Argentina)
  if (!/^\d{4}$/.test(String(input.codigoPostal).trim())) {
    return 'Código postal inválido (debe ser 4 dígitos)';
  }

  // Teléfono: exactamente 10 dígitos limpios (sin 0 inicial ni 15 móvil).
  // Política "Consistencia de formularios" — el sistema agrega +549 al
  // despachar a WhatsApp / courier. Defense-in-depth: aunque el frontend
  // use <InputTelefono>, validamos también acá.
  const telefonoLimpio = String(input.contactoTelefono).replace(/\D/g, '');
  if (telefonoLimpio.length !== 10) {
    return 'Teléfono de contacto inválido (deben ser 10 dígitos sin 0 inicial ni 15 móvil)';
  }

  // horarios: debe ser JSON parseable
  try {
    JSON.parse(input.horarios);
  } catch {
    return 'Horarios inválidos (debe ser JSON parseable)';
  }

  return null;
}

/**
 * Verifica que dejar a este depósito sin esPredeterminado=true (o eliminarlo)
 * deje al menos UN otro depósito activo y predeterminado en la empresa.
 * Retorna null si OK, mensaje si bloquea.
 */
export async function validarHayOtroPredeterminado(empresaId: number, depositoId: number): Promise<string | null> {
  const otros = await prisma.deposito.count({
    where: {
      empresaId,
      eliminado: false,
      activo: true,
      esPredeterminado: true,
      NOT: { id: depositoId },
    },
  });
  if (otros === 0) {
    return 'Marcá otro depósito como predeterminado primero.';
  }
  return null;
}

/**
 * Verifica que se pueda eliminar (soft) o inactivar este depósito.
 * Reglas (D7):
 * - Si era predeterminado: debe haber otro predeterminado activo en la empresa.
 * - Debe quedar al menos un depósito activo en la empresa post-operación.
 */
export async function validarPuedeEliminarOInactivar(empresaId: number, depositoId: number): Promise<string | null> {
  const deposito = await prisma.deposito.findUnique({ where: { id: depositoId } });
  if (!deposito) return 'Depósito no encontrado.';
  if (deposito.eliminado) return 'Depósito ya eliminado.';

  if (deposito.esPredeterminado) {
    const error = await validarHayOtroPredeterminado(empresaId, depositoId);
    if (error) return error;
  }

  const otrosActivos = await prisma.deposito.count({
    where: {
      empresaId,
      eliminado: false,
      activo: true,
      NOT: { id: depositoId },
    },
  });
  if (otrosActivos === 0) {
    return 'No se puede dejar a la empresa sin depósitos activos. Creá otro primero.';
  }
  return null;
}
