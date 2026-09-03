import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/utils/apikey-hash";

// DEUDA 150 Pieza 2 — Endpoint público para generar la API Key vía token de setup.
// Consumido por la página pública `/setup-api-key/[token]`. NO usa sesión: la
// autenticación es el propio token de un solo uso enviado por mail al cliente.
//
// GET  → valida el token y devuelve metadata mínima para la UI (empresa nombre,
//        si ya hay key). No genera ni consume nada — solo valida para renderizar.
// POST → valida el token, genera la API Key, la persiste (mismo patrón que
//        /api/empresa/api-key POST: hash HMAC-SHA256 + últimos4 + activa=true +
//        creadaEn=now), marca el token como usado, y devuelve el PLAIN UNA SOLA
//        VEZ. Shipro nunca ve esta respuesta — es del cliente.
//
// SEGURIDAD:
// - Token debe existir + no expirado + usadoEn=null. Cualquier falla = 404
//   idéntico (no revela existencia del token).
// - El plain de la key SOLO se devuelve una vez, en la respuesta del POST. En BD
//   se guarda solo el hash (misma política que /api/empresa/api-key POST).
// - Path público → registrado en proxy.ts PUBLIC_API_EXACT (el proxy no aplica
//   sesión ni API-key auth a esta ruta).

function respuestaTokenInvalido() {
  return NextResponse.json({ error: "Link inválido o expirado" }, { status: 404 });
}

async function validarToken(token: string) {
  const registro = await prisma.tokenSetupApiKey.findFirst({
    where: {
      token,
      expira: { gt: new Date() },
      usadoEn: null,
    },
    select: {
      id: true,
      empresaId: true,
      empresa: { select: { nombre: true, apiKeyHash: true, apiKeyUltimos4: true, apiKeyActiva: true } },
    },
  });
  return registro;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = (searchParams.get("token") || "").trim();
  if (!token) {
    return respuestaTokenInvalido();
  }

  const registro = await validarToken(token);
  if (!registro) {
    return respuestaTokenInvalido();
  }

  return NextResponse.json({
    ok: true,
    empresaNombre: registro.empresa.nombre,
    // Sirve para que la UI pueda advertir al cliente que ya existe una key en su
    // empresa (rotarla acá invalida la anterior). No exponemos el hash ni el plain.
    keyYaExiste: !!registro.empresa.apiKeyHash,
    keyUltimos4: registro.empresa.apiKeyUltimos4,
    keyActiva: registro.empresa.apiKeyActiva,
  });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const token = (body?.token || "").toString().trim();
  if (!token) {
    return respuestaTokenInvalido();
  }

  const registro = await validarToken(token);
  if (!registro) {
    return respuestaTokenInvalido();
  }

  // Generar + persistir + consumir el token en una transacción atómica: o pasan
  // las 3 cosas, o ninguna. Evita quedar con la key rotada sin marcar el token
  // (habilitando double-spend del link), o con el token marcado y la key sin
  // actualizar.
  const { plain, hash, ultimos4 } = generateApiKey();
  const now = new Date();

  try {
    const empresa = await prisma.$transaction(async (tx) => {
      // Re-check el token dentro de la transacción para evitar race conditions
      // (dos POST paralelos con el mismo link). El UPDATE condicional con
      // where: usadoEn=null hace el lock efectivo.
      const consumido = await tx.tokenSetupApiKey.updateMany({
        where: { id: registro.id, usadoEn: null },
        data: { usadoEn: now },
      });
      if (consumido.count === 0) {
        // Otra request ya consumió el token entre la validación y el update.
        throw new Error("TOKEN_YA_USADO");
      }

      return tx.empresa.update({
        where: { id: registro.empresaId },
        data: {
          apiKeyHash: hash,
          apiKeyUltimos4: ultimos4,
          apiKeyCreadaEn: now,
          apiKeyActiva: true,
        },
        select: { apiKeyUltimos4: true, apiKeyCreadaEn: true, apiKeyActiva: true },
      });
    });

    // ÚNICA VEZ que la key completa se expone. El PLAIN NUNCA se persiste ni
    // se logea. Ver comentario en /api/empresa/api-key POST.
    return NextResponse.json({
      apiKey: plain,
      apiKeyUltimos4: empresa.apiKeyUltimos4,
      apiKeyCreadaEn: empresa.apiKeyCreadaEn,
      apiKeyActiva: empresa.apiKeyActiva,
    });
  } catch (err: any) {
    if (err?.message === "TOKEN_YA_USADO") {
      return respuestaTokenInvalido();
    }
    console.error("[/api/empresa/api-key/via-token] Error:", err);
    return NextResponse.json({ error: "Error interno al generar la key" }, { status: 500 });
  }
}
