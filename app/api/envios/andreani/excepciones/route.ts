import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { obtenerCredencialesShipro, parsearCredencialesPropias } from "@/lib/couriers/credenciales";
import { obtenerCredencialCourier } from "@/lib/couriers/normalizar";
import { resolverContext } from "@/lib/auth-context";
import { verificarAccesoEnvio } from "@/lib/envios/ownership";

// =========================================================================
// FUNCIÓN AUXILIAR: OBTENER TOKEN DE ANDREANI (DINÁMICO)
// =========================================================================
async function obtenerTokenAndreani(username?: string, password?: string) {
  if (!username || !password) {
    throw new Error("Faltan las credenciales de autenticación de Andreani.");
  }

  const base64Auth = Buffer.from(`${username}:${password}`).toString('base64');

  const res = await fetch("https://apis.andreani.com/login", {
    method: "GET",
    headers: {
      "Authorization": `Basic ${base64Auth}`
    }
  });

  if (!res.ok) {
    throw new Error("Andreani rechazó las credenciales. No se pudo obtener el token de seguridad.");
  }

  const token = res.headers.get("x-authorization-token");
  return token;
}

// =========================================================================
// ENDPOINT PRINCIPAL: GESTIÓN DE EXCEPCIONES (MODO CAZADOR DE URLs)
// =========================================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accion, tracking, datosNuevos } = body;

    if (!accion || !tracking) {
      return NextResponse.json({ error: "Falta la acción o el número de tracking." }, { status: 400 });
    }

    // DEUDA 87 FAMILIA 3: ownership check (mismo patron que cancelar/inversa).
    const ctx = resolverContext(request);
    if (ctx instanceof NextResponse) return ctx;

    // 1. Buscamos el Envío original en la base de datos para saber de quién es
    const envio = await verificarAccesoEnvio({ trackingNumber: tracking }, ctx);

    if (!envio) {
      return NextResponse.json({ error: "Envío no encontrado en la plataforma." }, { status: 404 });
    }

    // 2. Buscamos la configuración comercial de ese cliente para Andreani
    const credencial = await obtenerCredencialCourier(envio.empresaId, 'andreani');

    // 3. APLICAMOS LA REGLA ESTRICTA DE CREDENCIALES
    let llaves: any;
    if (credencial?.usaCredencialesPropias) {
      llaves = parsearCredencialesPropias('andreani', credencial.credencialesJson);
    } else {
      llaves = obtenerCredencialesShipro('andreani');
    }

    const username = llaves.username;
    const password = llaves.password;
    const contratoCambio = llaves.contrato_cambio;

    if (!username || !password) {
      return NextResponse.json({ error: "Las credenciales de Andreani no están configuradas correctamente para esta cuenta." }, { status: 400 });
    }

    // 4. Generamos el token con las llaves que correspondan (Cliente o Shipro)
    const token = await obtenerTokenAndreani(username, password);
    let payloadAndreani: any = {};

    if (accion === 'cambio_domicilio') {
      if (!contratoCambio) {
        return NextResponse.json({ error: "Falta el 'contrato_cambio' de Andreani en la configuración logística." }, { status: 400 });
      }

      payloadAndreani = {
        accion: "cambio_domicilio",
        datos: {
          contrato: contratoCambio,
          numeroAndreani: [tracking],
          destinatario: {
            "codigo Postal": datosNuevos.codigoPostal,
            direccion: datosNuevos.direccion,
            numero: datosNuevos.numero,
            piso: datosNuevos.piso || "",
            departamento: datosNuevos.departamento || "",
            localidad: datosNuevos.localidad
          }
        }
      };
    } 
    else {
      return NextResponse.json({ error: "Acción no soportada todavía." }, { status: 400 });
    }

    // =========================================================================
    // ARRAY DE RUTAS POSIBLES (Para saltear el error del manual de Andreani)
    // =========================================================================
    const rutasPosibles = [
      "https://apis.andreani.com/v2/NuevaAccion", 
      "https://apis.andreani.com/v1/acciones",    
      "https://apis.andreani.com/v2/acciones",    
      `https://apis.andreani.com/v2/envios/${tracking}/acciones`, 
      "https://apis.andreani.com/v2/api/NuevaAccion" 
    ];

    let detallesErrores: any[] = [];

    // El sistema va a golpear cada puerta, una por una
    for (const url of rutasPosibles) {
      console.log(`🔎 Probando URL de Andreani: ${url}`);
      
      const andreaniRes = await fetch(url, {
        method: "POST",
        headers: {
          "x-authorization-token": token || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payloadAndreani)
      });

      const andreaniData = await andreaniRes.json().catch(() => ({}));

      // Si nos atiende Andreani y da OK
      if (andreaniRes.ok) {
        console.log(`✅ ¡ÉXITO! La URL correcta era: ${url}`);
        
        // Registramos en nuestra DB que hicimos una modificación
        await prisma.eventoTracking.create({
          data: {
            estado: "EXCEPCION_SOLICITADA",
            observacion: `Cambio de domicilio solicitado: ${datosNuevos.direccion} ${datosNuevos.numero}, ${datosNuevos.localidad}`,
            envioId: envio.id
          }
        });

        return NextResponse.json({ 
          success: true, 
          mensaje: "La orden fue recibida por Andreani con éxito.",
          detalle: andreaniData,
          urlFuncionando: url
        });
      } 
      
      if (andreaniData.status === 400 || andreaniData.message?.toLowerCase().includes("estado") || andreaniData.message?.toLowerCase().includes("no se puede")) {
        console.log(`✅ URL CORRECTA (${url}) PERO RECHAZO OPERATIVO:`, andreaniData);
        return NextResponse.json({ 
          error: "Andreani rechazó la solicitud. Motivo: " + (andreaniData.message || JSON.stringify(andreaniData))
        }, { status: 400 });
      }

      detallesErrores.push({ url, error: andreaniData.message || JSON.stringify(andreaniData) });
    }

    console.error("❌ Ninguna URL de Andreani funcionó. Detalle:", detallesErrores);
    return NextResponse.json({ 
      error: "Error de configuración de Andreani. Ningún endpoint respondió correctamente. Revisá la consola del servidor para más detalles."
    }, { status: 500 });

  } catch (error: any) {
    console.error("Error crítico en el backend de excepciones:", error);
    return NextResponse.json({ error: error.message || "Error interno del servidor." }, { status: 500 });
  }
}