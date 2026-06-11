// ============================================================================
// CRON — Disparador trimestral de encuestas NPS Cliente Empresa
// Metrica 1.3 (DEUDA 39, 2026-06-11).
//
// Logica:
// 1. Calcular periodo actual ("YYYY-Qn").
// 2. Fetch todas las empresas activas con sus usuarios activos (email != null).
// 3. Para cada usuario:
//    a. Verificar que NO exista ya EncuestaNPSEmpresa con (usuarioId, periodo).
//    b. Generar tokenVoto unico via crypto.randomBytes(32).toString('hex').
//    c. Crear placeholder EncuestaNPSEmpresa (score y categoria NULL).
//    d. Enviar email via enviarMailEncuestaEmpresa.
// 4. Retornar resumen { disparosCorrectos, disparosFallidos, omitidos }.
//
// Auth: proxy.ts intercepta /api/cron/* y exige Bearer ${CRON_SECRET}.
// El handler no valida auth por su cuenta.
//
// Decisiones (director 2026-06-11):
// - Todos los usuarios activos (sin filtro de rol).
// - Si email falla: dejar placeholder (no rollback) para reenvio manual.
// - Idempotencia: findFirst antes de crear (no try-catch P2002).
// - Sin throttle en V1.
// - GET method (consistencia con otros crons).
// ============================================================================

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { enviarMailEncuestaEmpresa } from "@/lib/mailer";
import { getAppUrlOrThrow } from "@/lib/utils/app-url";
import { calcularPeriodoActual } from "@/lib/utils/periodo";

export async function GET(request: Request) {
  const fechaEjecucion = new Date();
  const periodo = calcularPeriodoActual(fechaEjecucion);

  try {
    const baseUrl = getAppUrlOrThrow();

    // Fetch empresas activas con sus usuarios activos.
    // Filtramos a nivel de usuario por email != null (los sin email no
    // pueden recibir la encuesta).
    const empresas = await prisma.empresa.findMany({
      where: { activo: true },
      include: {
        usuarios: {
          where: {
            email: { not: "" },
          },
          select: { id: true, nombre: true, email: true, rol: true },
        },
      },
    });

    let disparosCorrectos = 0;
    let disparosFallidos = 0;
    let omitidos = 0;
    let totalUsuariosElegibles = 0;

    const detalleErrores: Array<{ usuarioId: number; email: string; error: string }> = [];

    for (const empresa of empresas) {
      for (const usuario of empresa.usuarios) {
        totalUsuariosElegibles++;

        // Check idempotencia: no re-disparar al mismo usuario en el mismo trimestre.
        const yaExiste = await prisma.encuestaNPSEmpresa.findFirst({
          where: {
            usuarioId: usuario.id,
            periodo,
          },
          select: { id: true },
        });

        if (yaExiste) {
          omitidos++;
          continue;
        }

        // Generar token unico.
        const tokenVoto = randomBytes(32).toString("hex");

        // Crear placeholder.
        try {
          await prisma.encuestaNPSEmpresa.create({
            data: {
              empresaId: empresa.id,
              usuarioId: usuario.id,
              periodo,
              tokenVoto,
              fechaEnvio: fechaEjecucion,
              // score, categoria, satisfaccionPlataforma, calidadSoporte,
              // fortaleza, sugerencia quedan NULL.
            },
          });
        } catch (createErr: any) {
          console.error(
            `[Cron NPS Empresa] Error creando placeholder para usuarioId=${usuario.id}:`,
            createErr
          );
          disparosFallidos++;
          detalleErrores.push({
            usuarioId: usuario.id,
            email: usuario.email,
            error: "Error creando placeholder en BD",
          });
          continue;
        }

        // Enviar email.
        try {
          await enviarMailEncuestaEmpresa(
            usuario.email,
            usuario.nombre,
            empresa.nombre,
            periodo,
            tokenVoto,
            baseUrl
          );
          console.log(
            `[Cron NPS Empresa] Email enviado a ${usuario.email} (${empresa.nombre}, ${periodo})`
          );
          disparosCorrectos++;
        } catch (mailErr: any) {
          console.error(
            `[Cron NPS Empresa] Error enviando email a ${usuario.email}:`,
            mailErr
          );
          // No hacemos rollback del placeholder (decision director).
          // El registro queda con tokenVoto valido para reenvio manual futuro.
          disparosFallidos++;
          detalleErrores.push({
            usuarioId: usuario.id,
            email: usuario.email,
            error: "Error enviando email (placeholder creado)",
          });
        }
      }
    }

    const resumen = {
      ok: true,
      periodo,
      fechaEjecucion: fechaEjecucion.toISOString(),
      totalEmpresas: empresas.length,
      totalUsuariosElegibles,
      disparosCorrectos,
      disparosFallidos,
      omitidos,
      detalleErrores: detalleErrores.length > 0 ? detalleErrores : undefined,
    };

    console.log("[Cron NPS Empresa] Resumen:", JSON.stringify(resumen, null, 2));

    return NextResponse.json(resumen);
  } catch (error: any) {
    console.error("[Cron NPS Empresa] Error global:", error);
    return NextResponse.json(
      {
        ok: false,
        periodo,
        error: error?.message || "Error desconocido en cron NPS Empresa",
      },
      { status: 500 }
    );
  }
}
