import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PlataformaConexion, MecanismoConexion, EstadoConexion } from "@prisma/client";

// DEUDA 150 Pieza 1 (2026-09-07) — Admin endpoint del hub de conexiones per-empresa.
// Shipro-only. Sirve dos verbos:
//   GET  → lista las conexiones ya registradas del cliente + sus tiendas Tiendanube
//          (read-only, sin migrar — la absorción es Pieza 2 coordinada con Chat B)
//          + estado de la API Key (activa/últimos4/creadaEn).
//   POST → Shipro registra manualmente una Conexion para el cliente (Opción B del
//          diseño LOCKED con Nacho: el registro es manual, no automático — Shipro
//          marca la plataforma que el cliente va a usar antes/cuando le envía el
//          plugin/link/etc.). Upsert sobre (empresaId, plataforma) para respetar
//          el @@unique del modelo.
//
// Gate: admin_shipro / operador_shipro (mismo patrón que /enviar-link-api-key).
// NO client-facing.

function respuestaRolNegado() {
  return NextResponse.json({ error: "Acceso denegado. Solo equipo Shipro." }, { status: 403 });
}

function respuestaEmpresaInvalida() {
  return NextResponse.json({ error: "empresaId inválido" }, { status: 400 });
}

// Whitelist explícito de valores de enum aceptados (nunca confiar en el body
// para acceder al enum crudo). Los 3 sets vienen de Prisma-generated types.
const PLATAFORMAS_VALIDAS = new Set<string>(Object.values(PlataformaConexion));
const MECANISMOS_VALIDOS = new Set<string>(Object.values(MecanismoConexion));
const ESTADOS_VALIDOS = new Set<string>(Object.values(EstadoConexion));

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return respuestaRolNegado();
    }

    const { id } = await params;
    const empresaId = parseInt(id, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return respuestaEmpresaInvalida();
    }

    // Batch en paralelo: conexiones + tiendas Tiendanube + metadata API Key.
    const [conexiones, tiendasTiendanube, empresa] = await Promise.all([
      prisma.conexion.findMany({
        where: { empresaId },
        orderBy: [{ plataforma: "asc" }, { id: "asc" }],
      }),
      prisma.tiendaTiendanube.findMany({
        where: { empresaId },
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          storeId: true,
          nombre: true,
          dominio: true,
          estado: true,
          instaladaEn: true,
          desinstaladaEn: true,
        },
      }),
      prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { apiKeyActiva: true, apiKeyUltimos4: true, apiKeyCreadaEn: true, apiKeyHash: true },
      }),
    ]);

    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      conexiones,
      tiendasTiendanube,
      apiKey: {
        existe: !!empresa.apiKeyHash,
        activa: empresa.apiKeyActiva,
        ultimos4: empresa.apiKeyUltimos4,
        creadaEn: empresa.apiKeyCreadaEn,
      },
    });
  } catch (e) {
    console.error("[/api/admin/empresas/[id]/conexiones GET] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rol = request.headers.get("x-rol") || "";
    if (rol !== "admin_shipro" && rol !== "operador_shipro") {
      return respuestaRolNegado();
    }

    const { id } = await params;
    const empresaId = parseInt(id, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return respuestaEmpresaInvalida();
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }

    const plataforma = String(body?.plataforma ?? "").trim();
    const mecanismo = String(body?.mecanismo ?? "").trim();
    const estado = String(body?.estado ?? "PENDIENTE").trim();
    const referenciaExterna = body?.referenciaExterna
      ? String(body.referenciaExterna).trim() || null
      : null;

    if (!PLATAFORMAS_VALIDAS.has(plataforma)) {
      return NextResponse.json({ error: "plataforma inválida", validas: [...PLATAFORMAS_VALIDAS] }, { status: 400 });
    }
    if (!MECANISMOS_VALIDOS.has(mecanismo)) {
      return NextResponse.json({ error: "mecanismo inválido", validos: [...MECANISMOS_VALIDOS] }, { status: 400 });
    }
    if (!ESTADOS_VALIDOS.has(estado)) {
      return NextResponse.json({ error: "estado inválido", validos: [...ESTADOS_VALIDOS] }, { status: 400 });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, activo: true } });
    if (!empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }

    // Upsert sobre el @@unique([empresaId, plataforma]). Si ya existe una
    // Conexion para ese par → actualizar mecanismo/estado/referenciaExterna.
    // Si no → crear nueva. Cero explotan por duplicate constraint.
    const conexion = await prisma.conexion.upsert({
      where: { empresaId_plataforma: { empresaId, plataforma: plataforma as PlataformaConexion } },
      update: {
        mecanismo: mecanismo as MecanismoConexion,
        estado: estado as EstadoConexion,
        referenciaExterna,
      },
      create: {
        empresaId,
        plataforma: plataforma as PlataformaConexion,
        mecanismo: mecanismo as MecanismoConexion,
        estado: estado as EstadoConexion,
        referenciaExterna,
      },
    });

    return NextResponse.json({ ok: true, conexion });
  } catch (e) {
    console.error("[/api/admin/empresas/[id]/conexiones POST] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
