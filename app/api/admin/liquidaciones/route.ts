import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get("tracking");

    // ==========================================
    // SÚPER BUSCADOR FORENSE DE TRACKINGS
    // ==========================================
    if (tracking) {
      const envio = await prisma.envio.findUnique({
        where: { trackingNumber: tracking },
        include: {
          empresa: true,
          finanzas: true,
          liquidacion: true,
          courier: true
        }
      });
      if (!envio) return NextResponse.json({ error: "Tracking no encontrado en la base." }, { status: 404 });
      return NextResponse.json(envio);
    }

    // ==========================================
    // CARGA DE PANTALLA NORMAL (Con Regla de Oro)
    // ==========================================
    const empresasConPendientes = await prisma.empresa.findMany({
      where: {
        envios: { 
          some: { 
            estadoLiquidacion: "PENDIENTE",
            finanzas: { pesoAforado: { not: null } } // LA REGLA DE ORO: Solo si el courier ya lo auditó/facturó
          } 
        }
      },
      include: {
        envios: {
          where: { 
            estadoLiquidacion: "PENDIENTE",
            finanzas: { pesoAforado: { not: null } } 
          },
          include: { finanzas: true, courier: true }
        }
      }
    });

    const pendientes = empresasConPendientes.map(emp => {
      const totalEnvios = emp.envios.length;
      const montoTotal = emp.envios.reduce((acc, envio) => {
        return acc
          .add(envio.finanzas?.precioFactura ?? new Prisma.Decimal(0))
          .add(envio.finanzas?.costoAforo ?? new Prisma.Decimal(0));
      }, new Prisma.Decimal(0));

      return {
        empresaId: emp.id,
        nombre: emp.nombre,
        cuit: emp.cuit,
        totalEnvios,
        montoTotal: montoTotal.toNumber()
      };
    });

    const liquidacionesHistoricas = await prisma.liquidacionMensual.findMany({
      include: { empresa: true },
      orderBy: { fechaCreacion: 'desc' },
      take: 50
    });

    return NextResponse.json({ pendientes, historial: liquidacionesHistoricas });

  } catch (error) {
    console.error("Error cargando liquidaciones:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // DEUDA 87 FAMILIA 3: gate de rol (defense-in-depth).
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro" && rol !== "operador_shipro") {
    return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
  }

  try {
    const { empresaId, periodo } = await request.json();

    if (!empresaId || !periodo) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    const resultado = await prisma.$transaction(async (tx) => {
      // Aplicamos la Regla de Oro al momento de atrapar los envíos para cerrar el mes
      const enviosPendientes = await tx.envio.findMany({
        where: { 
          empresaId: parseInt(empresaId), 
          estadoLiquidacion: "PENDIENTE",
          finanzas: { pesoAforado: { not: null } } 
        },
        include: { finanzas: true, courier: true, destino: true }
      });

      if (enviosPendientes.length === 0) throw new Error("No hay envíos habilitados por el courier para liquidar.");

      const montoTotal = enviosPendientes.reduce((acc, envio) => {
        return acc
          .add(envio.finanzas?.precioFactura ?? new Prisma.Decimal(0))
          .add(envio.finanzas?.costoAforo ?? new Prisma.Decimal(0));
      }, new Prisma.Decimal(0));

      const nuevaLiquidacion = await tx.liquidacionMensual.create({
        data: {
          empresaId: parseInt(empresaId),
          periodo: periodo, 
          montoTotal: montoTotal,
          estado: "EMITIDA"
        }
      });

      await tx.envio.updateMany({
        where: { id: { in: enviosPendientes.map(e => e.id) } },
        data: { 
          estadoLiquidacion: "LIQUIDADO",
          liquidacionId: nuevaLiquidacion.id 
        }
      });

      return { liquidacion: nuevaLiquidacion, envios: enviosPendientes };
    });

    return NextResponse.json({ success: true, ...resultado });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error al procesar el cierre" }, { status: 500 });
  }
}