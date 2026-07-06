import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { enviarMailEscalacionCourier, enviarMailContencionDestinatario, enviarMailCierreTicket } from "@/lib/mailer";
import { resolverContext } from "@/lib/auth-context";

// =================================================================
// GET: EL RADAR Y LOS TICKETS (Soporta Bandeja Activa e Historial)
// =================================================================
export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3 GROUP C: scoping por empresa (cliente ve los suyos).
  // TicketSoporte no tiene empresaId directo; se filtra via la relacion envio.empresaId
  // (mismo patron que lib/utils/tickets-mesa-ayuda.ts:158).
  const ctx = resolverContext(request);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { searchParams } = new URL(request.url);
    const verHistorial = searchParams.get("historial") === "true";

    const ticketsWhere: any = {
      estado: verHistorial
        ? { in: ["CERRADO", "RESUELTO"] }
        : { in: ["ABIERTO", "EN_PROCESO"] }
    };
    if (ctx.empresaId !== null) ticketsWhere.envio = { empresaId: ctx.empresaId };

    const tickets = await prisma.ticketSoporte.findMany({
      where: ticketsWhere,
      include: {
        envio: { include: { courier: true, destino: true } },
        auditorias: { orderBy: { fecha: 'desc' } }
      },
      orderBy: { fechaCreacion: 'desc' }
    });

    let enviosConProblemas: any[] = [];

    if (!verHistorial) {
      const enviosWhere: any = {
        OR: [
          { estadoActual: "S_FALLIDA" },
          { estadoActual: "S_SINIESTRO" },
          { estadoActual: "RETENIDO" }
        ],
        tickets: { none: { estado: { in: ["ABIERTO", "EN_PROCESO"] } } }
      };
      if (ctx.empresaId !== null) enviosWhere.empresaId = ctx.empresaId;

      enviosConProblemas = await prisma.envio.findMany({
        where: enviosWhere,
        include: { courier: true, destino: true }
      });
    }

    return NextResponse.json({
      ticketsEnGestion: tickets,
      alertasRadar: enviosConProblemas
    });

  } catch (error: any) {
    console.error("❌ Error en el Radar de Soporte:", error.message);
    return NextResponse.json({ error: "Error al escanear anomalías" }, { status: 500 });
  }
}

// =================================================================
// POST: CREAR TICKET O AGREGAR AUDITORÍA Y DISPARAR MAILS 
// =================================================================
export async function POST(request: Request) {
  // DEUDA 87 FAMILIA 3 GROUP C: creacion cliente-only. Solo el dueno del envio
  // puede abrir un ticket sobre el (TicketSoporte no tiene empresaId directo;
  // el ownership se hereda del envio referenciado).
  const ctx = resolverContext(request);
  if (ctx instanceof NextResponse) return ctx;

  // DEUDA 90 (preparado): hoy POST es solo del cliente. Shipro genera tickets
  // automaticamente (sweep >36h en cron/rastreo) via prisma.ticketSoporte.create
  // directo, no por aca. Cuando se habilite creacion manual de shipro, permitir
  // ctx.empresaId===null + tomar empresaId del body con su gate. Por ahora se rechaza.
  if (ctx.empresaId === null) {
    return NextResponse.json({ error: "Solo un cliente puede crear tickets manualmente." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { envioId, motivo, observacion, accionAuditoria, emailOperador } = body;

    if (!envioId || !motivo) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    const envioInfo = await prisma.envio.findUnique({
      where: { id: Number(envioId) },
      include: { courier: true, destino: true, empresa: true }
    });

    if (!envioInfo) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });

    // DEUDA 87 FAMILIA 3 GROUP C: ownership check. El body.envioId es del cliente;
    // rechazar si no le pertenece (404, no exponer existencia — patron depositos/envios).
    if (envioInfo.empresaId !== ctx.empresaId) {
      return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    }

    const emailCourierOficial = (envioInfo.courier as any)?.emailSoporte; 
    
    // BLOQUEO: Si el operador está intentando mandar un mail al courier y no hay mail en la BD
    if (accionAuditoria === "Reclamo a Courier" && !emailCourierOficial) {
        return NextResponse.json({ 
          error: `El courier "${envioInfo.courier?.nombre}" no tiene un Email de Soporte configurado en el ABM.` 
        }, { status: 400 });
    }

    // 1. Verificamos si ya existe un ticket ABIERTO para este envío
    let ticketExistente = await prisma.ticketSoporte.findFirst({
      where: { envioId: Number(envioId), estado: { in: ["ABIERTO", "EN_PROCESO"] } }
    });

    let ticketIdFinal = 0;

    if (ticketExistente) {
      // 1A. Si ya existe, simplemente le agregamos la acción al historial del ticket
      await prisma.auditoriaSoporte.create({
        data: {
          ticketId: ticketExistente.id,
          accion: accionAuditoria || "Gestión Operativa",
          detalle: observacion || "Sin detalles.",
          usuarioEmail: emailOperador || "operador@shipro.pro"
        }
      });
      ticketIdFinal = ticketExistente.id;
    } else {
      // 1B. Si no existe, creamos el ticket desde cero (Generalmente lo hace el cliente)
      const nuevoTicket = await prisma.ticketSoporte.create({
        data: {
          envioId: Number(envioId),
          motivo: motivo,
          observacion: observacion || "",
          estado: "ABIERTO",
          auditorias: {
            create: {
              accion: accionAuditoria || "Ticket Iniciado",
              detalle: observacion || "Ticket abierto por el usuario.",
              usuarioEmail: emailOperador || "Cliente Automático"
            }
          }
        }
      });
      ticketIdFinal = nuevoTicket.id;

      // Solo mandamos mail de contención al Comprador si es la PRIMERA vez que se crea el ticket y lo creó el cliente
      if (envioInfo.destino?.email && !accionAuditoria) { 
        await enviarMailContencionDestinatario(
          envioInfo.destino.email,
          envioInfo.destino.nombre || "Cliente",
          envioInfo.empresa?.nombre || "Nuestra Tienda",
          envioInfo.trackingNumber
        );
      }
    }

    // 2. EL DISPARADOR DEL COURIER (Solo funciona si el Operador apretó "Reclamo a Courier")
    if (accionAuditoria === "Reclamo a Courier" && emailCourierOficial) {
      await enviarMailEscalacionCourier(
        emailCourierOficial,
        envioInfo.courier?.nombre || "Courier",
        envioInfo.trackingNumber,
        envioInfo.estadoActual,
        motivo,
        observacion || "Revisión operativa solicitada." // <--- ACÁ VIAJA TU TEXTO REINTERPRETADO
      );
    }

    return NextResponse.json({ success: true, ticketId: ticketIdFinal });

  } catch (error: any) {
    console.error("❌ Error al procesar el ticket:", error.message);
    return NextResponse.json({ error: "No se pudo procesar la solicitud" }, { status: 500 });
  }
}

// =================================================================
// PUT: CERRAR O ACTUALIZAR TICKET (Y AVISAR AL CLIENTE)
// =================================================================
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { ticketId, estado, resolucion, emailOperador } = body;

    if (!ticketId || !estado) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    const ticketActualizado = await prisma.ticketSoporte.update({
      where: { id: Number(ticketId) },
      data: {
        estado: estado,
        fechaCierre: (estado === "CERRADO" || estado === "RESUELTO") ? new Date() : null,
        auditorias: {
          create: {
            accion: `Ticket ${estado}`,
            detalle: resolucion || `El ticket cambió a estado ${estado}`,
            usuarioEmail: emailOperador || "operador@shipro.pro"
          }
        }
      }
    });

    if (estado === "CERRADO" || estado === "RESUELTO") {
      const envioInfo = await prisma.envio.findUnique({
        where: { id: ticketActualizado.envioId },
        include: { destino: true }
      });

      if (envioInfo?.destino?.email) {
        await enviarMailCierreTicket(
          envioInfo.destino.email,
          envioInfo.trackingNumber,
          resolucion || "La incidencia fue resuelta operativamente."
        );
      }
    }

    return NextResponse.json(ticketActualizado);

  } catch (error: any) {
    console.error("❌ Error al actualizar ticket:", error.message);
    return NextResponse.json({ error: "No se pudo actualizar el ticket" }, { status: 500 });
  }
}