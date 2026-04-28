import { ICourierIntegrator } from './CourierInterface';
import { AndreaniAdapter } from './AndreaniAdapter';
import { MocisAdapter } from './MocisAdapter';

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

      case 'mocis':
        if (!credenciales.clientApi || !credenciales.clientSecret) throw new Error("Faltan llaves de Moci's");
        return new MocisAdapter(credenciales.clientApi, credenciales.clientSecret);

      // Para sumar un nuevo courier: importarlo arriba y agregar un nuevo `case` acá.

      default:
        throw new Error(`El courier '${courier}' no está soportado en la plataforma.`);
    }
  }
}