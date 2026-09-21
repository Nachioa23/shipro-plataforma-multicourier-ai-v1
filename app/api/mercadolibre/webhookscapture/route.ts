import { NextResponse } from "next/server";

// ============================================================================
// 🚨 THROWAWAY diagnostic — DELETE post-diagnóstico.
//
// Endpoint PASIVO para ver qué manda ML REAL cuando dispara un webhook:
// headers (incluida la cadena x-forwarded-for con la IP origen de ML detrás
// de Akamai + nginx), body raw + parsed, método HTTP. NO valida firma, NO
// rechaza NADA, NO escribe en la BD — solo `console.log` con prefijo
// `[ML-CAPTURE]` y devuelve 200. Que ML NO reintente porque siempre lo
// aceptamos como recibido.
//
// Contexto: research (GN + Chat D contra docs oficiales) sugiere que los
// webhooks marketplace (shipments/questions/items) autentican por IP de
// origen (~4 IPs fijas de ML), NO por HMAC — el x-signature/HMAC de nuestro
// receiver real es Mercado PAGO. Este capture endpoint es para CONFIRMAR
// qué envía ML en el mundo real antes de decidir si migramos el validador
// del receiver real (IP whitelist vs HMAC).
//
// USO:
//   1. Deploy este endpoint público en prod (proxy ya lo marca PUBLIC_API_EXACT).
//   2. Configurar en el portal de developers de ML como URL de "test/capture"
//      o gatillar un webhook real (venta test) apuntando temporalmente acá.
//   3. Ver el log: pm2 logs shipro --nostream --lines 500 | grep ML-CAPTURE
//   4. Pipe a jq para pretty print:
//      pm2 logs shipro --nostream --lines 500 | grep ML-CAPTURE | sed 's/^.*ML-CAPTURE //' | jq '.'
//   5. Post-diagnóstico: borrar el archivo + revertir la línea del proxy.
// ============================================================================

export const runtime = "nodejs";

async function capturar(request: Request, method: "POST" | "GET"): Promise<Response> {
  const ts = new Date().toISOString();

  // Body raw PRIMERO (para no perder bytes si algo más lo consume después).
  // Best-effort: si el body no viene o ya se leyó, capturamos "".
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    raw = "";
  }

  // Todos los headers como objeto plano (Headers es iterable).
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  // Cadena x-forwarded-for behind Akamai + nginx: el primer IP a la
  // izquierda es el client origen (candidato ML). x-real-ip como fallback.
  const xForwardedFor = request.headers.get("x-forwarded-for");
  const xRealIp = request.headers.get("x-real-ip");
  const mlOriginCandidate = xForwardedFor
    ? xForwardedFor.split(",")[0].trim()
    : xRealIp ?? null;

  // JSON.parse best-effort — nunca throw.
  let bodyParsed: unknown = null;
  try {
    bodyParsed = raw ? JSON.parse(raw) : null;
  } catch {
    bodyParsed = null;
  }

  // Un solo log line con toda la captura → grep-able + jq-able.
  const captura = {
    ts,
    method,
    url: request.url,
    mlOriginCandidate,
    xForwardedFor,
    xRealIp,
    headers,
    bodyRaw: raw,
    bodyParsed,
    bodyLength: raw.length,
  };
  console.log("[ML-CAPTURE]", JSON.stringify(captura));

  // 200 SIEMPRE — que ML no reintente, cero side effects.
  return NextResponse.json({ captured: true }, { status: 200 });
}

// ML posts webhooks; algunos "save/verify callback" en portales usan GET →
// aceptamos ambos para no perder ningún ping de prueba.
export async function POST(request: Request) {
  return capturar(request, "POST");
}

export async function GET(request: Request) {
  return capturar(request, "GET");
}
