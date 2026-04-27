import { ICourierIntegrator } from './CourierInterface';
import { AndreaniAdapter } from './AndreaniAdapter';
import { MoovaAdapter } from './MoovaAdapter';
import { MocisAdapter } from './MocisAdapter';
import { HopAdapter } from './HopAdapter';
import { PickitAdapter } from './PickitAdapter';
import { CorreoArgentinoAdapter } from './CorreoArgentinoAdapter';
import { MailExpressAdapter } from './MailExpressAdapter';

export class CourierFactory {
  static crear(courier: string, credenciales: any): ICourierIntegrator {
    
    switch (courier.toLowerCase()) {
      
      case 'andreani':
        return new AndreaniAdapter({
          username: credenciales.usuario || credenciales.username,
          password: credenciales.password,
          cliente: credenciales.cliente || "0",
          id_sucursal_origen: credenciales.id_sucursal_origen,
          contrato_domicilio: credenciales.contrato_domicilio || credenciales.contrato || "0",
          contrato_sucursal: credenciales.contrato_sucursal || credenciales.contrato || "0",
          contrato_cambio: credenciales.contrato_cambio,
          contrato_devolucion: credenciales.contrato_devolucion,
          contrato_sucursal_sucursal: credenciales.contrato_sucursal_sucursal,
          contrato_domicilio_sucursal: credenciales.contrato_domicilio_sucursal,
          contrato_sucursal_domicilio: credenciales.contrato_sucursal_domicilio,
          contrato_domicilio_domicilio: credenciales.contrato_domicilio_domicilio
        });

      case 'moova':
        if (!credenciales.apiKey) throw new Error("Falta API Key de Moova");
        return new MoovaAdapter(credenciales.apiKey);

      case 'mocis':
        if (!credenciales.clientApi || !credenciales.clientSecret) throw new Error("Faltan llaves de Moci's");
        return new MocisAdapter(credenciales.clientApi, credenciales.clientSecret);

      case 'hop':
        if (!credenciales.token) throw new Error("Falta Token de Hop");
        return new HopAdapter(credenciales.token);

      case 'pickit':
        if (!credenciales.token || !credenciales.retailer) throw new Error("Faltan credenciales de Pickit");
        return new PickitAdapter(credenciales.token, credenciales.retailer);

      case 'correo_argentino':
        if (!credenciales.usuario || !credenciales.customerId) throw new Error("Faltan credenciales de Correo Argentino");
        return new CorreoArgentinoAdapter(credenciales.usuario, credenciales.password, credenciales.customerId);

      case 'mail_express':
        if (!credenciales.apiToken) throw new Error("Falta Token de Mail Express");
        return new MailExpressAdapter(credenciales.apiToken, credenciales.sucursalOrigen);

      default:
        throw new Error(`El courier '${courier}' no está soportado en la plataforma.`);
    }
  }
}