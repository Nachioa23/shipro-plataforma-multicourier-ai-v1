import {
  ICourierIntegrator,
  CotizacionParams,
  DespachoParams,
  SucursalInfo,
  OpcionCotizacion,
  ResultadoBulto,
} from './CourierInterface';

// =============================================================================
// MockCourierAdapter — harness de LOAD TESTING del hot path de cotización.
// =============================================================================
// Sustituye a CUALQUIER adapter real cuando CourierFactory detecta el flag
// LOAD_TEST_MOCK_COURIERS=true (gate triple en CourierFactory.crear(), ver ahí
// el detalle). NO se activa en prod — el gate lo impide a nivel código.
//
// Semántica:
//   - cotizar(): instantáneo, 2 opciones fijas por invocación. No toca red ni BD.
//   - El resto de los métodos throw explícito: el flow de load test SOLO ejercita
//     cotizar(). Si algún path accidental llama a los otros, nos enteramos ya.
//
// NO IMPLEMENTA solicitarRecoleccion ni vincularRecoleccion (es pure entregador
// desde el punto de vista del load test).
// =============================================================================

export class MockCourierAdapter implements ICourierIntegrator {
  readonly tarifaApiIncluyeIva = false;
  private courierNombre: string;

  constructor(courierNombre: string) {
    this.courierNombre = courierNombre;
  }

  // Dos opciones fijas por llamada. El `servicio` se usa como label del lado
  // del cotizador (cotizador.ts:620,622); NO se matchea contra un catálogo —
  // solo entra como string en el id (`dom-${courier}-${servicio}`) y en el
  // display. Precios constantes para estresar código + infra sin ruido random.
  async cotizar(_params: CotizacionParams): Promise<OpcionCotizacion[]> {
    return [
      { servicio: 'Estándar', precioNeto: 1000 },
      { servicio: 'Express', precioNeto: 1500 },
    ];
  }

  async despachar(
    _params: DespachoParams,
  ): Promise<{ tracking: string; etiquetaBase64?: string; etiquetaUrl?: string; bultos?: ResultadoBulto[] }> {
    throw new Error(`MockCourierAdapter.despachar: no debe invocarse durante load test (${this.courierNombre})`);
  }

  async obtenerEtiquetaBuffer(
    _ref: { trackingNumber: string; etiquetaUrl: string | null },
  ): Promise<Uint8Array> {
    throw new Error(`MockCourierAdapter.obtenerEtiquetaBuffer: no debe invocarse durante load test (${this.courierNombre})`);
  }

  async rastrear(_tracking: string): Promise<string> {
    throw new Error(`MockCourierAdapter.rastrear: no debe invocarse durante load test (${this.courierNombre})`);
  }

  async obtenerSucursales(_cp: string): Promise<SucursalInfo[]> {
    throw new Error(`MockCourierAdapter.obtenerSucursales: no debe invocarse durante load test (${this.courierNombre})`);
  }

  async cancelarEnvio(_tracking: string): Promise<boolean> {
    throw new Error(`MockCourierAdapter.cancelarEnvio: no debe invocarse durante load test (${this.courierNombre})`);
  }

  traducirEstado(estadoCrudo: string): string {
    return estadoCrudo;
  }
}
