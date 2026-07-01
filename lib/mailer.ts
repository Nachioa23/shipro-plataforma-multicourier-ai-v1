import nodemailer from 'nodemailer';
import { Prisma } from "@prisma/client";

// Configuramos el "Cartero Robot"
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ==============================================================
// FIRMA CORPORATIVA UNIFICADA (Branding SHIPRO FLOW)
// ==============================================================
const firmaShipro = `
  <p style="font-size: 12px; color: #666; text-align: center; margin-top: 40px; border-top: 1px solid #eaeaea; padding-top: 20px;">
    Tecnología logística provista por<br>
    <span style="font-family: 'Sora', Arial, sans-serif; font-size: 16px; display: inline-block; margin-top: 5px;">
      <strong style="font-weight: 900; color: #233b6b;">SHIPRO</strong> <span style="font-weight: 300; color: #4d85cc;">FLOW</span>
    </span><br>
    <span style="font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1px; display: inline-block; margin-top: 2px;">| Socio Logístico Oficial |</span>
  </p>
`;

const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;800&display=swap');`;

// ==============================================================
// MAIL 0: PEAJE DE AUDITORÍA (Dirección Retenida)
// ==============================================================
export async function enviarMailRetenido(emailDestino: string, tracking: string, nombreCliente: string, urlCorreccion: string, nombreEmpresa: string) {
  try {
    const mailOptions = {
      from: `"${nombreEmpresa} (Envíos)" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `⚠️ Compra en ${nombreEmpresa}: Falta información para tu entrega`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #dc2626;">¡Hola, ${nombreCliente}!</h2>
          <p>Tu compra en <strong>${nombreEmpresa}</strong> ya está armada y lista para ser entregada al correo.</p>
          
          <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0; font-size: 14px; color: #991b1b;">
              <strong>¿Qué pasó?</strong> Al intentar generar tu etiqueta de envío, el sistema de validación satelital (Google Maps) detectó que los datos postales que ingresaste están incompletos o no coinciden con la zona de entrega.
            </p>
          </div>

          <p style="font-size: 14px; color: #555;">Para garantizar que el cartero encuentre tu domicilio sin problemas y tu paquete no sea devuelto, necesitamos que valides tu dirección exacta en nuestra plataforma segura.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${urlCorreccion}" target="_blank" style="background-color: #dc2626; color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
              Validar mi Dirección
            </a>
          </div>
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail Retenido:", error);
    return false;
  }
}

// ==============================================================
// MAIL 1: CREACIÓN DE ETIQUETA (Preparando Pedido)
// ==============================================================
export async function enviarMailCreacion(emailDestino: string, tracking: string, nombreCliente: string, nombreCourier: string, urlSeguimiento: string) {
  try {
    const mailOptions = {
      from: `"Shipro Operaciones" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `📦 Tu pedido está siendo preparado`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #233b6b;">¡Hola, ${nombreCliente}!</h2>
          <p>Tu compra ha sido confirmada y la tienda ya se encuentra preparando tu pedido para despacharlo a la brevedad.</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #233b6b;">
            <p style="margin: 0;"><strong>Código de Seguimiento:</strong> ${tracking}</p>
            <p style="margin: 5px 0 0 0;"><strong>Courier Asignado:</strong> <span style="text-transform: capitalize;">${nombreCourier}</span></p>
          </div>

          <p style="font-size: 14px; color: #555;">Una vez que el correo recolecte el paquete, podrás seguir su recorrido en tiempo real.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${urlSeguimiento}" target="_blank" style="background-color: #233b6b; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
              Seguir mi envío
            </a>
          </div>
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail 1:", error);
    return false;
  }
}

// ==============================================================
// MAIL 2: COLECTADO (En Tránsito)
// ==============================================================
export async function enviarMailColecta(emailDestino: string, tracking: string, nombreCliente: string, nombreCourier: string, urlSeguimiento: string) {
  try {
    const mailOptions = {
      from: `"Shipro Operaciones" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `🚚 ¡Tu paquete ya está en camino!`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #233b6b;">¡Buenas noticias, ${nombreCliente}!</h2>
          <p>El equipo de <span style="text-transform: capitalize;">${nombreCourier}</span> acaba de recolectar tu paquete. ¡Ya está oficialmente en tránsito hacia su destino!</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
            <p style="margin: 0;">Recordá que en las próximas 24/48 hs hábiles habrá movimiento en el seguimiento oficial.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${urlSeguimiento}" target="_blank" style="background-color: #233b6b; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
              Ver ubicación en tiempo real
            </a>
          </div>
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail 2:", error);
    return false;
  }
}

// ==============================================================
// MAIL 3: ENTREGADO + ENCUESTA NPS (DISEÑO EXPERIENCIA CLIENTE)
// ==============================================================
export async function enviarMailEntregadoNPS(emailDestino: string, tracking: string, nombreCliente: string, nombreCourier: string, baseUrl: string) {
  try {
    let botonesNPS = '';
    
    // Creamos la grilla de NPS del 0 al 10 con colores semánticos
    for (let i = 0; i <= 10; i++) {
      let colorBg = '#f3f4f6'; // Gris por defecto
      let colorText = '#4b5563';
      let border = '#d1d5db';
      
      // Detractores (0 a 6)
      if (i <= 6) { colorBg = '#fef2f2'; colorText = '#dc2626'; border = '#fca5a5'; }
      // Pasivos (7 y 8)
      else if (i <= 8) { colorBg = '#fefce8'; colorText = '#ca8a04'; border = '#fde047'; }
      // Promotores (9 y 10)
      else { colorBg = '#f0fdf4'; colorText = '#16a34a'; border = '#86efac'; }
      
      botonesNPS += `
        <a href="${baseUrl}/api/nps?tracking=${tracking}&score=${i}" 
           style="display: inline-block; width: 32px; height: 32px; line-height: 32px; text-align: center; margin: 3px; 
                  background-color: ${colorBg}; color: ${colorText}; text-decoration: none; font-weight: bold; 
                  border-radius: 6px; font-size: 15px; border: 1px solid ${border}; transition: all 0.2s;">
          ${i}
        </a>
      `;
    }

    const mailOptions = {
      from: `"Shipro Operaciones" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `✅ ¡Paquete entregado! ¿Cómo fue tu experiencia?`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background-color: #ffffff;">
          
          <div style="text-align: center; margin-bottom: 25px;">
            <div style="background-color: #dcfce3; width: 60px; height: 60px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 10px;">
              <span style="font-size: 30px;">🎉</span>
            </div>
            <h2 style="color: #233b6b; margin: 0; font-size: 24px;">¡Entregado, ${nombreCliente}!</h2>
          </div>

          <p style="text-align: center; font-size: 15px; color: #4b5563; line-height: 1.5; margin-bottom: 30px;">
            Según los registros oficiales de <strong style="text-transform: capitalize; color: #233b6b;">${nombreCourier}</strong>, acabamos de entregar tu paquete con éxito en el domicilio acordado.
          </p>
          
          <div style="margin: 30px 0; padding: 30px 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #f8fafc; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 18px; margin-bottom: 15px;">Queremos escucharte 🚀</h3>
            <p style="font-size: 14px; color: #64748b; font-weight: 500; margin-bottom: 25px; max-width: 90%; margin-left: auto; margin-right: auto;">
              Basado en tu experiencia de compra y entrega,<br>
              <strong>¿qué probabilidad hay de que nos recomiendes a un amigo o familiar?</strong>
            </p>
            
            <div style="display: flex; flex-wrap: wrap; justify-content: center; max-width: 450px; margin: 0 auto; gap: 2px;">
              ${botonesNPS}
            </div>
            
            <div style="display: flex; justify-content: space-between; max-width: 420px; margin: 15px auto 0; font-size: 11px; font-weight: bold; text-transform: uppercase;">
              <span style="color: #dc2626; display: flex; align-items: center; gap: 4px;">😞 Nada probable</span>
              <span style="color: #16a34a; display: flex; align-items: center; gap: 4px;">🤩 Muy probable</span>
            </div>

            <p style="font-size: 11px; color: #9ca3af; margin-top: 25px; font-style: italic;">
              * Al hacer clic en un número serás redirigido a una breve encuesta de 2 preguntas.
            </p>
          </div>
          
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail 3 (NPS):", error);
    return false;
  }
}

// ==============================================================
// MAIL 4: LOGÍSTICA INVERSA
// ==============================================================
export async function enviarMailInversa(emailDestino: string, tracking: string, urlEtiqueta: string, nombreCliente: string, nombreCourier: string) {
  try {
    const mailOptions = {
      from: `"Shipro Operaciones" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `♻️ Tu etiqueta de devolución está lista`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #233b6b;">¡Hola, ${nombreCliente}!</h2>
          <p>Hemos generado tu etiqueta de logística inversa. Ya podés iniciar el proceso de retorno de tu paquete.</p>
          
          <div style="background-color: #fff7ed; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f97316;">
            <p style="margin: 0;"><strong>Tracking:</strong> ${tracking}</p>
            <p style="margin: 5px 0 0 0;"><strong>Courier:</strong> <span style="text-transform: capitalize;">${nombreCourier}</span></p>
            <p style="margin: 15px 0 0 0; font-size: 14px;"><strong>Instrucción:</strong> Imprimí la etiqueta, pegala de forma visible en el exterior de la caja (asegurate de tapar etiquetas anteriores) y entregala al correo.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${urlEtiqueta}" target="_blank" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
              Descargar Etiqueta (PDF)
            </a>
          </div>
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail 4:", error);
    return false;
  }
}

// ==============================================================
// MAIL 5: BIENVENIDA Y ONBOARDING
// ==============================================================
export async function enviarMailBienvenida(emailDestino: string, nombreEmpresaOUsuario: string, claveTemporal: string, urlLogin: string) {
  try {
    const mailOptions = {
      from: `"Shipro Onboarding" <${process.env.SMTP_USER}>`, 
      to: emailDestino,
      subject: `🚀 Bienvenido a Shipro: Activación de tu cuenta`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #233b6b;">¡Hola, ${nombreEmpresaOUsuario}! 👋</h2>
          <p>Tu cuenta en <strong>Shipro</strong> ya fue habilitada. Para comenzar a cotizar envíos y generar etiquetas, es indispensable que completes el proceso de Onboarding.</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
            <p style="margin: 0; color: #1f2937; font-weight: bold; margin-bottom: 10px;">Tus credenciales de acceso:</p>
            <p style="margin: 0; font-family: monospace; font-size: 14px;"><strong>Usuario:</strong> ${emailDestino}</p>
            <p style="margin: 5px 0 0 0; font-family: monospace; font-size: 14px;"><strong>Clave Temporal:</strong> ${claveTemporal}</p>
          </div>

          <h3 style="color: #4b5563; font-size: 16px; margin-top: 25px;">Instrucciones de Onboarding:</h3>
          <ol style="color: #4b5563; line-height: 1.6; margin-bottom: 25px; padding-left: 20px;">
            <li>Ingresá a la plataforma haciendo clic en el botón de abajo.</li>
            <li>Dirigite a la sección <strong>"Mis Transportes"</strong> en tu panel lateral izquierdo.</li>
            <li>Allí deberás <strong>activar</strong> los couriers que vas a utilizar y registrar tus <strong>Credenciales API</strong> de cada uno.</li>
            <li>Si vas a operar con la Tarifa Corporativa de Shipro, asegurate de tener fondos en tu Billetera Virtual.</li>
          </ol>

          <div style="text-align: center; margin: 35px 0;">
            <a href="${urlLogin}" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
              Ingresar a la Plataforma
            </a>
          </div>
          
          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 30px;">
            Por seguridad, te recomendamos cambiar la contraseña apenas ingreses al panel.<br>
            Si necesitás ayuda con la integración, respondé este correo.
          </p>
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail Bienvenida:", error);
    return false;
  }
}

// ==============================================================
// MAIL 6: ESCALACIÓN AL COURIER (Soporte Shipro)
// ==============================================================
export async function enviarMailEscalacionCourier(emailCourier: string, nombreCourier: string, tracking: string, estadoActual: string, motivo: string, observacion: string) {
  try {
    const mailOptions = {
      from: `"Shipro Operaciones" <${process.env.SMTP_USER}>`,
      to: emailCourier,
      bcc: "operaciones@shipro.pro", // Copia oculta para auditoría interna
      subject: `URGENTE: Incidencia Operativa - Tracking ${tracking} [Shipro]`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #dc2626;">Notificación de Incidencia Logística</h2>
          <p>Estimado equipo de Soporte de <strong>${nombreCourier}</strong>,</p>
          <p>Nos contactamos desde el centro de operaciones de Shipro para reportar una anomalía crítica en el siguiente envío:</p>
          
          <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0; font-size: 14px;"><strong>Tracking N°:</strong> ${tracking}</p>
            <p style="margin: 5px 0 0 0; font-size: 14px;"><strong>Estado en Sistema:</strong> ${estadoActual}</p>
            <p style="margin: 5px 0 0 0; font-size: 14px;"><strong>Motivo del Reclamo:</strong> ${motivo}</p>
          </div>

          <h3 style="color: #4b5563; font-size: 14px; margin-top: 20px;">Observaciones del Operador:</h3>
          <p style="background-color: #f9fafb; padding: 15px; border: 1px solid #e5e7eb; border-radius: 8px; font-style: italic; color: #4b5563; font-size: 13px;">
            "${observacion}"
          </p>

          <p style="font-size: 14px; color: #555; margin-top: 20px;">Aguardamos una pronta respuesta y resolución sobre este caso para poder informar al destinatario final.</p>
          
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail Escalación Courier:", error);
    return false;
  }
}

// ==============================================================
// MAIL 7: CONTENCIÓN AL DESTINATARIO (Gestión de Ansiedad)
// ==============================================================
export async function enviarMailContencionDestinatario(emailDestino: string, nombreDestinatario: string, nombreEmpresa: string, tracking: string) {
  try {
    const mailOptions = {
      from: `"${nombreEmpresa} (Envíos)" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `Actualización sobre tu entrega de ${nombreEmpresa}`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #f97316;">¡Hola, ${nombreDestinatario}!</h2>
          <p>Te escribimos para avisarte que hemos detectado una demora inusual o un inconveniente logístico con tu paquete (Tracking: <strong>${tracking}</strong>).</p>
          
          <div style="background-color: #fff7ed; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f97316;">
            <p style="margin: 0; font-size: 14px; color: #9a3412;">
              <strong>No te preocupes.</strong> Nuestro equipo de operaciones ya intervino de forma proactiva y elevó un reclamo oficial al correo encargado de tu zona.
            </p>
          </div>

          <p style="font-size: 14px; color: #555;">Estamos monitoreando de cerca el avance de tu entrega. En cuanto tengamos una resolución o una nueva fecha de visita, te lo notificaremos de inmediato.</p>

          <p style="font-size: 14px; color: #555; margin-top: 20px;">Gracias por tu paciencia.</p>
          
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail Contención Destinatario:", error);
    return false;
  }
}

// ==============================================================
// MAIL 8: CIERRE DE TICKET (Resolución al Cliente)
// ==============================================================
export async function enviarMailCierreTicket(emailDestino: string, tracking: string, resolucion: string) {
  try {
    const mailOptions = {
      from: `"Shipro Soporte" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `✅ Caso Resuelto - Tracking ${tracking}`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #10b981;">Incidencia Resuelta</h2>
          <p>Te notificamos que el ticket de soporte asociado al envío <strong>${tracking}</strong> ha sido marcado como CERRADO por nuestro equipo de operaciones.</p>
          
          <h3 style="color: #4b5563; font-size: 14px; margin-top: 20px;">Notas de Resolución:</h3>
          <div style="background-color: #f0fdf4; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #10b981;">
            <p style="margin: 0; font-size: 14px; color: #166534;">
              "${resolucion}"
            </p>
          </div>

          <p style="font-size: 14px; color: #555; margin-top: 20px;">Si considerás que el problema persiste, por favor contactate nuevamente con soporte haciendo referencia al número de tracking.</p>
          
          ${firmaShipro}
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("[Mailer] Error Mail Cierre Ticket:", error);
    return false;
  }
}

// ==============================================================
// MAIL 4: ENCUESTA NPS CLIENTE EMPRESA (Metrica 1.3, DEUDA 39, 2026-06-11)
// Cadencia trimestral. Email a gerentes / operadores activos.
// Token unico sin expiracion. Una sola respuesta por usuario por periodo.
// ==============================================================
/**
 * DEUDA 22 (2026-06-18): notificacion al admin_shipro cuando una empresa
 * cruza umbral de suspension automatica (saldoActivo <= -limiteDescubierto * 1.5).
 *
 * @param emailDestino - email del admin_shipro a notificar
 * @param nombreAdmin - nombre del admin (para personalizar el mail)
 * @param nombreEmpresa - empresa que se suspendio
 * @param saldoActual - saldo en el momento de la suspension
 * @param limiteDescubierto - limite vigente
 * @param baseUrl - URL base de la app (para link a /admin-finanzas)
 */
export async function enviarMailEmpresaSuspendida(
  emailDestino: string,
  nombreAdmin: string,
  nombreEmpresa: string,
  saldoActual: Prisma.Decimal,
  limiteDescubierto: Prisma.Decimal,
  baseUrl: string
) {
  const fmtMoneda = (n: number) => `$${Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Coercion a number solo para formateo de display (toLocaleString). Los valores
  // reales son Decimal en lib/utils/suspension-cuenta.ts; aca solo se imprimen.
  const saldoActualNum = saldoActual.toNumber();
  const limiteDescubiertoNum = limiteDescubierto.toNumber();
  const deuda = Math.abs(saldoActualNum);
  const linkAdmin = `${baseUrl}/admin-finanzas`;
  const fechaSuspension = new Date().toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });

  await transporter.sendMail({
    from: `SHIPRO FLOW <${process.env.SMTP_USER}>`,
    to: emailDestino,
    subject: `[Alerta] Cuenta suspendida automaticamente: ${nombreEmpresa}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin-bottom: 24px;">
          <h2 style="color: #991b1b; margin: 0 0 8px 0; font-size: 18px;">Suspensi&oacute;n autom&aacute;tica disparada</h2>
          <p style="color: #7f1d1d; margin: 0; font-size: 14px;">Una empresa cruz&oacute; el umbral de suspensi&oacute;n por deuda excesiva.</p>
        </div>

        <p style="color: #333; font-size: 14px;">Hola <strong>${nombreAdmin}</strong>,</p>

        <p style="color: #333; font-size: 14px; line-height: 1.6;">
          La empresa <strong>${nombreEmpresa}</strong> fue suspendida automaticamente
          a las <strong>${fechaSuspension}</strong> por superar el umbral del 150% de su limite descubierto.
        </p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Saldo actual</td>
            <td style="padding: 12px; background: #fef2f2; border: 1px solid #e5e7eb; color: #991b1b; font-weight: bold; font-family: monospace;">-${fmtMoneda(deuda)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Limite descubierto autorizado</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; color: #4b5563; font-family: monospace;">${fmtMoneda(limiteDescubiertoNum)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #4b5563;">Umbral cruzado</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; color: #4b5563; font-family: monospace;">-${fmtMoneda(limiteDescubiertoNum * 1.5)} (150% del limite)</td>
          </tr>
        </table>

        <p style="color: #333; font-size: 14px; line-height: 1.6;">
          La empresa <strong>no puede crear nuevos envios</strong> hasta que su saldo
          vuelva a <strong>-${fmtMoneda(limiteDescubiertoNum * 0.5)}</strong> (50% del limite).
          La reactivacion es automatica cuando se acredite el pago.
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${linkAdmin}"
             style="background: #233b6b; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Ir al panel financiero
          </a>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
          Este es un mail automatico del sistema de auditoria de Shipro.
          Cualquier cambio queda registrado en el audit log de configuracion.
        </p>

        ${firmaShipro}
      </div>
    `,
  });
}

export async function enviarMailEncuestaEmpresa(
  emailDestino: string,
  nombreGerente: string,
  nombreEmpresa: string,
  periodo: string,
  tokenVoto: string,
  baseUrl: string
) {
  try {
    let botonesNPS = '';

    // Grilla 0-10 color-coded.
    for (let i = 0; i <= 10; i++) {
      let colorBg = '#f3f4f6';
      let colorText = '#4b5563';
      let border = '#d1d5db';

      if (i <= 6) { colorBg = '#fef2f2'; colorText = '#dc2626'; border = '#fca5a5'; }
      else if (i <= 8) { colorBg = '#fefce8'; colorText = '#ca8a04'; border = '#fde047'; }
      else { colorBg = '#f0fdf4'; colorText = '#16a34a'; border = '#86efac'; }

      botonesNPS += `
        <a href="${baseUrl}/encuesta-nps-empresa?token=${tokenVoto}&score=${i}"
           style="display: inline-block; width: 32px; height: 32px; line-height: 32px; text-align: center; margin: 3px;
                  background-color: ${colorBg}; color: ${colorText}; text-decoration: none; font-weight: bold;
                  border-radius: 6px; font-size: 15px; border: 1px solid ${border}; transition: all 0.2s;">
          ${i}
        </a>
      `;
    }

    const mailOptions = {
      from: `"Shipro Equipo" <${process.env.SMTP_USER}>`,
      to: emailDestino,
      subject: `Tu opinion ${periodo}: como ves a Shipro?`,
      html: `
        <style>${fontImport}</style>
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background-color: #ffffff;">

          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #233b6b; font-size: 22px; margin-bottom: 8px;">Hola, ${nombreGerente}</h1>
            <p style="color: #666; font-size: 14px; margin: 0;">${nombreEmpresa} - Encuesta ${periodo}</p>
          </div>

          <p style="font-size: 15px; line-height: 1.6;">
            En Shipro queremos mejorar continuamente. Nos tomas 2 minutos para
            decirnos como vamos este trimestre?
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; font-weight: bold; color: #233b6b; margin-bottom: 15px;">
              Que tan probable es que recomiendes Shipro a otra empresa?
            </p>

            <div style="display: flex; flex-wrap: wrap; justify-content: center; max-width: 450px; margin: 0 auto; gap: 2px;">
              ${botonesNPS}
            </div>

            <div style="display: flex; justify-content: space-between; max-width: 420px; margin: 15px auto 0; font-size: 11px; font-weight: bold; text-transform: uppercase;">
              <span style="color: #dc2626;">Nada probable</span>
              <span style="color: #16a34a;">Muy probable</span>
            </div>
          </div>

          <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
            Al hacer click en un numero seras redirigido a una breve encuesta de 4 preguntas adicionales.
            Tu voto es importante para nosotros.
          </p>

          ${firmaShipro}
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("[Mailer] Mail 4 (NPS Empresa) enviado a:", emailDestino, "periodo:", periodo);
  } catch (error) {
    console.error("[Mailer] Error Mail 4 (NPS Empresa):", error);
  }
}