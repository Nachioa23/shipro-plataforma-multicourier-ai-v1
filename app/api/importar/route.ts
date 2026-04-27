import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { envios } = body;

    if (!envios || !Array.isArray(envios)) {
      return NextResponse.json({ error: "Lote inválido" }, { status: 400 });
    }

    const EMPRESA_ID = 1; 

    const couriersDB = await prisma.courier.findMany();
    const mapCouriers = new Map(couriersDB.map(c => [c.nombre.toLowerCase(), c.id]));

    for (const data of envios) {
      try {
        const courierId = mapCouriers.get(data.courierNombre.toLowerCase()) || 1;

        // Limpiamos los "null" de texto que a veces traen los CSV
        const emailLimpio = (data.destinatarioEmail && data.destinatarioEmail !== "null") ? data.destinatarioEmail.trim() : "";
        const telLimpio = (data.destinatarioTelefono && data.destinatarioTelefono !== "null") ? data.destinatarioTelefono.trim() : "";
        const dniLimpio = (data.destinatarioDni && data.destinatarioDni !== "null") ? data.destinatarioDni.trim() : "";
        const nombreLimpio = (data.destinatarioNombre && data.destinatarioNombre !== "null") ? data.destinatarioNombre.trim() : "Sin Nombre";
        const calleLimpia = (data.destinoCalle && data.destinoCalle !== "null") ? data.destinoCalle.trim() : "";
        const locLimpia = (data.destinoLocalidad && data.destinoLocalidad !== "null") ? data.destinoLocalidad.trim() : "";

        let direccionId = null;

        if (emailLimpio !== "") {
          const dirExistente = await prisma.direccion.findFirst({
            where: { email: emailLimpio }
          });

          if (dirExistente) {
            const dirUpdate = await prisma.direccion.update({
              where: { id: dirExistente.id },
              data: {
                nombre: nombreLimpio,
                telefono: telLimpio,
                documento: dniLimpio,
                calle: calleLimpia,
                localidad: locLimpia
              }
            });
            direccionId = dirUpdate.id;
          }
        }

        if (!direccionId) {
          const nuevaDir = await prisma.direccion.create({
            data: {
              nombre: nombreLimpio,
              email: emailLimpio,
              telefono: telLimpio,
              documento: dniLimpio,
              cp: String(data.destinoCp).replace("null", ""),
              calle: calleLimpia,
              altura: (data.destinoAltura && data.destinoAltura !== "null") ? data.destinoAltura : "",
              piso: (data.destinoPiso && data.destinoPiso !== "null") ? data.destinoPiso : "",
              dpto: (data.destinoDpto && data.destinoDpto !== "null") ? data.destinoDpto : "",
              localidad: locLimpia,
              provincia: (data.destinoProvincia && data.destinoProvincia !== "null") ? data.destinoProvincia : "",
              pais: "Argentina"
            }
          });
          direccionId = nuevaDir.id;
        }

        const fechaImpresion = data.fechaCreacion && data.fechaCreacion !== "null" ? new Date(data.fechaCreacion) : new Date();
        const fechaRec = data.fechaRecoleccion && data.fechaRecoleccion !== "null" ? new Date(data.fechaRecoleccion) : null;
        const fechaEnt = data.fechaEntrega && data.fechaEntrega !== "null" ? new Date(data.fechaEntrega) : null;

        await prisma.envio.upsert({
          where: { trackingNumber: data.trackingNumber },
          update: {
            
            // ========================================================
            // EL CAMBIO MÁGICO ESTÁ ACÁ: AHORA SÍ CONECTA EL DESTINO
            // ========================================================
            destino: { connect: { id: direccionId } },
            // ========================================================

            estadoActual: data.estadoActual,
            fechaRecoleccion: fechaRec,
            fechaEntrega: fechaEnt,
            pesoReal: data.pesoReal,
            pesoFacturado: data.pesoFacturado,
            pesoVolumetrico: data.pesoVolumetrico,
            finanzas: {
              upsert: {
                create: {
                  precioProveedor: data.precioProveedor,
                  precioFactura: data.precioFactura,
                  precioMostrado: data.precioMostrado
                },
                update: {
                  precioProveedor: data.precioProveedor,
                  precioFactura: data.precioFactura,
                  precioMostrado: data.precioMostrado
                }
              }
            }
          },
          create: {
            trackingNumber: data.trackingNumber,
            empresa: { connect: { id: EMPRESA_ID } },
            courier: { connect: { id: courierId } },
            destino: { connect: { id: direccionId } },
            estadoActual: data.estadoActual,
            modalidad: data.modalidad,
            pesoReal: data.pesoReal,
            pesoFacturado: data.pesoFacturado,
            pesoVolumetrico: data.pesoVolumetrico,
            fechaImpresion: fechaImpresion,
            fechaRecoleccion: fechaRec,
            fechaEntrega: fechaEnt,
            finanzas: {
              create: {
                precioProveedor: data.precioProveedor,
                precioFactura: data.precioFactura,
                precioMostrado: data.precioMostrado
              }
            },
            ordenExterna: {
              create: {
                ordenId: data.ordenId && data.ordenId !== "null" ? data.ordenId : "",
                canal: data.canal && data.canal !== "null" ? data.canal : "",
                idTienda: data.idTiendanube && data.idTiendanube !== "null" ? data.idTiendanube : ""
              }
            }
          }
        });

      } catch (err) {
        console.error("Error importando fila", err);
      }
    }

    return NextResponse.json({ success: true, guardados: envios.length });
  } catch (error) {
    console.error("Error global en API de importación:", error);
    return NextResponse.json({ error: "Error interno procesando lote" }, { status: 500 });
  }
}