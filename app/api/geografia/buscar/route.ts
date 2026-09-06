import { NextResponse } from "next/server";
import { resolverProvinciaDesdeCP } from "@/lib/geo/resolver-cp";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cp = searchParams.get('cp');

    if (!cp) {
      return NextResponse.json({ error: "Falta el Código Postal" }, { status: 400 });
    }

    // Refactor 2026-09-06: la lógica de resolución (query + DEUDA 26 provincia
    // dominante + normalización) vive ahora en `lib/geo/resolver-cp.ts` para
    // ser reusable desde crear.ts (path e-commerce). Este endpoint es un thin
    // wrapper HTTP sobre ese helper — cero cambio de API surface para los
    // consumers actuales (/corregir, /auditoria, y quien sea del dashboard).
    const resolucion = await resolverProvinciaDesdeCP(cp);

    if (!resolucion) {
      return NextResponse.json({ error: "Código Postal no encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      provincia: resolucion.provincia,
      localidades: resolucion.localidades,
    });

  } catch (error) {
    console.error("Error buscando geografía:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}