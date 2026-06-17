import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const PAGE_SIZE = 50;

/**
 * GET /api/admin/auditoria-configuracion
 *
 * Lista entries de AuditoriaConfiguracion con filtros y paginacion.
 *
 * Query params:
 *   empresaId  — number opcional, filtra por empresa especifica.
 *   campo      — string opcional, filtra por campo auditado.
 *   desde      — YYYY-MM-DD opcional, default = hoy - 30 dias.
 *   hasta      — YYYY-MM-DD opcional, default = hoy + 1 dia (inclusivo).
 *   page       — number opcional, default 1.
 *   formato    — "json" | "csv", default "json".
 *
 * Defense-in-depth: solo admin_shipro.
 *
 * Returns:
 *   JSON: { items, total, page, totalPages, pageSize }
 *   CSV:  Content-Disposition attachment con timestamp en filename.
 */
export async function GET(request: Request) {
  // Defense-in-depth: solo admin_shipro.
  const rol = request.headers.get("x-rol") || "";
  if (rol !== "admin_shipro") {
    return NextResponse.json(
      { error: "Acceso denegado. Solo admin_shipro puede consultar audit log." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  // Parsing filtros.
  const empresaIdRaw = searchParams.get("empresaId");
  const empresaId = empresaIdRaw ? parseInt(empresaIdRaw) : undefined;

  const campo = searchParams.get("campo") || undefined;

  // Default fechas: ultimos 30 dias.
  const hoy = new Date();
  const hace30Dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);

  const desdeRaw = searchParams.get("desde");
  const hastaRaw = searchParams.get("hasta");

  const desde = desdeRaw ? new Date(desdeRaw) : hace30Dias;
  const hasta = hastaRaw ? new Date(hastaRaw) : hoy;
  // Hasta inclusivo: avanzar al fin del dia.
  hasta.setHours(23, 59, 59, 999);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const formato = (searchParams.get("formato") || "json").toLowerCase();

  // Build where clause.
  const where: any = {
    fecha: { gte: desde, lte: hasta },
  };
  if (empresaId && !isNaN(empresaId)) where.empresaId = empresaId;
  if (campo) where.campo = campo;

  // CSV: stream all results, sin paginacion.
  if (formato === "csv") {
    const items = await prisma.auditoriaConfiguracion.findMany({
      where,
      include: {
        empresa: { select: { nombre: true } },
        courier: { select: { nombre: true } },
      },
      orderBy: { fecha: "desc" },
    });

    const headers = [
      "Fecha",
      "Usuario Email",
      "Rol",
      "IP Origen",
      "Empresa",
      "Courier",
      "Campo",
      "Valor Anterior",
      "Valor Nuevo",
      "Motivo",
    ];

    const rows = items.map((item) => [
      item.fecha.toISOString(),
      item.usuarioEmail || "",
      item.rolUsuario || "",
      item.ipOrigen || "",
      item.empresa?.nombre || `Empresa ${item.empresaId}`,
      item.courier?.nombre || "",
      item.campo,
      item.valorAnterior || "",
      item.valorNuevo || "",
      item.motivo || "",
    ]);

    // Escape CSV field: wrap in quotes + escape inner quotes.
    const escapeCsv = (val: string) => {
      const needsQuotes = /[,"\n]/.test(val);
      if (!needsQuotes) return val;
      return `"${val.replace(/"/g, '""')}"`;
    };

    const csv = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map((v) => escapeCsv(String(v))).join(",")),
    ].join("\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `auditoria-configuracion-${timestamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON: paginated.
  const [total, items] = await Promise.all([
    prisma.auditoriaConfiguracion.count({ where }),
    prisma.auditoriaConfiguracion.findMany({
      where,
      include: {
        empresa: { select: { id: true, nombre: true } },
        courier: { select: { id: true, nombre: true } },
      },
      orderBy: { fecha: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return NextResponse.json({
    items,
    total,
    page,
    totalPages,
    pageSize: PAGE_SIZE,
  });
}
