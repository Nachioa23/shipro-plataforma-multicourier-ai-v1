import { NextResponse } from "next/server";

export async function GET() {
  try {
    const clientId = process.env.XUBIO_CLIENT_ID;
    const secretId = process.env.XUBIO_SECRET_ID;

    if (!clientId || !secretId) {
      return NextResponse.json({ error: "Faltan credenciales" }, { status: 400 });
    }

    const targetUrl = "https://xubio.com/API/1.1/clienteBean?numeroIdentificacion=33716130709";
    
    // --- IMPRESIÓN EN TERMINAL DE CURSOR (REQUEST) ---
    console.log("==========================================");
    console.log("🚀 INICIANDO PETICIÓN A XUBIO...");
    console.log(`URL: GET ${targetUrl}`);
    console.log(`HEADERS ENVIADOS:`);
    console.log(` - Accept: application/json`);
    console.log(` - client-id: ${clientId.substring(0, 10)}...[OCULTO]`);
    console.log(` - secret-id: ${secretId.substring(0, 10)}...[OCULTO]`);
    console.log("==========================================");

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "client-id": clientId,
        "secret-id": secretId
      }
    });

    const data = await response.json();

    // --- IMPRESIÓN EN TERMINAL DE CURSOR (RESPONSE) ---
    console.log("📥 RESPUESTA RECIBIDA DE XUBIO:");
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Body (JSON):`, JSON.stringify(data, null, 2));
    console.log("==========================================");

    if (response.ok) {
      return NextResponse.json({ mensaje: "¡BINGO! CONEXIÓN EXITOSA", httpStatus: response.status, data });
    } else {
      return NextResponse.json({ mensaje: "ERROR DE XUBIO", httpStatus: response.status, data });
    }

  } catch (error: any) {
    console.error("❌ FALLO DEL SERVIDOR SHIPRO:", error);
    return NextResponse.json({ error: "Fallo interno", detalle: error.message }, { status: 500 });
  }
}